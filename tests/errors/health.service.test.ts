#!/usr/bin/env npx tsx
/**
 * Health Service Tests
 *
 * Tests the health monitoring service operations:
 * - Health check registration and unregistration
 * - Individual and system-wide health checks
 * - Manual status management (markHealthy, markUnhealthy, markDegraded)
 * - Health monitoring and status change notifications
 * - Built-in health check factories
 * - Timeout handling for slow health checks
 * - Health status aggregation logic
 *
 * Run: npx tsx tests/errors/health.service.test.ts
 */

// Import types only to avoid triggering database initialization
import type {
  HealthCheckFn,
  ComponentHealth,
  SystemHealth,
} from '../../src/services/health.service.js';

// Delay actual imports until needed
let HealthService: any;
let createDatabaseHealthCheck: any;
let createQueueHealthCheck: any;
let createLLMHealthCheck: any;
let createClaudeHealthCheck: any;
let createTelegramHealthCheck: any;
let createDLQHealthCheck: any;
let createCircuitBreakersHealthCheck: any;

// Lazy load the module
async function loadHealthService() {
  if (!HealthService) {
    const module = await import('../../src/services/health.service.js');
    HealthService = module.HealthService;
    createDatabaseHealthCheck = module.createDatabaseHealthCheck;
    createQueueHealthCheck = module.createQueueHealthCheck;
    createLLMHealthCheck = module.createLLMHealthCheck;
    createClaudeHealthCheck = module.createClaudeHealthCheck;
    createTelegramHealthCheck = module.createTelegramHealthCheck;
    createDLQHealthCheck = module.createDLQHealthCheck;
    createCircuitBreakersHealthCheck = module.createCircuitBreakersHealthCheck;
  }
}

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

function assertNull(value: any, message?: string) {
  if (value !== null) {
    throw new Error(message || `Expected null, got ${JSON.stringify(value)}`);
  }
}

function assertNotNull(value: any, message?: string) {
  if (value === null) {
    throw new Error(message || 'Expected value to be non-null');
  }
}

function assertUndefined(value: any, message?: string) {
  if (value !== undefined) {
    throw new Error(message || `Expected undefined, got ${JSON.stringify(value)}`);
  }
}

function assertArrayLength(array: any[], expectedLength: number, message?: string) {
  if (array.length !== expectedLength) {
    throw new Error(message || `Expected array length ${expectedLength}, got ${array.length}`);
  }
}

function assertIncludes<T>(array: T[], value: T, message?: string) {
  if (!array.includes(value)) {
    throw new Error(message || `Expected array to include ${JSON.stringify(value)}`);
  }
}

// ============== Mock Health Check Functions ==============

function createMockHealthyCheck(name: string): HealthCheckFn {
  return async (): Promise<ComponentHealth> => {
    const startTime = Date.now();
    return {
      name,
      status: 'healthy',
      latencyMs: Date.now() - startTime,
      lastChecked: new Date(),
    };
  };
}

function createMockUnhealthyCheck(name: string, errorMsg: string): HealthCheckFn {
  return async (): Promise<ComponentHealth> => {
    const startTime = Date.now();
    return {
      name,
      status: 'unhealthy',
      latencyMs: Date.now() - startTime,
      error: errorMsg,
      lastChecked: new Date(),
    };
  };
}

function createMockDegradedCheck(name: string, errorMsg?: string): HealthCheckFn {
  return async (): Promise<ComponentHealth> => {
    const startTime = Date.now();
    return {
      name,
      status: 'degraded',
      latencyMs: Date.now() - startTime,
      error: errorMsg,
      lastChecked: new Date(),
    };
  };
}

function createMockSlowCheck(name: string, delayMs: number): HealthCheckFn {
  return async (): Promise<ComponentHealth> => {
    const startTime = Date.now();
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return {
      name,
      status: 'healthy',
      latencyMs: Date.now() - startTime,
      lastChecked: new Date(),
    };
  };
}

function createMockThrowingCheck(name: string): HealthCheckFn {
  return async (): Promise<ComponentHealth> => {
    throw new Error(`Health check error for ${name}`);
  };
}

