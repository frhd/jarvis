/**
 * Recovery Service Tests
 *
 * Behavior-focused tests for RecoveryService which handles automatic recovery
 * from service failures with configurable strategies, cooldown/backoff logic,
 * recovery history/statistics, and event notifications.
 *
 * Run: npx vitest run src/services/recovery.service.test.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================================
// Mocks (declared BEFORE importing the module under test)
// ============================================================================

vi.mock('../utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import {
  RecoveryService,
  RecoveryError,
  RecoveryStrategy,
  RecoveryAction,
} from './recovery.service.js';

// ============================================================================
// Helpers
// ============================================================================

async function flushPromises() {
  await vi.advanceTimersByTimeAsync(0);
}

function makeStrategy(overrides: Partial<RecoveryStrategy> = {}): RecoveryStrategy {
  return {
    service: 'svc',
    action: 'retry',
    condition: () => true,
    maxAttempts: 3,
    cooldownMs: 1000,
    ...overrides,
  };
}

describe('RecoveryService', () => {
  let svc: RecoveryService;

  beforeEach(() => {
    vi.useFakeTimers();
    svc = new RecoveryService();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // --------------------------------------------------------------------------
  // Default strategy registration
  // --------------------------------------------------------------------------

  describe('default strategies', () => {
    it('registers built-in strategies for core services', () => {
      const services = svc.getRegisteredServices();
      expect(services).toEqual(
        expect.arrayContaining(['database', 'telegram', 'ollama', 'claude', 'queue', 'circuitBreaker'])
      );
    });

    it('registers multiple strategies for telegram (reconnect + restart)', () => {
      const strategies = svc.getStrategies('telegram');
      expect(strategies.length).toBe(2);
      const actions = strategies.map((s) => s.action);
      expect(actions).toContain('reconnect');
      expect(actions).toContain('restart');
    });

    it('returns empty array for unknown service strategies', () => {
      expect(svc.getStrategies('does-not-exist')).toEqual([]);
    });
  });

  // --------------------------------------------------------------------------
  // registerStrategy
  // --------------------------------------------------------------------------

  describe('registerStrategy', () => {
    it('adds a strategy and initializes service state', () => {
      svc.registerStrategy('myService', makeStrategy({ service: 'myService' }));
      expect(svc.getStrategies('myService').length).toBe(1);
      const state = svc.getServiceState('myService');
      expect(state).toBeDefined();
      expect(state?.isRecovering).toBe(false);
      expect(state?.currentAttempts).toBe(0);
    });

    it('appends multiple strategies to the same service', () => {
      svc.registerStrategy('myService', makeStrategy({ service: 'myService', action: 'retry' }));
      svc.registerStrategy('myService', makeStrategy({ service: 'myService', action: 'restart' }));
      expect(svc.getStrategies('myService').length).toBe(2);
    });
  });

  // --------------------------------------------------------------------------
  // attemptRecovery - happy path
  // --------------------------------------------------------------------------

  describe('attemptRecovery success', () => {
    it('runs the matching strategy handler and returns a success result', async () => {
      const handler = vi.fn().mockResolvedValue(true);
      svc.registerStrategy('svc', makeStrategy({ handler }));

      const result = await svc.attemptRecovery('svc', new Error('boom'));

      expect(handler).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(true);
      expect(result.action).toBe('retry');
    });

    it('resets attempts and clears cooldown after a successful recovery', async () => {
      svc.registerStrategy('svc', makeStrategy({ handler: vi.fn().mockResolvedValue(true) }));

      await svc.attemptRecovery('svc', new Error('boom'));

      const state = svc.getServiceState('svc');
      expect(state?.currentAttempts).toBe(0);
      expect(state?.consecutiveFailures).toBe(0);
      expect(state?.cooldownUntil).toBeUndefined();
      expect(state?.lastRecoveryAt).toBeInstanceOf(Date);
    });

    it('records the recovery in history', async () => {
      svc.registerStrategy('svc', makeStrategy({ handler: vi.fn().mockResolvedValue(true) }));
      await svc.attemptRecovery('svc', new Error('boom'));

      const history = svc.getRecoveryHistory('svc');
      expect(history.length).toBe(1);
      expect(history[0].service).toBe('svc');
      expect(history[0].success).toBe(true);
    });

    it('clears isRecovering flag after completion', async () => {
      svc.registerStrategy('svc', makeStrategy({ handler: vi.fn().mockResolvedValue(true) }));
      await svc.attemptRecovery('svc', new Error('boom'));
      expect(svc.isRecovering('svc')).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // attemptRecovery - no matching strategy
  // --------------------------------------------------------------------------

  describe('attemptRecovery no strategy', () => {
    it('escalates when no strategy condition matches', async () => {
      svc.registerStrategy('svc', makeStrategy({ condition: () => false }));
      const result = await svc.attemptRecovery('svc', new Error('nomatch'));
      expect(result.success).toBe(false);
      expect(result.action).toBe('escalate');
      expect(result.error).toBe('No matching recovery strategy');
    });

    it('escalates when the service has no registered strategies', async () => {
      const result = await svc.attemptRecovery('unregistered', new Error('x'));
      expect(result.action).toBe('escalate');
    });
  });

  // --------------------------------------------------------------------------
  // attemptRecovery - failure paths
  // --------------------------------------------------------------------------

  describe('attemptRecovery failure', () => {
    it('returns failure when handler resolves false and applies cooldown', async () => {
      svc.registerStrategy('svc', makeStrategy({ handler: vi.fn().mockResolvedValue(false) }));

      const result = await svc.attemptRecovery('svc', new Error('boom'));

      expect(result.success).toBe(false);
      const state = svc.getServiceState('svc');
      expect(state?.consecutiveFailures).toBe(1);
      expect(state?.cooldownUntil).toBeInstanceOf(Date);
    });

    it('returns failure with the thrown error message when handler throws', async () => {
      svc.registerStrategy(
        'svc',
        makeStrategy({ handler: vi.fn().mockRejectedValue(new Error('handler exploded')) })
      );

      const result = await svc.attemptRecovery('svc', new Error('boom'));

      expect(result.success).toBe(false);
      expect(result.error).toContain('handler exploded');
    });

    it('records failed recovery in history', async () => {
      svc.registerStrategy('svc', makeStrategy({ handler: vi.fn().mockResolvedValue(false) }));
      await svc.attemptRecovery('svc', new Error('boom'));
      const history = svc.getRecoveryHistory('svc');
      expect(history[0].success).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // Cooldown behavior
  // --------------------------------------------------------------------------

  describe('cooldown', () => {
    it('blocks recovery while in cooldown, then allows it after cooldown elapses', async () => {
      const handler = vi
        .fn()
        .mockResolvedValueOnce(false) // first attempt fails -> triggers cooldown
        .mockResolvedValue(true); // subsequent succeeds
      svc.registerStrategy('svc', makeStrategy({ cooldownMs: 1000, handler }));

      // First attempt fails and enters cooldown
      await svc.attemptRecovery('svc', new Error('boom'));

      // While in cooldown -> blocked
      const blocked = await svc.attemptRecovery('svc', new Error('boom'));
      expect(blocked.error).toMatch(/cooldown/i);

      // Advance past cooldown
      await vi.advanceTimersByTimeAsync(1001);

      const allowed = await svc.attemptRecovery('svc', new Error('boom'));
      expect(allowed.success).toBe(true);
    });

    it('applies exponential backoff growth across consecutive failures', async () => {
      svc.registerStrategy(
        'svc',
        makeStrategy({ maxAttempts: 10, cooldownMs: 1000, handler: vi.fn().mockResolvedValue(false) })
      );

      await svc.attemptRecovery('svc', new Error('boom'));
      let state = svc.getServiceState('svc');
      const firstRemaining = state!.cooldownUntil!.getTime() - Date.now();
      expect(firstRemaining).toBe(1000); // base * multiplier^0

      await vi.advanceTimersByTimeAsync(1001);

      await svc.attemptRecovery('svc', new Error('boom'));
      state = svc.getServiceState('svc');
      const secondRemaining = state!.cooldownUntil!.getTime() - Date.now();
      expect(secondRemaining).toBe(2000); // base * multiplier^1
    });

    it('caps cooldown at the maximum during repeated failures', async () => {
      svc.registerStrategy(
        'svc',
        makeStrategy({ maxAttempts: 100, cooldownMs: 1000, handler: vi.fn().mockResolvedValue(false) })
      );

      const MAX_COOLDOWN_MS = 300000;
      for (let i = 0; i < 15; i++) {
        await svc.attemptRecovery('svc', new Error('boom'));
        const state = svc.getServiceState('svc');
        const remaining = state!.cooldownUntil!.getTime() - Date.now();
        expect(remaining).toBeLessThanOrEqual(MAX_COOLDOWN_MS);
        await vi.advanceTimersByTimeAsync(MAX_COOLDOWN_MS + 1);
      }

      const state = svc.getServiceState('svc');
      // After many failures the computed cooldown exceeds the cap and is clamped
      // (the clamped value is applied against the last attempt time).
      expect(state!.consecutiveFailures).toBe(15);
    });
  });

  // --------------------------------------------------------------------------
  // Concurrency guard
  // --------------------------------------------------------------------------

  describe('concurrent recovery', () => {
    it('rejects a second recovery while one is already in progress', async () => {
      let resolveHandler: (v: boolean) => void = () => {};
      const handler = vi.fn(
        () =>
          new Promise<boolean>((resolve) => {
            resolveHandler = resolve;
          })
      );
      svc.registerStrategy('svc', makeStrategy({ handler }));

      const first = svc.attemptRecovery('svc', new Error('boom'));
      await flushPromises();
      expect(svc.isRecovering('svc')).toBe(true);

      const second = await svc.attemptRecovery('svc', new Error('boom'));
      expect(second.error).toBe('Recovery already in progress');

      resolveHandler(true);
      const firstResult = await first;
      expect(firstResult.success).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Max attempts / fallback
  // --------------------------------------------------------------------------

  describe('max attempts', () => {
    it('escalates and applies cooldown when max attempts reached without a fallback', async () => {
      svc.registerStrategy(
        'svc',
        makeStrategy({ maxAttempts: 1, cooldownMs: 1000, handler: vi.fn().mockResolvedValue(false) })
      );

      // Attempt 1 -> fails, currentAttempts becomes 1
      await svc.attemptRecovery('svc', new Error('boom'));
      await vi.advanceTimersByTimeAsync(1001); // clear cooldown

      // Attempt 2 -> currentAttempts(1) >= maxAttempts(1)
      const result = await svc.attemptRecovery('svc', new Error('boom'));
      expect(result.action).toBe('escalate');
      expect(result.error).toBe('Max recovery attempts exceeded');
    });

    it('invokes fallback handler when max attempts reached and fallback is configured', async () => {
      const fallbackHandler = vi.fn().mockResolvedValue(true);
      svc.registerStrategy(
        'svc',
        makeStrategy({
          maxAttempts: 1,
          cooldownMs: 1000,
          handler: vi.fn().mockResolvedValue(false),
          fallbackHandler,
        })
      );

      await svc.attemptRecovery('svc', new Error('boom'));
      await vi.advanceTimersByTimeAsync(1001);

      const result = await svc.attemptRecovery('svc', new Error('boom'));
      expect(fallbackHandler).toHaveBeenCalledTimes(1);
      expect(result.action).toBe('fallback');
      expect(result.success).toBe(true);
    });

    it('records fallback failure result when fallback handler throws', async () => {
      const fallbackHandler = vi.fn().mockRejectedValue(new Error('fallback failed'));
      svc.registerStrategy(
        'svc',
        makeStrategy({
          maxAttempts: 1,
          cooldownMs: 1000,
          handler: vi.fn().mockResolvedValue(false),
          fallbackHandler,
        })
      );

      await svc.attemptRecovery('svc', new Error('boom'));
      await vi.advanceTimersByTimeAsync(1001);

      const result = await svc.attemptRecovery('svc', new Error('boom'));
      expect(result.action).toBe('fallback');
      expect(result.success).toBe(false);
      expect(result.error).toContain('fallback failed');
    });
  });

  // --------------------------------------------------------------------------
  // Default recovery behaviors (no handler)
  // --------------------------------------------------------------------------

  describe('default recovery behavior', () => {
    it('retry action without a handler waits and signals success', async () => {
      svc.registerStrategy('svc', makeStrategy({ action: 'retry' }));
      const p = svc.attemptRecovery('svc', new Error('boom'));
      await vi.advanceTimersByTimeAsync(1000); // RETRY_COOLDOWN_MS
      const result = await p;
      expect(result.success).toBe(true);
      expect(result.action).toBe('retry');
    });

    it('reconnect action without a handler waits and signals success', async () => {
      svc.registerStrategy('svc', makeStrategy({ action: 'reconnect' }));
      const p = svc.attemptRecovery('svc', new Error('boom'));
      await vi.advanceTimersByTimeAsync(2000); // RECONNECT_COOLDOWN_MS
      const result = await p;
      expect(result.success).toBe(true);
    });

    it('restart action without a handler fails (requires custom handler)', async () => {
      svc.registerStrategy('svc', makeStrategy({ action: 'restart' }));
      const result = await svc.attemptRecovery('svc', new Error('boom'));
      expect(result.success).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // Statistics
  // --------------------------------------------------------------------------

  describe('getRecoveryStats', () => {
    it('aggregates successes, failures, success rate and per-action counts', async () => {
      svc.registerStrategy('a', makeStrategy({ service: 'a', action: 'retry', handler: vi.fn().mockResolvedValue(true) }));
      svc.registerStrategy('b', makeStrategy({ service: 'b', action: 'reconnect', handler: vi.fn().mockResolvedValue(false) }));

      await svc.attemptRecovery('a', new Error('x')); // success retry
      await svc.attemptRecovery('b', new Error('x')); // failure reconnect

      const stats = svc.getRecoveryStats();
      expect(stats.totalRecoveries).toBe(2);
      expect(stats.successfulRecoveries).toBe(1);
      expect(stats.failedRecoveries).toBe(1);
      expect(stats.successRate).toBe(0.5);
      expect(stats.byAction.retry).toBe(1);
      expect(stats.byAction.reconnect).toBe(1);
      expect(stats.byService.a.successful).toBe(1);
      expect(stats.byService.b.failed).toBe(1);
    });

    it('returns zeroed stats when no history exists', () => {
      const stats = svc.getRecoveryStats();
      expect(stats.totalRecoveries).toBe(0);
      expect(stats.successRate).toBe(0);
      expect(stats.averageDuration).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // History management
  // --------------------------------------------------------------------------

  describe('history', () => {
    it('filters history by service and returns all when no filter given', async () => {
      svc.registerStrategy('a', makeStrategy({ service: 'a', handler: vi.fn().mockResolvedValue(true) }));
      svc.registerStrategy('b', makeStrategy({ service: 'b', handler: vi.fn().mockResolvedValue(true) }));
      await svc.attemptRecovery('a', new Error('x'));
      await svc.attemptRecovery('b', new Error('x'));

      expect(svc.getRecoveryHistory('a').length).toBe(1);
      expect(svc.getRecoveryHistory().length).toBe(2);
    });

    it('clears history', async () => {
      svc.registerStrategy('a', makeStrategy({ service: 'a', handler: vi.fn().mockResolvedValue(true) }));
      await svc.attemptRecovery('a', new Error('x'));
      svc.clearHistory();
      expect(svc.getRecoveryHistory().length).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // Auto-recovery + health degradation
  // --------------------------------------------------------------------------

  describe('auto-recovery', () => {
    it('enables and disables auto-recovery for a service', () => {
      expect(svc.isAutoRecoveryEnabled('svc')).toBe(false);
      svc.enableAutoRecovery('svc');
      expect(svc.isAutoRecoveryEnabled('svc')).toBe(true);
      svc.disableAutoRecovery('svc');
      expect(svc.isAutoRecoveryEnabled('svc')).toBe(false);
    });

    it('handleHealthDegradation returns null when auto-recovery is disabled', async () => {
      const result = await svc.handleHealthDegradation('svc');
      expect(result).toBeNull();
    });

    it('handleHealthDegradation attempts recovery when auto-recovery is enabled', async () => {
      const handler = vi.fn().mockResolvedValue(true);
      svc.registerStrategy('svc', makeStrategy({ handler }));
      svc.enableAutoRecovery('svc');

      const result = await svc.handleHealthDegradation('svc', new Error('boom'));
      expect(handler).toHaveBeenCalled();
      expect(result?.success).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // State reset
  // --------------------------------------------------------------------------

  describe('resetServiceState', () => {
    it('clears accumulated failure state', async () => {
      svc.registerStrategy('svc', makeStrategy({ handler: vi.fn().mockResolvedValue(false) }));
      await svc.attemptRecovery('svc', new Error('boom'));
      expect(svc.getServiceState('svc')?.consecutiveFailures).toBe(1);

      svc.resetServiceState('svc');
      const state = svc.getServiceState('svc');
      expect(state?.consecutiveFailures).toBe(0);
      expect(state?.currentAttempts).toBe(0);
      expect(state?.cooldownUntil).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // Event callbacks
  // --------------------------------------------------------------------------

  describe('event callbacks', () => {
    it('notifies start, complete and health callbacks on successful recovery', async () => {
      svc.registerStrategy('svc', makeStrategy({ handler: vi.fn().mockResolvedValue(true) }));
      const onStart = vi.fn();
      const onComplete = vi.fn();
      const onHealth = vi.fn();
      svc.onRecoveryStart(onStart);
      svc.onRecoveryComplete(onComplete);
      svc.onHealthStatus(onHealth);

      await svc.attemptRecovery('svc', new Error('boom'));

      expect(onStart).toHaveBeenCalledWith('svc', 'retry');
      expect(onComplete).toHaveBeenCalledWith('svc', expect.objectContaining({ success: true }));
      expect(onHealth).toHaveBeenCalledWith('svc', true);
    });

    it('unsubscribe stops further notifications', async () => {
      svc.registerStrategy('svc', makeStrategy({ handler: vi.fn().mockResolvedValue(true) }));
      const onStart = vi.fn();
      const unsubscribe = svc.onRecoveryStart(onStart);
      unsubscribe();

      await svc.attemptRecovery('svc', new Error('boom'));
      expect(onStart).not.toHaveBeenCalled();
    });

    it('isolates callback errors so recovery still succeeds', async () => {
      svc.registerStrategy('svc', makeStrategy({ handler: vi.fn().mockResolvedValue(true) }));
      svc.onRecoveryStart(() => {
        throw new Error('callback boom');
      });

      const result = await svc.attemptRecovery('svc', new Error('boom'));
      expect(result.success).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Custom handler setters
  // --------------------------------------------------------------------------

  describe('handler setters', () => {
    it('setRecoveryHandler attaches a handler to a matching action', async () => {
      svc.registerStrategy('svc', makeStrategy({ action: 'retry' }));
      const handler = vi.fn().mockResolvedValue(true);
      svc.setRecoveryHandler('svc', 'retry', handler);

      const result = await svc.attemptRecovery('svc', new Error('boom'));
      expect(handler).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it('setRecoveryHandler is a no-op when no matching action exists', () => {
      svc.registerStrategy('svc', makeStrategy({ action: 'retry' }));
      expect(() => svc.setRecoveryHandler('svc', 'restart', vi.fn())).not.toThrow();
    });

    it('setFallbackHandler applies the fallback to every strategy of a service', async () => {
      svc.registerStrategy('svc', makeStrategy({ action: 'retry', maxAttempts: 1, handler: vi.fn().mockResolvedValue(false) }));
      const fallback = vi.fn().mockResolvedValue(true);
      svc.setFallbackHandler('svc', fallback);

      await svc.attemptRecovery('svc', new Error('boom'));
      await vi.advanceTimersByTimeAsync(2000);
      const result = await svc.attemptRecovery('svc', new Error('boom'));

      expect(fallback).toHaveBeenCalled();
      expect(result.action).toBe('fallback');
    });
  });

  // --------------------------------------------------------------------------
  // RecoveryError
  // --------------------------------------------------------------------------

  describe('RecoveryError', () => {
    it('carries service and code metadata', () => {
      const err = new RecoveryError('failed', 'database', 'CUSTOM_CODE');
      expect(err.name).toBe('RecoveryError');
      expect(err.service).toBe('database');
      expect(err.code).toBe('CUSTOM_CODE');
    });

    it('defaults code to RECOVERY_ERROR', () => {
      const err = new RecoveryError('failed', 'database');
      expect(err.code).toBe('RECOVERY_ERROR');
    });
  });
});
