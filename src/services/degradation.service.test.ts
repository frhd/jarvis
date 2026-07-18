/**
 * Degradation Service Tests
 *
 * Behavior-focused tests for DegradationService which manages service fallbacks
 * and degraded operation modes: fallback selection/execution, degradation level
 * transitions, auto-recovery checks, health-driven degradation, and reporting.
 *
 * Run: npx vitest run src/services/degradation.service.test.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

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
  DegradationService,
  ServiceHealth,
  SystemHealth,
  DegradationEvent,
} from './degradation.service.js';

describe('DegradationService', () => {
  let svc: DegradationService;

  beforeEach(() => {
    vi.useFakeTimers();
    svc = new DegradationService();
  });

  afterEach(async () => {
    await svc.shutdown();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // --------------------------------------------------------------------------
  // Default strategies
  // --------------------------------------------------------------------------

  describe('default strategies', () => {
    it('registers built-in fallback strategies for core services', () => {
      expect(svc.getServiceStats('ollama').length).toBe(1);
      expect(svc.getServiceStats('claude').length).toBe(1);
      expect(svc.getServiceStats('llm').length).toBe(1);
      expect(svc.getServiceStats('embedding').length).toBe(1);
      expect(svc.getServiceStats('queue').length).toBe(2);
      expect(svc.getServiceStats('database').length).toBe(2);
    });

    it('starts every service at degradation level none', () => {
      expect(svc.getDegradationLevel('ollama')).toBe('none');
      expect(svc.getDegradationLevel('database')).toBe('none');
    });
  });

  // --------------------------------------------------------------------------
  // registerFallback / removeFallback
  // --------------------------------------------------------------------------

  describe('registerFallback', () => {
    it('registers a new strategy and initializes its stats', () => {
      svc.registerFallback('custom', {
        id: 'strat-1',
        fallbackFn: async () => 'ok',
      });
      const stats = svc.getServiceStats('custom');
      expect(stats.length).toBe(1);
      expect(stats[0].strategyId).toBe('strat-1');
      expect(stats[0].totalExecutions).toBe(0);
    });

    it('sorts strategies by ascending priority', () => {
      svc.registerFallback('custom', { id: 'low', fallbackFn: async () => 1, priority: 50 });
      svc.registerFallback('custom', { id: 'high', fallbackFn: async () => 2, priority: 5 });

      const report = svc.getDegradationReport();
      const custom = report.services.find((s) => s.service === 'custom')!;
      expect(custom.strategies[0].id).toBe('high'); // lower number = higher priority
      expect(custom.strategies[1].id).toBe('low');
    });

    it('replaces an existing strategy with the same id', () => {
      svc.registerFallback('custom', { id: 'strat', fallbackFn: async () => 'v1', description: 'first' });
      svc.registerFallback('custom', { id: 'strat', fallbackFn: async () => 'v2', description: 'second' });

      const report = svc.getDegradationReport();
      const custom = report.services.find((s) => s.service === 'custom')!;
      expect(custom.strategies.length).toBe(1);
      expect(custom.strategies[0].description).toBe('second');
    });
  });

  describe('removeFallback', () => {
    it('removes a registered strategy and returns true', () => {
      svc.registerFallback('custom', { id: 'strat', fallbackFn: async () => 'ok' });
      expect(svc.removeFallback('custom', 'strat')).toBe(true);
      expect(svc.getServiceStats('custom').length).toBe(0);
    });

    it('returns false for unknown service or strategy', () => {
      expect(svc.removeFallback('nope', 'strat')).toBe(false);
      svc.registerFallback('custom', { id: 'strat', fallbackFn: async () => 'ok' });
      expect(svc.removeFallback('custom', 'other')).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // executeFallback
  // --------------------------------------------------------------------------

  describe('executeFallback', () => {
    it('returns the primary result when the primary function succeeds', async () => {
      const primary = vi.fn().mockResolvedValue('primary-result');
      const result = await svc.executeFallback('custom', primary, { foo: 'bar' });
      expect(result).toBe('primary-result');
      expect(primary).toHaveBeenCalledWith({ foo: 'bar' });
    });

    it('falls back when the primary function throws', async () => {
      svc.registerFallback('custom', {
        id: 'fb',
        fallbackFn: async () => 'fallback-result',
        condition: () => true,
      });
      const primary = vi.fn().mockRejectedValue(new Error('primary down'));

      const result = await svc.executeFallback('custom', primary, {});
      expect(result).toBe('fallback-result');
    });

    it('uses the fallback directly without calling the primary when fully degraded', async () => {
      svc.registerFallback('custom', {
        id: 'fb',
        fallbackFn: async () => 'fallback-result',
        condition: () => true,
      });
      svc.setDegradationLevel('custom', 'full');

      const primary = vi.fn().mockResolvedValue('primary-result');
      const result = await svc.executeFallback('custom', primary, {});

      expect(primary).not.toHaveBeenCalled();
      expect(result).toBe('fallback-result');
    });

    it('skips strategies whose condition is not met and uses the next matching one', async () => {
      svc.registerFallback('custom', {
        id: 'skip',
        fallbackFn: async () => 'skipped',
        condition: () => false,
        priority: 1,
      });
      svc.registerFallback('custom', {
        id: 'use',
        fallbackFn: async () => 'used',
        condition: () => true,
        priority: 2,
      });
      const primary = vi.fn().mockRejectedValue(new Error('down'));

      const result = await svc.executeFallback('custom', primary, {});
      expect(result).toBe('used');
    });

    it('rethrows the original error when no strategies are registered', async () => {
      const primary = vi.fn().mockRejectedValue(new Error('original failure'));
      await expect(svc.executeFallback('bare', primary, {})).rejects.toThrow('original failure');
    });

    it('throws a graceful error when all fallbacks fail', async () => {
      svc.registerFallback('llm-worker', {
        id: 'always-fail',
        fallbackFn: async () => {
          throw new Error('fallback boom');
        },
        condition: () => true,
      });
      const primary = vi.fn().mockRejectedValue(new Error('down'));

      // 'llm-worker' resolves its base service 'llm' graceful message
      await expect(svc.executeFallback('llm-worker', primary, {})).rejects.toThrow(
        /having trouble processing/i
      );
    });
  });

  // --------------------------------------------------------------------------
  // Fallback statistics
  // --------------------------------------------------------------------------

  describe('fallback statistics', () => {
    it('records successful fallback executions', async () => {
      svc.registerFallback('custom', { id: 'fb', fallbackFn: async () => 'ok', condition: () => true });
      await svc.executeFallback('custom', vi.fn().mockRejectedValue(new Error('down')), {});

      const stats = svc.getServiceStats('custom').find((s) => s.strategyId === 'fb')!;
      expect(stats.totalExecutions).toBe(1);
      expect(stats.successfulExecutions).toBe(1);
      expect(stats.failedExecutions).toBe(0);
      expect(stats.lastExecutedAt).toBeInstanceOf(Date);
    });

    it('records failed fallback executions', async () => {
      svc.registerFallback('custom', {
        id: 'fb',
        fallbackFn: async () => {
          throw new Error('nope');
        },
        condition: () => true,
      });
      await expect(
        svc.executeFallback('custom', vi.fn().mockRejectedValue(new Error('down')), {})
      ).rejects.toThrow();

      const stats = svc.getServiceStats('custom').find((s) => s.strategyId === 'fb')!;
      expect(stats.totalExecutions).toBe(1);
      expect(stats.failedExecutions).toBe(1);
    });

    it('exposes aggregate stats through getFallbackStats', () => {
      const all = svc.getFallbackStats();
      expect(all.has('ollama')).toBe(true);
      expect(all.get('queue')!.length).toBe(2);
    });
  });

  // --------------------------------------------------------------------------
  // Degradation level transitions
  // --------------------------------------------------------------------------

  describe('setDegradationLevel', () => {
    it('emits a degradation event with previous and new levels', () => {
      const events: DegradationEvent[] = [];
      svc.on('degradation', (e: DegradationEvent) => events.push(e));

      svc.setDegradationLevel('custom', 'partial', 'test reason');

      expect(events.length).toBe(1);
      expect(events[0].previousLevel).toBe('none');
      expect(events[0].newLevel).toBe('partial');
      expect(events[0].reason).toBe('test reason');
    });

    it('does not emit when the level is unchanged', () => {
      svc.setDegradationLevel('custom', 'partial');
      const events: DegradationEvent[] = [];
      svc.on('degradation', (e: DegradationEvent) => events.push(e));

      svc.setDegradationLevel('custom', 'partial');
      expect(events.length).toBe(0);
    });

    it('resets recovery check counters on level change', () => {
      svc.setDegradationLevel('custom', 'partial');
      const report = svc.getDegradationReport();
      const custom = report.services.find((s) => s.service === 'custom')!;
      expect(custom.recoveryChecks.consecutive).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // Auto-recovery
  // --------------------------------------------------------------------------

  describe('auto-recovery', () => {
    it('starts periodic recovery checks and returns to none after the threshold', async () => {
      // Default: recoveryCheckIntervalMs 30000, threshold 3, autoRecover true.
      // Interval-driven detectRecovery has no healthCheckFn => treated healthy.
      svc.setDegradationLevel('custom', 'partial');
      expect(svc.getDegradationLevel('custom')).toBe('partial');

      // 3 interval ticks -> consecutive reaches threshold -> auto recover
      await vi.advanceTimersByTimeAsync(30000 * 3 + 1);

      expect(svc.getDegradationLevel('custom')).toBe('none');
    });

    it('does not start recovery checks when autoRecover is disabled', async () => {
      svc.setAutoRecover('custom', false);
      svc.setDegradationLevel('custom', 'partial');

      await vi.advanceTimersByTimeAsync(30000 * 5);

      expect(svc.getDegradationLevel('custom')).toBe('partial');
    });
  });

  describe('detectRecovery', () => {
    it('returns true immediately for a healthy (level none) service', async () => {
      const result = await svc.detectRecovery('custom');
      expect(result).toBe(true);
    });

    it('recovers after enough consecutive successful health checks', async () => {
      svc.setAutoRecover('custom', false); // avoid interval interference
      svc.setDegradationLevel('custom', 'partial');
      const healthy = vi.fn().mockResolvedValue(true);

      expect(await svc.detectRecovery('custom', healthy)).toBe(false); // 1/3
      expect(await svc.detectRecovery('custom', healthy)).toBe(false); // 2/3
      expect(await svc.detectRecovery('custom', healthy)).toBe(true); // 3/3 -> recovered
      expect(svc.getDegradationLevel('custom')).toBe('none');
    });

    it('resets the consecutive counter on a failed health check', async () => {
      svc.setAutoRecover('custom', false);
      svc.setDegradationLevel('custom', 'partial');
      const flaky = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false).mockResolvedValue(true);

      await svc.detectRecovery('custom', flaky); // 1
      await svc.detectRecovery('custom', flaky); // fail -> reset to 0
      await svc.detectRecovery('custom', flaky); // 1 again

      const report = svc.getDegradationReport();
      const custom = report.services.find((s) => s.service === 'custom')!;
      expect(custom.recoveryChecks.consecutive).toBe(1);
      expect(svc.getDegradationLevel('custom')).toBe('partial');
    });

    it('resets the counter and returns false when the health check throws', async () => {
      svc.setAutoRecover('custom', false);
      svc.setDegradationLevel('custom', 'partial');
      const throwing = vi.fn().mockRejectedValue(new Error('check exploded'));

      const result = await svc.detectRecovery('custom', throwing);
      expect(result).toBe(false);
      expect(svc.getDegradationLevel('custom')).toBe('partial');
    });
  });

  // --------------------------------------------------------------------------
  // Health-driven degradation
  // --------------------------------------------------------------------------

  describe('handleHealthChange', () => {
    const health = (over: Partial<ServiceHealth>): ServiceHealth => ({
      service: 'custom',
      healthy: true,
      ...over,
    });

    it('escalates to full when the service is unhealthy', () => {
      svc.handleHealthChange(health({ healthy: false }));
      expect(svc.getDegradationLevel('custom')).toBe('full');
    });

    it('escalates to full on a high error rate', () => {
      svc.handleHealthChange(health({ errorRate: 0.6 }));
      expect(svc.getDegradationLevel('custom')).toBe('full');
    });

    it('escalates to partial on an elevated error rate', () => {
      svc.handleHealthChange(health({ errorRate: 0.2 }));
      expect(svc.getDegradationLevel('custom')).toBe('partial');
    });

    it('escalates to partial on a slow response time', () => {
      svc.handleHealthChange(health({ responseTimeMs: 15000 }));
      expect(svc.getDegradationLevel('custom')).toBe('partial');
    });

    it('does not downgrade an already-degraded service on a healthier report', () => {
      svc.handleHealthChange(health({ healthy: false })); // full
      svc.handleHealthChange(health({ healthy: true, errorRate: 0.2 })); // would be partial
      expect(svc.getDegradationLevel('custom')).toBe('full');
    });

    it('leaves a healthy service at none', () => {
      svc.handleHealthChange(health({ healthy: true, errorRate: 0.01, responseTimeMs: 100 }));
      expect(svc.getDegradationLevel('custom')).toBe('none');
    });
  });

  // --------------------------------------------------------------------------
  // Health listener registration
  // --------------------------------------------------------------------------

  describe('health listeners', () => {
    it('reacts to health events from an EventEmitter source', () => {
      const emitter = new EventEmitter();
      svc.registerHealthListener(emitter, 'health');

      emitter.emit('health', { service: 'custom', healthy: false } as ServiceHealth);
      expect(svc.getDegradationLevel('custom')).toBe('full');
    });

    it('stops reacting after unregistering an EventEmitter listener', () => {
      const emitter = new EventEmitter();
      svc.registerHealthListener(emitter, 'health');
      emitter.emit('health', { service: 'custom', healthy: true, errorRate: 0.2 } as ServiceHealth);
      expect(svc.getDegradationLevel('custom')).toBe('partial');

      svc.unregisterHealthListener(emitter, 'health');
      emitter.emit('health', { service: 'custom', healthy: false } as ServiceHealth);
      // Would escalate to full if still listening; remains partial
      expect(svc.getDegradationLevel('custom')).toBe('partial');
    });

    it('maps SystemHealth components from a callback-based health source', () => {
      let captured: ((h: SystemHealth) => void) | undefined;
      const source = {
        onHealthChange: (cb: (h: SystemHealth) => void) => {
          captured = cb;
          return () => {
            captured = undefined;
          };
        },
      };

      const unsubscribe = svc.registerHealthListener(source);
      expect(typeof unsubscribe).toBe('function');

      captured!({
        status: 'unhealthy',
        components: [
          { name: 'custom', status: 'unhealthy', lastChecked: new Date() },
        ],
        timestamp: new Date(),
      });

      expect(svc.getDegradationLevel('custom')).toBe('full');
    });
  });

  // --------------------------------------------------------------------------
  // Reporting
  // --------------------------------------------------------------------------

  describe('getDegradationReport', () => {
    it('summarizes service counts by degradation level', () => {
      svc.setDegradationLevel('ollama', 'partial');
      svc.setDegradationLevel('claude', 'full');

      const report = svc.getDegradationReport();
      expect(report.summary.totalServices).toBeGreaterThan(0);
      expect(report.summary.partiallyDegradedServices).toBe(1);
      expect(report.summary.fullyDegradedServices).toBe(1);
      expect(report.summary.healthyServices).toBe(report.summary.totalServices - 2);
    });

    it('includes per-strategy stats and recovery-check info', () => {
      const report = svc.getDegradationReport();
      const queue = report.services.find((s) => s.service === 'queue')!;
      expect(queue.strategies.length).toBe(2);
      expect(queue.recoveryChecks.threshold).toBe(3);
      expect(queue.strategies[0].stats).toHaveProperty('totalExecutions');
    });
  });

  // --------------------------------------------------------------------------
  // recordSuccessfulExecution wiring via executeFallback
  // --------------------------------------------------------------------------

  describe('successful primary execution while degraded', () => {
    it('advances recovery counter when primary succeeds during degradation', async () => {
      svc.setAutoRecover('custom', false); // prevent interval interference
      svc.setDegradationLevel('custom', 'partial');

      await svc.executeFallback('custom', vi.fn().mockResolvedValue('ok'), {});

      const report = svc.getDegradationReport();
      const custom = report.services.find((s) => s.service === 'custom')!;
      expect(custom.recoveryChecks.consecutive).toBe(1);
    });
  });

  // --------------------------------------------------------------------------
  // Shutdown
  // --------------------------------------------------------------------------

  describe('shutdown', () => {
    it('clears recovery intervals so no further checks run', async () => {
      svc.setDegradationLevel('custom', 'partial'); // starts an interval
      await svc.shutdown();

      // After shutdown, advancing time must not change the level
      await vi.advanceTimersByTimeAsync(30000 * 5);
      expect(svc.getDegradationLevel('custom')).toBe('partial');
    });
  });
});