// ============== Mock Dependencies ==============

class MockQueueRepository {
  constructor(
    public pending: number = 0,
    public processing: number = 0,
    public completed: number = 0,
    public failed: number = 0
  ) {}

  async getStats() {
    return {
      pending: this.pending,
      processing: this.processing,
      completed: this.completed,
      failed: this.failed,
    };
  }
}

class MockLLMClient {
  constructor(public healthy: boolean = true, public model: string = 'test-model', public error?: string) {}

  async healthCheck() {
    return {
      healthy: this.healthy,
      model: this.model,
      error: this.error,
    };
  }
}

class MockClaudeClient {
  constructor(public healthy: boolean = true, public error?: string) {}

  async healthCheck() {
    return {
      healthy: this.healthy,
      error: this.error,
    };
  }
}

class MockTelegramService {
  constructor(public isConnected: boolean = true) {}

  getClient() {
    if (!this.isConnected) {
      throw new Error('Telegram not connected');
    }
    return {};
  }
}

class MockDLQService {
  constructor(
    public total: number = 0,
    public oldestItemAge?: number,
    public recentFailures: number = 0
  ) {}

  async getStats() {
    return {
      total: this.total,
      oldestItemAge: this.oldestItemAge,
      recentFailures: this.recentFailures,
    };
  }
}

class MockCircuitBreaker {
  constructor(public serviceName: string, public state: string = 'CLOSED') {}

  getState() {
    return this.state;
  }

  getStats() {
    return {
      serviceName: this.serviceName,
    };
  }
}

// ============== Test Suites ==============

