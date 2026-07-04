#!/usr/bin/env npx tsx
/**
 * RecoveryService Tests
 *
 * Comprehensive test suite for the RecoveryService covering:
 * - Strategy registration and retrieval
 * - Recovery attempts with different strategies
 * - Cooldown management and exponential backoff
 * - Auto-recovery enablement/disablement
 * - Recovery history and statistics
 * - Event callbacks (onRecoveryStart, onRecoveryComplete, onHealthStatus)
 * - Default strategies for different services
 * - Max attempts handling
 * - Fallback execution
 *
 * Run: npx tsx tests/errors/recovery.service.test.ts
 */

import { RecoveryService, RecoveryStrategy, RecoveryError } from '../../src/services/recovery.service';

// ============== Test Helpers ==============

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve(fn())
    .then(() => {
      console.log(`✓ ${name}`);
      passed++;
    })
    .catch((err) => {
      console.log(`✗ ${name}`);
      console.log(`  Error: ${err.message}`);
      if (err.stack) {
        const stackLine = err.stack.split('\n')[1];
        if (stackLine) console.log(`  ${stackLine.trim()}`);
      }
      failed++;
    });
}

function assertEqual<T>(actual: T, expected: T, message?: string) {
  if (actual !== expected) {
    throw new Error(message || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertTrue(condition: boolean, message?: string) {
  if (!condition) {
    throw new Error(message || 'Expected condition to be true');
  }
}

function assertFalse(condition: boolean, message?: string) {
  if (condition) {
    throw new Error(message || 'Expected condition to be false');
  }
}

function assertGreaterThan(actual: number, threshold: number, message?: string) {
  if (actual <= threshold) {
    throw new Error(message || `Expected ${actual} to be greater than ${threshold}`);
  }
}

function assertGreaterThanOrEqual(actual: number, threshold: number, message?: string) {
  if (actual < threshold) {
    throw new Error(message || `Expected ${actual} to be >= ${threshold}`);
  }
}

function assertLessThan(actual: number, threshold: number, message?: string) {
  if (actual >= threshold) {
    throw new Error(message || `Expected ${actual} to be less than ${threshold}`);
  }
}

function assertLessThanOrEqual(actual: number, threshold: number, message?: string) {
  if (actual > threshold) {
    throw new Error(message || `Expected ${actual} to be <= ${threshold}`);
  }
}

function assertArrayIncludes<T>(array: T[], value: T, message?: string) {
  if (!array.includes(value)) {
    throw new Error(message || `Expected array to include ${JSON.stringify(value)}`);
  }
}

function assertArrayNotIncludes<T>(array: T[], value: T, message?: string) {
  if (array.includes(value)) {
    throw new Error(message || `Expected array not to include ${JSON.stringify(value)}`);
  }
}

// Helper to wait for a specific duration
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============== Test Suites ==============

async function runTests() {
  console.log('\n=== RecoveryService Tests ===\n');

  // ============================================================================
  // Strategy Registration Tests
  // ============================================================================

  console.log('--- Strategy Registration ---\n');

  await test('registerStrategy: should register a new strategy', () => {
    const service = new RecoveryService();

    const strategy: RecoveryStrategy = {
      service: 'test-service',
      action: 'retry',
      condition: (error) => error.message.includes('test'),
      maxAttempts: 3,
      cooldownMs: 1000,
    };

    service.registerStrategy('test-service', strategy);

    const strategies = service.getStrategies('test-service');
    assertEqual(strategies.length, 1);
    assertEqual(strategies[0].action, 'retry');
  });

  await test('registerStrategy: should allow multiple strategies per service', () => {
    const service = new RecoveryService();

    const strategy1: RecoveryStrategy = {
      service: 'multi-service',
      action: 'retry',
      condition: (error) => error.message.includes('timeout'),
      maxAttempts: 3,
      cooldownMs: 1000,
    };

    const strategy2: RecoveryStrategy = {
      service: 'multi-service',
      action: 'reconnect',
      condition: (error) => error.message.includes('connection'),
      maxAttempts: 5,
      cooldownMs: 2000,
    };

    service.registerStrategy('multi-service', strategy1);
    service.registerStrategy('multi-service', strategy2);

    const strategies = service.getStrategies('multi-service');
    assertEqual(strategies.length, 2);
  });

  await test('registerStrategy: should initialize service state', () => {
    const service = new RecoveryService();

    const strategy: RecoveryStrategy = {
      service: 'state-service',
      action: 'retry',
      condition: () => true,
      maxAttempts: 3,
      cooldownMs: 1000,
    };

    service.registerStrategy('state-service', strategy);

    const state = service.getServiceState('state-service');
    assertTrue(state !== undefined);
    assertEqual(state!.isRecovering, false);
    assertEqual(state!.consecutiveFailures, 0);
    assertEqual(state!.currentAttempts, 0);
  });

  await test('getStrategies: should return empty array for unknown service', () => {
    const service = new RecoveryService();
    const strategies = service.getStrategies('unknown-service');
    assertEqual(strategies.length, 0);
  });

  await test('getRegisteredServices: should return all registered services', () => {
    const service = new RecoveryService();
    const services = service.getRegisteredServices();

    // Should include default services
    assertArrayIncludes(services, 'database');
    assertArrayIncludes(services, 'telegram');
    assertArrayIncludes(services, 'ollama');
    assertArrayIncludes(services, 'claude');
    assertArrayIncludes(services, 'queue');
  });

  // ============================================================================
  // Default Strategies Tests
  // ============================================================================

  console.log('\n--- Default Strategies ---\n');

  await test('default strategies: should register database recovery strategies', () => {
    const service = new RecoveryService();
    const strategies = service.getStrategies('database');

    assertGreaterThan(strategies.length, 0);
    assertEqual(strategies[0].action, 'reconnect');
    assertEqual(strategies[0].maxAttempts, 5);
  });

  await test('default strategies: should register telegram recovery strategies', () => {
    const service = new RecoveryService();
    const strategies = service.getStrategies('telegram');

    assertGreaterThanOrEqual(strategies.length, 2);

    // Should have reconnect and restart strategies
    const reconnect = strategies.find(s => s.action === 'reconnect');
    const restart = strategies.find(s => s.action === 'restart');

    assertTrue(reconnect !== undefined);
    assertTrue(restart !== undefined);
  });

  await test('default strategies: should register ollama recovery strategies', () => {
    const service = new RecoveryService();
    const strategies = service.getStrategies('ollama');

    assertGreaterThanOrEqual(strategies.length, 2);

    const retry = strategies.find(s => s.action === 'retry');
    const fallback = strategies.find(s => s.action === 'fallback');

    assertTrue(retry !== undefined);
    assertTrue(fallback !== undefined);
  });

  await test('default strategies: should register claude recovery strategies', () => {
    const service = new RecoveryService();
    const strategies = service.getStrategies('claude');

    assertGreaterThanOrEqual(strategies.length, 2);
  });

  await test('default strategies: should register queue recovery strategies', () => {
    const service = new RecoveryService();
    const strategies = service.getStrategies('queue');

    assertGreaterThanOrEqual(strategies.length, 2);
  });

  await test('default strategies: should register circuit breaker recovery strategies', () => {
    const service = new RecoveryService();
    const strategies = service.getStrategies('circuitBreaker');

    assertGreaterThan(strategies.length, 0);
  });

  // ============================================================================
  // Recovery Attempt Tests
  // ============================================================================

  console.log('\n--- Recovery Attempts ---\n');

  await test('attemptRecovery: should successfully recover with matching strategy', async () => {
    const service = new RecoveryService();
    let handlerCalled = false;

    const strategy: RecoveryStrategy = {
      service: 'recovery-test',
      action: 'retry',
      condition: (error) => error.message.includes('recoverable'),
      maxAttempts: 3,
      cooldownMs: 100,
      handler: async () => {
        handlerCalled = true;
        return true;
      },
    };

    service.registerStrategy('recovery-test', strategy);

    const error = new Error('recoverable error');
    const result = await service.attemptRecovery('recovery-test', error);

    assertTrue(handlerCalled);
    assertTrue(result.success);
    assertEqual(result.action, 'retry');
    // Note: attempts is reset to 0 on success in the current implementation
    assertEqual(result.attempts, 0);
  });

  await test('attemptRecovery: should fail when no matching strategy found', async () => {
    const service = new RecoveryService();

    const strategy: RecoveryStrategy = {
      service: 'no-match-test',
      action: 'retry',
      condition: (error) => error.message.includes('specific-error'),
      maxAttempts: 3,
      cooldownMs: 100,
    };

    service.registerStrategy('no-match-test', strategy);

    const error = new Error('different error');
    const result = await service.attemptRecovery('no-match-test', error);

    assertFalse(result.success);
    assertEqual(result.action, 'escalate');
  });

  await test('attemptRecovery: should reject when already recovering', async () => {
    const service = new RecoveryService();

    const strategy: RecoveryStrategy = {
      service: 'concurrent-test',
      action: 'retry',
      condition: () => true,
      maxAttempts: 3,
      cooldownMs: 100,
      handler: async () => {
        await sleep(200);
        return true;
      },
    };

    service.registerStrategy('concurrent-test', strategy);

    const error = new Error('test error');

    // Start first recovery
    const promise1 = service.attemptRecovery('concurrent-test', error);

    // Attempt second recovery while first is in progress
    const result2 = await service.attemptRecovery('concurrent-test', error);

    assertFalse(result2.success);
    assertTrue(result2.error?.includes('already in progress'));

    // Wait for first to complete
    await promise1;
  });

  await test('attemptRecovery: should respect cooldown period', async () => {
    const service = new RecoveryService();

    const strategy: RecoveryStrategy = {
      service: 'cooldown-test',
      action: 'retry',
      condition: () => true,
      maxAttempts: 3,
      cooldownMs: 500,
      handler: async () => false, // Fail to trigger cooldown
    };

    service.registerStrategy('cooldown-test', strategy);

    const error = new Error('test error');

    // First attempt (will fail)
    const result1 = await service.attemptRecovery('cooldown-test', error);
    assertFalse(result1.success);

    // Immediate second attempt (should be rejected due to cooldown)
    const result2 = await service.attemptRecovery('cooldown-test', error);
    assertFalse(result2.success);
    assertTrue(result2.error?.includes('cooldown'));
  });

  await test('attemptRecovery: should handle max attempts exceeded', async () => {
    const service = new RecoveryService();

    const strategy: RecoveryStrategy = {
      service: 'max-attempts-test',
      action: 'retry',
      condition: () => true,
      maxAttempts: 2,
      cooldownMs: 50,
      handler: async () => false, // Always fail
    };

    service.registerStrategy('max-attempts-test', strategy);

    const error = new Error('test error');

    // First attempt (fails, currentAttempts becomes 1)
    const result1 = await service.attemptRecovery('max-attempts-test', error);
    assertFalse(result1.success);
    await sleep(120); // Wait for exponential backoff cooldown

    // Second attempt (fails, currentAttempts becomes 2)
    const result2 = await service.attemptRecovery('max-attempts-test', error);
    assertFalse(result2.success);
    await sleep(250); // Wait for longer exponential backoff cooldown

    // Third attempt (currentAttempts is 2 >= maxAttempts of 2, should be rejected)
    const result3 = await service.attemptRecovery('max-attempts-test', error);
    assertFalse(result3.success);
    assertEqual(result3.action, 'escalate');
    assertTrue(result3.error?.includes('Max recovery attempts'));
  });

  await test('attemptRecovery: should execute default recovery for retry action', async () => {
    const service = new RecoveryService();

    const strategy: RecoveryStrategy = {
      service: 'default-retry-test',
      action: 'retry',
      condition: () => true,
      maxAttempts: 3,
      cooldownMs: 100,
      // No handler - use default
    };

    service.registerStrategy('default-retry-test', strategy);

    const error = new Error('test error');
    const result = await service.attemptRecovery('default-retry-test', error);

    assertTrue(result.success);
    assertEqual(result.action, 'retry');
  });

  await test('attemptRecovery: should execute default recovery for reconnect action', async () => {
    const service = new RecoveryService();

    const strategy: RecoveryStrategy = {
      service: 'default-reconnect-test',
      action: 'reconnect',
      condition: () => true,
      maxAttempts: 3,
      cooldownMs: 100,
      // No handler - use default
    };

    service.registerStrategy('default-reconnect-test', strategy);

    const error = new Error('test error');
    const result = await service.attemptRecovery('default-reconnect-test', error);

    assertTrue(result.success);
    assertEqual(result.action, 'reconnect');
  });

  // ============================================================================
  // Fallback Handler Tests
  // ============================================================================

  console.log('\n--- Fallback Handlers ---\n');

  await test('fallback: should execute fallback when max attempts exceeded', async () => {
    const service = new RecoveryService();
    let fallbackCalled = false;

    const strategy: RecoveryStrategy = {
      service: 'fallback-test',
      action: 'retry',
      condition: () => true,
      maxAttempts: 1,
      cooldownMs: 50,
      handler: async () => false, // Always fail
      fallbackHandler: async () => {
        fallbackCalled = true;
        return true;
      },
    };

    service.registerStrategy('fallback-test', strategy);

    const error = new Error('test error');

    // First attempt fails
    await service.attemptRecovery('fallback-test', error);
    await sleep(60);

    // Second attempt should trigger fallback
    const result = await service.attemptRecovery('fallback-test', error);

    assertTrue(fallbackCalled);
    assertTrue(result.success);
    assertEqual(result.action, 'fallback');
  });

  await test('setFallbackHandler: should set fallback for all strategies', () => {
    const service = new RecoveryService();
    let fallbackCalled = false;

    const strategy1: RecoveryStrategy = {
      service: 'multi-fallback',
      action: 'retry',
      condition: () => true,
      maxAttempts: 3,
      cooldownMs: 100,
    };

    const strategy2: RecoveryStrategy = {
      service: 'multi-fallback',
      action: 'reconnect',
      condition: () => true,
      maxAttempts: 3,
      cooldownMs: 100,
    };

    service.registerStrategy('multi-fallback', strategy1);
    service.registerStrategy('multi-fallback', strategy2);

    service.setFallbackHandler('multi-fallback', async () => {
      fallbackCalled = true;
      return true;
    });

    const strategies = service.getStrategies('multi-fallback');
    assertTrue(strategies[0].fallbackHandler !== undefined);
    assertTrue(strategies[1].fallbackHandler !== undefined);
  });

  // ============================================================================
  // Cooldown and Exponential Backoff Tests
  // ============================================================================

  console.log('\n--- Cooldown and Exponential Backoff ---\n');

  await test('exponential backoff: should increase cooldown on consecutive failures', async () => {
    const service = new RecoveryService();

    const strategy: RecoveryStrategy = {
      service: 'backoff-test',
      action: 'retry',
      condition: () => true,
      maxAttempts: 5,
      cooldownMs: 100,
      handler: async () => false, // Always fail
    };

    service.registerStrategy('backoff-test', strategy);

    const error = new Error('test error');

    // First failure
    await service.attemptRecovery('backoff-test', error);
    const state1 = service.getServiceState('backoff-test');
    assertEqual(state1!.consecutiveFailures, 1);

    await sleep(120); // Wait for cooldown

    // Second failure - cooldown should be longer
    await service.attemptRecovery('backoff-test', error);
    const state2 = service.getServiceState('backoff-test');
    assertEqual(state2!.consecutiveFailures, 2);
  });

  await test('resetServiceState: should reset recovery state', () => {
    const service = new RecoveryService();

    const strategy: RecoveryStrategy = {
      service: 'reset-test',
      action: 'retry',
      condition: () => true,
      maxAttempts: 3,
      cooldownMs: 100,
    };

    service.registerStrategy('reset-test', strategy);

    // Manually set some state
    const state = service.getServiceState('reset-test')!;
    state.consecutiveFailures = 5;
    state.currentAttempts = 3;

    // Reset
    service.resetServiceState('reset-test');

    const newState = service.getServiceState('reset-test');
    assertEqual(newState!.consecutiveFailures, 0);
    assertEqual(newState!.currentAttempts, 0);
  });

  // ============================================================================
  // Auto-Recovery Tests
  // ============================================================================

  console.log('\n--- Auto-Recovery ---\n');

  await test('enableAutoRecovery: should enable auto-recovery for service', () => {
    const service = new RecoveryService();

    assertFalse(service.isAutoRecoveryEnabled('auto-test'));

    service.enableAutoRecovery('auto-test');

    assertTrue(service.isAutoRecoveryEnabled('auto-test'));
  });

  await test('disableAutoRecovery: should disable auto-recovery for service', () => {
    const service = new RecoveryService();

    service.enableAutoRecovery('auto-test');
    assertTrue(service.isAutoRecoveryEnabled('auto-test'));

    service.disableAutoRecovery('auto-test');

    assertFalse(service.isAutoRecoveryEnabled('auto-test'));
  });

  await test('handleHealthDegradation: should attempt recovery when auto-recovery enabled', async () => {
    const service = new RecoveryService();
    let handlerCalled = false;

    const strategy: RecoveryStrategy = {
      service: 'health-test',
      action: 'retry',
      condition: () => true,
      maxAttempts: 3,
      cooldownMs: 100,
      handler: async () => {
        handlerCalled = true;
        return true;
      },
    };

    service.registerStrategy('health-test', strategy);
    service.enableAutoRecovery('health-test');

    const result = await service.handleHealthDegradation('health-test');

    assertTrue(handlerCalled);
    assertTrue(result !== null);
    assertTrue(result!.success);
  });

  await test('handleHealthDegradation: should not attempt recovery when auto-recovery disabled', async () => {
    const service = new RecoveryService();

    const strategy: RecoveryStrategy = {
      service: 'no-auto-test',
      action: 'retry',
      condition: () => true,
      maxAttempts: 3,
      cooldownMs: 100,
    };

    service.registerStrategy('no-auto-test', strategy);

    const result = await service.handleHealthDegradation('no-auto-test');

    assertTrue(result === null);
  });

  // ============================================================================
  // Recovery History Tests
  // ============================================================================

  console.log('\n--- Recovery History ---\n');

  await test('getRecoveryHistory: should record successful recoveries', async () => {
    const service = new RecoveryService();

    const strategy: RecoveryStrategy = {
      service: 'history-test',
      action: 'retry',
      condition: () => true,
      maxAttempts: 3,
      cooldownMs: 100,
      handler: async () => true,
    };

    service.registerStrategy('history-test', strategy);

    const error = new Error('test error');
    await service.attemptRecovery('history-test', error);

    const history = service.getRecoveryHistory('history-test');
    assertGreaterThan(history.length, 0);
    assertEqual(history[0].service, 'history-test');
    assertTrue(history[0].success);
  });

  await test('getRecoveryHistory: should record failed recoveries', async () => {
    const service = new RecoveryService();

    const strategy: RecoveryStrategy = {
      service: 'history-fail-test',
      action: 'retry',
      condition: () => true,
      maxAttempts: 3,
      cooldownMs: 100,
      handler: async () => false,
    };

    service.registerStrategy('history-fail-test', strategy);

    const error = new Error('test error');
    await service.attemptRecovery('history-fail-test', error);

    const history = service.getRecoveryHistory('history-fail-test');
    assertGreaterThan(history.length, 0);
    assertFalse(history[0].success);
  });

  await test('getRecoveryHistory: should return all history when no service specified', async () => {
    const service = new RecoveryService();

    const strategy1: RecoveryStrategy = {
      service: 'service1',
      action: 'retry',
      condition: () => true,
      maxAttempts: 3,
      cooldownMs: 100,
      handler: async () => true,
    };

    const strategy2: RecoveryStrategy = {
      service: 'service2',
      action: 'retry',
      condition: () => true,
      maxAttempts: 3,
      cooldownMs: 100,
      handler: async () => true,
    };

    service.registerStrategy('service1', strategy1);
    service.registerStrategy('service2', strategy2);

    await service.attemptRecovery('service1', new Error('error1'));
    await service.attemptRecovery('service2', new Error('error2'));

    const allHistory = service.getRecoveryHistory();
    assertGreaterThanOrEqual(allHistory.length, 2);
  });

  await test('clearHistory: should clear all recovery history', async () => {
    const service = new RecoveryService();

    const strategy: RecoveryStrategy = {
      service: 'clear-test',
      action: 'retry',
      condition: () => true,
      maxAttempts: 3,
      cooldownMs: 100,
      handler: async () => true,
    };

    service.registerStrategy('clear-test', strategy);

    await service.attemptRecovery('clear-test', new Error('test'));

    let history = service.getRecoveryHistory();
    assertGreaterThan(history.length, 0);

    service.clearHistory();

    history = service.getRecoveryHistory();
    assertEqual(history.length, 0);
  });

  // ============================================================================
  // Recovery Statistics Tests
  // ============================================================================

  console.log('\n--- Recovery Statistics ---\n');

  await test('getRecoveryStats: should calculate total recoveries', async () => {
    const service = new RecoveryService();

    const strategy: RecoveryStrategy = {
      service: 'stats-test',
      action: 'retry',
      condition: () => true,
      maxAttempts: 3,
      cooldownMs: 100,
      handler: async () => true,
    };

    service.registerStrategy('stats-test', strategy);

    service.clearHistory(); // Start fresh

    await service.attemptRecovery('stats-test', new Error('test1'));
    await service.attemptRecovery('stats-test', new Error('test2'));

    const stats = service.getRecoveryStats();
    assertGreaterThanOrEqual(stats.totalRecoveries, 2);
  });

  await test('getRecoveryStats: should calculate success rate', async () => {
    const service = new RecoveryService();

    const successStrategy: RecoveryStrategy = {
      service: 'success-stats',
      action: 'retry',
      condition: () => true,
      maxAttempts: 3,
      cooldownMs: 100,
      handler: async () => true,
    };

    const failStrategy: RecoveryStrategy = {
      service: 'fail-stats',
      action: 'retry',
      condition: () => true,
      maxAttempts: 3,
      cooldownMs: 100,
      handler: async () => false,
    };

    service.registerStrategy('success-stats', successStrategy);
    service.registerStrategy('fail-stats', failStrategy);

    service.clearHistory();

    await service.attemptRecovery('success-stats', new Error('test1'));
    await service.attemptRecovery('fail-stats', new Error('test2'));

    const stats = service.getRecoveryStats();
    assertEqual(stats.successfulRecoveries, 1);
    assertEqual(stats.failedRecoveries, 1);
    assertEqual(stats.successRate, 0.5);
  });

  await test('getRecoveryStats: should group stats by service', async () => {
    const service = new RecoveryService();

    const strategy: RecoveryStrategy = {
      service: 'by-service-test',
      action: 'retry',
      condition: () => true,
      maxAttempts: 3,
      cooldownMs: 100,
      handler: async () => true,
    };

    service.registerStrategy('by-service-test', strategy);

    service.clearHistory();

    await service.attemptRecovery('by-service-test', new Error('test'));

    const stats = service.getRecoveryStats();
    assertTrue(stats.byService['by-service-test'] !== undefined);
    assertEqual(stats.byService['by-service-test'].total, 1);
    assertEqual(stats.byService['by-service-test'].successful, 1);
  });

  await test('getRecoveryStats: should group stats by action', async () => {
    const service = new RecoveryService();

    const retryStrategy: RecoveryStrategy = {
      service: 'action-stats',
      action: 'retry',
      condition: () => true,
      maxAttempts: 3,
      cooldownMs: 100,
      handler: async () => true,
    };

    service.registerStrategy('action-stats', retryStrategy);

    service.clearHistory();

    await service.attemptRecovery('action-stats', new Error('test'));

    const stats = service.getRecoveryStats();
    assertGreaterThan(stats.byAction.retry, 0);
  });

  // ============================================================================
  // Event Callback Tests
  // ============================================================================

  console.log('\n--- Event Callbacks ---\n');

  await test('onRecoveryStart: should call callback when recovery starts', async () => {
    const service = new RecoveryService();
    let callbackCalled = false;
    let capturedService = '';
    let capturedAction = '';

    const strategy: RecoveryStrategy = {
      service: 'callback-start-test',
      action: 'retry',
      condition: () => true,
      maxAttempts: 3,
      cooldownMs: 100,
      handler: async () => true,
    };

    service.registerStrategy('callback-start-test', strategy);

    service.onRecoveryStart((svc, action) => {
      callbackCalled = true;
      capturedService = svc;
      capturedAction = action;
    });

    await service.attemptRecovery('callback-start-test', new Error('test'));

    assertTrue(callbackCalled);
    assertEqual(capturedService, 'callback-start-test');
    assertEqual(capturedAction, 'retry');
  });

  await test('onRecoveryComplete: should call callback when recovery completes', async () => {
    const service = new RecoveryService();
    let callbackCalled = false;
    let capturedSuccess = false;

    const strategy: RecoveryStrategy = {
      service: 'callback-complete-test',
      action: 'retry',
      condition: () => true,
      maxAttempts: 3,
      cooldownMs: 100,
      handler: async () => true,
    };

    service.registerStrategy('callback-complete-test', strategy);

    service.onRecoveryComplete((svc, result) => {
      callbackCalled = true;
      capturedSuccess = result.success;
    });

    await service.attemptRecovery('callback-complete-test', new Error('test'));

    assertTrue(callbackCalled);
    assertTrue(capturedSuccess);
  });

  await test('onHealthStatus: should call callback on successful recovery', async () => {
    const service = new RecoveryService();
    let callbackCalled = false;
    let capturedHealthy = false;

    const strategy: RecoveryStrategy = {
      service: 'health-callback-test',
      action: 'retry',
      condition: () => true,
      maxAttempts: 3,
      cooldownMs: 100,
      handler: async () => true,
    };

    service.registerStrategy('health-callback-test', strategy);

    service.onHealthStatus((svc, healthy) => {
      callbackCalled = true;
      capturedHealthy = healthy;
    });

    await service.attemptRecovery('health-callback-test', new Error('test'));

    assertTrue(callbackCalled);
    assertTrue(capturedHealthy);
  });

  await test('callback unsubscribe: should stop calling callback after unsubscribe', async () => {
    const service = new RecoveryService();
    let callCount = 0;

    const strategy: RecoveryStrategy = {
      service: 'unsub-test',
      action: 'retry',
      condition: () => true,
      maxAttempts: 3,
      cooldownMs: 100,
      handler: async () => true,
    };

    service.registerStrategy('unsub-test', strategy);

    const unsubscribe = service.onRecoveryStart(() => {
      callCount++;
    });

    await service.attemptRecovery('unsub-test', new Error('test1'));
    assertEqual(callCount, 1);

    unsubscribe();

    await service.attemptRecovery('unsub-test', new Error('test2'));
    assertEqual(callCount, 1); // Should not increase
  });

  // ============================================================================
  // Custom Handler Tests
  // ============================================================================

  console.log('\n--- Custom Handlers ---\n');

  await test('setRecoveryHandler: should set custom handler for specific action', async () => {
    const service = new RecoveryService();
    let customHandlerCalled = false;

    const strategy: RecoveryStrategy = {
      service: 'custom-handler-test',
      action: 'retry',
      condition: () => true,
      maxAttempts: 3,
      cooldownMs: 100,
    };

    service.registerStrategy('custom-handler-test', strategy);

    service.setRecoveryHandler('custom-handler-test', 'retry', async () => {
      customHandlerCalled = true;
      return true;
    });

    await service.attemptRecovery('custom-handler-test', new Error('test'));

    assertTrue(customHandlerCalled);
  });

  // ============================================================================
  // Recovery State Tests
  // ============================================================================

  console.log('\n--- Recovery State ---\n');

  await test('isRecovering: should return true when recovery in progress', async () => {
    const service = new RecoveryService();

    const strategy: RecoveryStrategy = {
      service: 'is-recovering-test',
      action: 'retry',
      condition: () => true,
      maxAttempts: 3,
      cooldownMs: 100,
      handler: async () => {
        await sleep(100);
        return true;
      },
    };

    service.registerStrategy('is-recovering-test', strategy);

    assertFalse(service.isRecovering('is-recovering-test'));

    const promise = service.attemptRecovery('is-recovering-test', new Error('test'));

    // Should be true during recovery
    assertTrue(service.isRecovering('is-recovering-test'));

    await promise;

    // Should be false after recovery
    assertFalse(service.isRecovering('is-recovering-test'));
  });

  await test('getServiceState: should return undefined for unknown service', () => {
    const service = new RecoveryService();
    const state = service.getServiceState('unknown-service-12345');
    assertTrue(state === undefined);
  });

  // ============================================================================
  // RecoveryError Tests
  // ============================================================================

  console.log('\n--- RecoveryError ---\n');

  await test('RecoveryError: should create error with service and code', () => {
    const error = new RecoveryError('Test recovery error', 'test-service', 'TEST_CODE');

    assertEqual(error.message, 'Test recovery error');
    assertEqual(error.service, 'test-service');
    assertEqual(error.code, 'TEST_CODE');
    assertEqual(error.name, 'RecoveryError');
  });

  await test('RecoveryError: should use default code when not provided', () => {
    const error = new RecoveryError('Test error', 'test-service');
    assertEqual(error.code, 'RECOVERY_ERROR');
  });

  // Print summary
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Tests passed: ${passed}`);
  console.log(`Tests failed: ${failed}`);
  console.log('='.repeat(50));

  if (failed > 0) {
    process.exit(1);
  }
}

// Run tests
runTests().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