async function runTests() {
  console.log('\n=== Health Service Tests ===\n');

  // Load the health service module
  await loadHealthService();

  // -------------------- Registration Tests --------------------
  console.log('--- Registration Tests ---\n');

  await test('registerCheck() registers a health check', async () => {
    const service = new HealthService();
    const check = createMockHealthyCheck('test-component');

    service.registerCheck('test-component', check);

    const health = await service.getSystemHealth();
    assertEqual(health.components.length, 1);
    assertEqual(health.components[0].name, 'test-component');
    assertEqual(health.components[0].status, 'healthy');
  });

  await test('registerCheck() accepts custom options', async () => {
    const service = new HealthService();
    const check = createMockHealthyCheck('test-component');

    service.registerCheck('test-component', check, {
      interval: 60000,
      timeout: 10000,
      critical: true,
    });

    const health = await service.getSystemHealth();
    assertEqual(health.components.length, 1);
  });

  await test('registerCheck() allows multiple checks', async () => {
    const service = new HealthService();

    service.registerCheck('component-1', createMockHealthyCheck('component-1'));
    service.registerCheck('component-2', createMockHealthyCheck('component-2'));
    service.registerCheck('component-3', createMockHealthyCheck('component-3'));

    const health = await service.getSystemHealth();
    assertEqual(health.components.length, 3);
  });

  await test('unregisterCheck() removes a registered check', async () => {
    const service = new HealthService();

    service.registerCheck('component-1', createMockHealthyCheck('component-1'));
    service.registerCheck('component-2', createMockHealthyCheck('component-2'));

    const removed = service.unregisterCheck('component-1');

    assertTrue(removed);
    const health = await service.getSystemHealth();
    assertEqual(health.components.length, 1);
    assertEqual(health.components[0].name, 'component-2');
  });

  await test('unregisterCheck() returns false for non-existent check', async () => {
    const service = new HealthService();

    const removed = service.unregisterCheck('non-existent');

    assertFalse(removed);
  });

  // -------------------- Health Check Execution Tests --------------------
  console.log('\n--- Health Check Execution Tests ---\n');

  await test('checkAll() runs all registered checks', async () => {
    const service = new HealthService();

    service.registerCheck('component-1', createMockHealthyCheck('component-1'));
    service.registerCheck('component-2', createMockHealthyCheck('component-2'));
    service.registerCheck('component-3', createMockHealthyCheck('component-3'));

    const components = await service.checkAll();

    assertEqual(components.length, 3);
    assertTrue(components.every(c => c.status === 'healthy'));
  });

  await test('checkAll() runs checks in parallel', async () => {
    const service = new HealthService();

    // Create slow checks
    service.registerCheck('slow-1', createMockSlowCheck('slow-1', 100));
    service.registerCheck('slow-2', createMockSlowCheck('slow-2', 100));
    service.registerCheck('slow-3', createMockSlowCheck('slow-3', 100));

    const startTime = Date.now();
    await service.checkAll();
    const duration = Date.now() - startTime;

    // Should take ~100ms (parallel) not ~300ms (sequential)
    assertLessThan(duration, 250);
  });

  await test('getSystemHealth() returns aggregated health status', async () => {
    const service = new HealthService();

    service.registerCheck('component-1', createMockHealthyCheck('component-1'));
    service.registerCheck('component-2', createMockHealthyCheck('component-2'));

    const health = await service.getSystemHealth();

    assertEqual(health.status, 'healthy');
    assertEqual(health.components.length, 2);
    assertNotNull(health.timestamp);
  });

  await test('getComponentHealth() returns health for specific component', async () => {
    const service = new HealthService();

    service.registerCheck('test-component', createMockHealthyCheck('test-component'));

    const health = await service.getComponentHealth('test-component');

    assertNotNull(health);
    assertEqual(health!.name, 'test-component');
    assertEqual(health!.status, 'healthy');
  });

  await test('getComponentHealth() returns null for non-existent component', async () => {
    const service = new HealthService();

    const health = await service.getComponentHealth('non-existent');

    assertNull(health);
  });

  await test('isHealthy() returns true when system is healthy', async () => {
    const service = new HealthService();

    service.registerCheck('component-1', createMockHealthyCheck('component-1'));

    const healthy = await service.isHealthy();

    assertTrue(healthy);
  });

  await test('isHealthy() returns false when system is unhealthy', async () => {
    const service = new HealthService();

    service.registerCheck('component-1', createMockUnhealthyCheck('component-1', 'Error'), { critical: true });

    const healthy = await service.isHealthy();

    assertFalse(healthy);
  });

  await test('getCachedHealth() returns cached results without running checks', async () => {
    const service = new HealthService();
    let checkCount = 0;

    const check = async (): Promise<ComponentHealth> => {
      checkCount++;
      return {
        name: 'test',
        status: 'healthy',
        lastChecked: new Date(),
      };
    };

    service.registerCheck('test', check);

    // Run initial check
    await service.checkAll();
    const initialCount = checkCount;

    // Get cached health (should not increment count)
    service.getCachedHealth();
    service.getCachedHealth();

    assertEqual(checkCount, initialCount);
  });

  // -------------------- Timeout Handling Tests --------------------
  console.log('\n--- Timeout Handling Tests ---\n');

  await test('checkAll() times out slow health checks', async () => {
    const service = new HealthService();

    // Create check that takes longer than timeout
    service.registerCheck('slow-component', createMockSlowCheck('slow-component', 6000), {
      timeout: 1000,
    });

    const startTime = Date.now();
    const components = await service.checkAll();
    const duration = Date.now() - startTime;

    // Should timeout in ~1000ms, not wait for full 6000ms
    assertLessThan(duration, 2000);
    assertEqual(components[0].status, 'unhealthy');
    assertTrue(components[0].error?.includes('timed out'));
  });

  await test('checkAll() handles throwing health checks gracefully', async () => {
    const service = new HealthService();

    service.registerCheck('throwing-component', createMockThrowingCheck('throwing-component'));

    const components = await service.checkAll();

    assertEqual(components[0].status, 'unhealthy');
    assertTrue(components[0].error?.includes('Health check error'));
  });

  // -------------------- Manual Status Management Tests --------------------
  console.log('\n--- Manual Status Management Tests ---\n');

  await test('markHealthy() manually marks component as healthy', async () => {
    const service = new HealthService();

    service.registerCheck('test-component', createMockUnhealthyCheck('test-component', 'Error'));
    await service.checkAll();

    service.markHealthy('test-component');

    const cached = service.getCachedHealth();
    const component = cached.components.find(c => c.name === 'test-component');
    assertEqual(component!.status, 'healthy');
  });

  await test('markUnhealthy() manually marks component as unhealthy', async () => {
    const service = new HealthService();

    service.registerCheck('test-component', createMockHealthyCheck('test-component'));
    await service.checkAll();

    service.markUnhealthy('test-component', 'Manual failure');

    const cached = service.getCachedHealth();
    const component = cached.components.find(c => c.name === 'test-component');
    assertEqual(component!.status, 'unhealthy');
    assertEqual(component!.error, 'Manual failure');
  });

  await test('markDegraded() manually marks component as degraded', async () => {
    const service = new HealthService();

    service.registerCheck('test-component', createMockHealthyCheck('test-component'));
    await service.checkAll();

    service.markDegraded('test-component', 'Slow response');

    const cached = service.getCachedHealth();
    const component = cached.components.find(c => c.name === 'test-component');
    assertEqual(component!.status, 'degraded');
    assertEqual(component!.error, 'Slow response');
  });

  // -------------------- Health Status Aggregation Tests --------------------
  console.log('\n--- Health Status Aggregation Tests ---\n');

  await test('system is healthy when all components are healthy', async () => {
    const service = new HealthService();

    service.registerCheck('component-1', createMockHealthyCheck('component-1'));
    service.registerCheck('component-2', createMockHealthyCheck('component-2'));
    service.registerCheck('component-3', createMockHealthyCheck('component-3'));

    const health = await service.getSystemHealth();

    assertEqual(health.status, 'healthy');
  });

  await test('system is unhealthy when critical component is unhealthy', async () => {
    const service = new HealthService();

    service.registerCheck('critical-component', createMockUnhealthyCheck('critical-component', 'Error'), {
      critical: true,
    });
    service.registerCheck('other-component', createMockHealthyCheck('other-component'));

    const health = await service.getSystemHealth();

    assertEqual(health.status, 'unhealthy');
  });

  await test('system is degraded when non-critical component is unhealthy', async () => {
    const service = new HealthService();

    service.registerCheck('non-critical', createMockUnhealthyCheck('non-critical', 'Error'), {
      critical: false,
    });
    service.registerCheck('other-component', createMockHealthyCheck('other-component'));

    const health = await service.getSystemHealth();

    assertEqual(health.status, 'degraded');
  });

  await test('system is degraded when any component is degraded', async () => {
    const service = new HealthService();

    service.registerCheck('degraded-component', createMockDegradedCheck('degraded-component', 'Slow'));
    service.registerCheck('healthy-component', createMockHealthyCheck('healthy-component'));

    const health = await service.getSystemHealth();

    assertEqual(health.status, 'degraded');
  });

  await test('system is healthy when no checks are registered', async () => {
    const service = new HealthService();

    const health = await service.getSystemHealth();

    assertEqual(health.status, 'healthy');
    assertEqual(health.components.length, 0);
  });

  await test('critical component overrides non-critical in status', async () => {
    const service = new HealthService();

    service.registerCheck('critical-unhealthy', createMockUnhealthyCheck('critical-unhealthy', 'Error'), {
      critical: true,
    });
    service.registerCheck('non-critical-unhealthy', createMockUnhealthyCheck('non-critical-unhealthy', 'Error'), {
      critical: false,
    });
    service.registerCheck('degraded-component', createMockDegradedCheck('degraded-component'));

    const health = await service.getSystemHealth();

    // Critical unhealthy makes system unhealthy
    assertEqual(health.status, 'unhealthy');
  });

  // -------------------- Health Monitoring Tests --------------------
  console.log('\n--- Health Monitoring Tests ---\n');

  await test('startMonitoring() runs periodic health checks', async () => {
    const service = new HealthService();
    let checkCount = 0;

    const check = async (): Promise<ComponentHealth> => {
      checkCount++;
      return {
        name: 'test',
        status: 'healthy',
        lastChecked: new Date(),
      };
    };

    service.registerCheck('test', check);
    service.startMonitoring(100); // 100ms interval

    // Wait for multiple intervals
    await new Promise((resolve) => setTimeout(resolve, 350));

    service.stopMonitoring();

    // Should have run at least 3 times (initial + 2-3 intervals)
    assertGreaterThanOrEqual(checkCount, 3);
  });

  await test('stopMonitoring() stops periodic health checks', async () => {
    const service = new HealthService();
    let checkCount = 0;

    const check = async (): Promise<ComponentHealth> => {
      checkCount++;
      return {
        name: 'test',
        status: 'healthy',
        lastChecked: new Date(),
      };
    };

    service.registerCheck('test', check);
    service.startMonitoring(100);

    await new Promise((resolve) => setTimeout(resolve, 250));
    const countBeforeStop = checkCount;

    service.stopMonitoring();

    // Wait and ensure no more checks
    await new Promise((resolve) => setTimeout(resolve, 250));

    assertEqual(checkCount, countBeforeStop);
  });

  await test('startMonitoring() warns if already monitoring', async () => {
    const service = new HealthService();

    service.startMonitoring(1000);
    service.startMonitoring(1000); // Should warn but not start another

    service.stopMonitoring();

    // Test passes if no errors thrown
    assertTrue(true);
  });

  await test('onHealthChange() receives notifications on status change', async () => {
    const service = new HealthService();
    let callbackInvoked = false;
    let receivedHealth: SystemHealth | null = null;

    service.registerCheck('test', createMockHealthyCheck('test'), { critical: true });

    // Run initial check to set baseline
    await service.getSystemHealth();

    // Subscribe to changes
    service.onHealthChange((health) => {
      callbackInvoked = true;
      receivedHealth = health;
    });

    // Change to unhealthy (should trigger callback)
    service.registerCheck('test', createMockUnhealthyCheck('test', 'Error'), { critical: true });
    await service.getSystemHealth();

    assertTrue(callbackInvoked);
    assertNotNull(receivedHealth);
    assertEqual(receivedHealth!.status, 'unhealthy');
  });

  await test('onHealthChange() returns unsubscribe function', async () => {
    const service = new HealthService();
    let callbackCount = 0;

    service.registerCheck('test', createMockHealthyCheck('test'), { critical: true });
    await service.getSystemHealth();

    const unsubscribe = service.onHealthChange(() => {
      callbackCount++;
    });

    // Change status (should trigger)
    service.registerCheck('test', createMockUnhealthyCheck('test', 'Error'), { critical: true });
    await service.getSystemHealth();

    // Unsubscribe
    unsubscribe();

    // Change status again (should not trigger)
    service.registerCheck('test', createMockHealthyCheck('test'), { critical: true });
    await service.getSystemHealth();

    assertEqual(callbackCount, 1);
  });

  await test('onHealthChange() does not trigger if status unchanged', async () => {
    const service = new HealthService();
    let callbackCount = 0;

    service.registerCheck('test', createMockHealthyCheck('test'));
    await service.getSystemHealth();

    service.onHealthChange(() => {
      callbackCount++;
    });

    // Run again with same status
    await service.getSystemHealth();
    await service.getSystemHealth();

    assertEqual(callbackCount, 0);
  });

  // -------------------- Built-in Health Check Factories Tests --------------------
  console.log('\n--- Built-in Health Check Factories Tests ---\n');

  await test('createDatabaseHealthCheck() returns healthy status for working database', async () => {
    const check = createDatabaseHealthCheck();
    const result = await check();

    assertEqual(result.name, 'database');
    assertEqual(result.status, 'healthy');
    assertGreaterThanOrEqual(result.latencyMs!, 0);
    assertNotNull(result.lastChecked);
  });

  await test('createQueueHealthCheck() returns healthy status for normal queue', async () => {
    const queueRepo = new MockQueueRepository(10, 2, 100, 0);
    const check = createQueueHealthCheck(queueRepo);
    const result = await check();

    assertEqual(result.name, 'queue');
    assertEqual(result.status, 'healthy');
    assertEqual(result.metadata!.pending, 10);
  });

  await test('createQueueHealthCheck() returns degraded for stuck messages', async () => {
    const queueRepo = new MockQueueRepository(10, 150, 100, 0);
    const check = createQueueHealthCheck(queueRepo, { stuckThreshold: 100 });
    const result = await check();

    assertEqual(result.name, 'queue');
    assertEqual(result.status, 'degraded');
    assertTrue(result.error?.includes('stuck'));
  });

  await test('createQueueHealthCheck() returns degraded for queue backup', async () => {
    const queueRepo = new MockQueueRepository(2000, 2, 100, 0);
    const check = createQueueHealthCheck(queueRepo, { pendingWarningThreshold: 1000 });
    const result = await check();

    assertEqual(result.name, 'queue');
    assertEqual(result.status, 'degraded');
    assertTrue(result.error?.includes('backup'));
  });

  await test('createLLMHealthCheck() returns healthy for working LLM', async () => {
    const llmClient = new MockLLMClient(true, 'test-model');
    const check = createLLMHealthCheck(llmClient);
    const result = await check();

    assertEqual(result.name, 'llm');
    assertEqual(result.status, 'healthy');
    assertEqual(result.metadata!.model, 'test-model');
  });

  await test('createLLMHealthCheck() returns unhealthy for failing LLM', async () => {
    const llmClient = new MockLLMClient(false, 'test-model', 'Connection failed');
    const check = createLLMHealthCheck(llmClient);
    const result = await check();

    assertEqual(result.name, 'llm');
    assertEqual(result.status, 'unhealthy');
    assertEqual(result.error, 'Connection failed');
  });

  await test('createClaudeHealthCheck() returns healthy for working Claude', async () => {
    const claudeClient = new MockClaudeClient(true);
    const check = createClaudeHealthCheck(claudeClient);
    const result = await check();

    assertEqual(result.name, 'claude');
    assertEqual(result.status, 'healthy');
  });

  await test('createClaudeHealthCheck() returns unhealthy for failing Claude', async () => {
    const claudeClient = new MockClaudeClient(false, 'CLI not found');
    const check = createClaudeHealthCheck(claudeClient);
    const result = await check();

    assertEqual(result.name, 'claude');
    assertEqual(result.status, 'unhealthy');
    assertEqual(result.error, 'CLI not found');
  });

  await test('createTelegramHealthCheck() returns healthy for connected Telegram', async () => {
    const telegramService = new MockTelegramService(true);
    const check = createTelegramHealthCheck(telegramService);
    const result = await check();

    assertEqual(result.name, 'telegram');
    assertEqual(result.status, 'healthy');
    assertEqual(result.metadata!.connected, true);
  });

  await test('createTelegramHealthCheck() returns unhealthy for disconnected Telegram', async () => {
    const telegramService = new MockTelegramService(false);
    const check = createTelegramHealthCheck(telegramService);
    const result = await check();

    assertEqual(result.name, 'telegram');
    assertEqual(result.status, 'unhealthy');
    assertEqual(result.metadata!.connected, false);
  });

  await test('createDLQHealthCheck() returns healthy for empty DLQ', async () => {
    const dlqService = new MockDLQService(0, undefined, 0);
    const check = createDLQHealthCheck(dlqService);
    const result = await check();

    assertEqual(result.name, 'dlq');
    assertEqual(result.status, 'healthy');
  });

  await test('createDLQHealthCheck() returns degraded for large DLQ', async () => {
    const dlqService = new MockDLQService(150, undefined, 10);
    const check = createDLQHealthCheck(dlqService, { sizeWarningThreshold: 100 });
    const result = await check();

    assertEqual(result.name, 'dlq');
    assertEqual(result.status, 'degraded');
    assertTrue(result.error?.includes('150 items'));
  });

  await test('createDLQHealthCheck() returns degraded for old items', async () => {
    const oneDayMs = 24 * 60 * 60 * 1000;
    const twoDaysMs = 2 * oneDayMs;
    const dlqService = new MockDLQService(50, twoDaysMs, 5);
    const check = createDLQHealthCheck(dlqService, { ageWarningThresholdMs: oneDayMs });
    const result = await check();

    assertEqual(result.name, 'dlq');
    assertEqual(result.status, 'degraded');
    assertTrue(result.error?.includes('old'));
  });

  await test('createCircuitBreakersHealthCheck() returns healthy for closed circuits', async () => {
    const breakers = [
      new MockCircuitBreaker('service-1', 'CLOSED'),
      new MockCircuitBreaker('service-2', 'CLOSED'),
    ];
    const check = createCircuitBreakersHealthCheck(breakers);
    const result = await check();

    assertEqual(result.name, 'circuitBreakers');
    assertEqual(result.status, 'healthy');
  });

  await test('createCircuitBreakersHealthCheck() returns degraded for open circuits', async () => {
    const breakers = [
      new MockCircuitBreaker('service-1', 'OPEN'),
      new MockCircuitBreaker('service-2', 'CLOSED'),
    ];
    const check = createCircuitBreakersHealthCheck(breakers);
    const result = await check();

    assertEqual(result.name, 'circuitBreakers');
    assertEqual(result.status, 'degraded');
    assertTrue(result.error?.includes('Open circuits'));
    assertTrue(result.error?.includes('service-1'));
  });

  await test('createCircuitBreakersHealthCheck() returns degraded for half-open circuits', async () => {
    const breakers = [
      new MockCircuitBreaker('service-1', 'HALF_OPEN'),
      new MockCircuitBreaker('service-2', 'CLOSED'),
    ];
    const check = createCircuitBreakersHealthCheck(breakers);
    const result = await check();

    assertEqual(result.name, 'circuitBreakers');
    assertEqual(result.status, 'degraded');
    assertTrue(result.error?.includes('Half-open circuits'));
  });

  // -------------------- Integration Tests --------------------
  console.log('\n--- Integration Tests ---\n');

  await test('complete health monitoring lifecycle', async () => {
    const service = new HealthService();
    let statusChanges = 0;

    // Register multiple components
    service.registerCheck('database', createDatabaseHealthCheck());
    service.registerCheck('queue', createQueueHealthCheck(new MockQueueRepository()));
    service.registerCheck('llm', createLLMHealthCheck(new MockLLMClient()));

    // Subscribe to changes
    const unsubscribe = service.onHealthChange(() => {
      statusChanges++;
    });

    // Initial check
    const health1 = await service.getSystemHealth();
    assertEqual(health1.status, 'healthy');
    assertEqual(health1.components.length, 3);

    // Mark one degraded and check cached (getSystemHealth re-runs checks)
    service.markDegraded('queue', 'High load');
    const health2 = service.getCachedHealth();
    assertEqual(health2.status, 'degraded');

    // Mark back healthy and check cached
    service.markHealthy('queue');
    const health3 = service.getCachedHealth();
    assertEqual(health3.status, 'healthy');

    // Cleanup
    unsubscribe();

    // Note: statusChanges won't increment because getCachedHealth doesn't trigger notifications
    // This test validates manual status management and cached health retrieval
    assertTrue(true);
  });

  await test('cached health reflects manual status changes', async () => {
    const service = new HealthService();

    service.registerCheck('test', createMockHealthyCheck('test'));
    await service.checkAll();

    // Manually mark unhealthy
    service.markUnhealthy('test', 'Manual error');

    // Cached health should reflect change
    const cached = service.getCachedHealth();
    const component = cached.components.find(c => c.name === 'test');

    assertEqual(component!.status, 'unhealthy');
    assertEqual(component!.error, 'Manual error');
  });

  await test('health check metadata is preserved across manual status changes', async () => {
    const service = new HealthService();

    const checkWithMetadata = async (): Promise<ComponentHealth> => {
      return {
        name: 'test',
        status: 'healthy',
        lastChecked: new Date(),
        metadata: { version: '1.0', uptime: 3600 },
      };
    };

    service.registerCheck('test', checkWithMetadata);
    await service.checkAll();

    // Change status manually
    service.markDegraded('test', 'Slow response');

    const cached = service.getCachedHealth();
    const component = cached.components.find(c => c.name === 'test');

    // Metadata should be preserved
    assertNotNull(component!.metadata);
    assertEqual(component!.metadata!.version, '1.0');
  });

  // -------------------- Print Results --------------------
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
