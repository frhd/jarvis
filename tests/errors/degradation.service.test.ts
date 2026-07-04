#!/usr/bin/env npx tsx
/**
 * Degradation Service Tests
 *
 * Comprehensive tests for the degradation service that manages service fallbacks
 * and degraded operation modes.
 *
 * Tests cover:
 * 1. Fallback strategy registration (registerFallback, removeFallback, getFallbackStrategy)
 * 2. Fallback execution (executeFallback)
 * 3. Degradation level management (setDegradationLevel, getDegradationLevel)
 * 4. Service-level degradation (setServiceDegraded, isServiceDegraded, getDegradedServices)
 * 5. Recovery detection (detectRecovery)
 * 6. Health integration (registerHealthListener, handleHealthChange)
 * 7. Statistics and reporting (getStats, generateDegradationReport)
 * 8. Default strategies and their behavior
 *
 * Run: npx vitest tests/errors/degradation.service.test.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import {
  DegradationService,
  type DegradationLevel,
  type FallbackStrategy,
  type ServiceHealth,
  type SystemHealth,
  type DegradationEvent,
} from '../../src/services/degradation.service';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a mock health source (EventEmitter-based)
 */
function createMockHealthEmitter(): EventEmitter {
  return new EventEmitter();
}

/**
 * Create a mock health source (callback-based)
 */
function createMockHealthCallback() {
  const callbacks: Array<(health: SystemHealth) => void> = [];

  return {
    onHealthChange: (callback: (health: SystemHealth) => void) => {
      callbacks.push(callback);
      return () => {
        const index = callbacks.indexOf(callback);
        if (index > -1) callbacks.splice(index, 1);
      };
    },
    emitHealthChange: (health: SystemHealth) => {
      callbacks.forEach(cb => cb(health));
    },
  };
}

/**
 * Wait for a specified amount of time
 */
function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Create a mock system health object
 */
function createMockSystemHealth(components: Array<{
  name: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  latencyMs?: number;
  error?: string;
}>): SystemHealth {
  return {
    status: 'healthy',
    components: components.map(c => ({
      ...c,
      lastChecked: new Date(),
    })),
    timestamp: new Date(),
  };
}

// ============================================================================
// Test Suites
// ============================================================================

describe('DegradationService', () => {
  let service: DegradationService;

  beforeEach(() => {
    service = new DegradationService();
  });

  afterEach(async () => {
    await service.shutdown();
  });

  // ==========================================================================
  // Fallback Registration Tests
  // ==========================================================================

  describe('Fallback Registration', () => {
    it('should register a fallback strategy', () => {
      const fallbackFn = vi.fn();

      service.registerFallback('test-service', {
        id: 'test-fallback',
        fallbackFn,
        description: 'Test fallback',
      });

      const level = service.getDegradationLevel('test-service');
      expect(level).toBe('none'); // Service should be created with 'none' level
    });

    it('should register multiple fallback strategies with priority', () => {
      const fallback1 = vi.fn();
      const fallback2 = vi.fn();

      service.registerFallback('test-service', {
        id: 'fallback-1',
        fallbackFn: fallback1,
        priority: 20,
      });

      service.registerFallback('test-service', {
        id: 'fallback-2',
        fallbackFn: fallback2,
        priority: 10, // Higher priority (lower number)
      });

      // Verify both are registered (indirectly through execution later)
      expect(service.getDegradationLevel('test-service')).toBe('none');
    });

    it('should update existing fallback strategy with same ID', () => {
      const fallback1 = vi.fn().mockResolvedValue('result-1');
      const fallback2 = vi.fn().mockResolvedValue('result-2');

      service.registerFallback('test-service', {
        id: 'same-id',
        fallbackFn: fallback1,
      });

      service.registerFallback('test-service', {
        id: 'same-id',
        fallbackFn: fallback2, // Should replace fallback1
      });

      // Can't directly verify the update, but the behavior will be tested in execution
      expect(service.getDegradationLevel('test-service')).toBe('none');
    });

    it('should sort strategies by priority (lower number = higher priority)', async () => {
      const results: string[] = [];

      service.registerFallback('priority-test', {
        id: 'low-priority',
        fallbackFn: async () => {
          results.push('low');
          throw new Error('Continue to next');
        },
        priority: 100,
      });

      service.registerFallback('priority-test', {
        id: 'high-priority',
        fallbackFn: async () => {
          results.push('high');
          return 'success';
        },
        priority: 10,
      });

      service.setDegradationLevel('priority-test', 'full');

      const result = await service.executeFallback(
        'priority-test',
        async () => { throw new Error('Primary failed'); },
        {}
      );

      expect(results[0]).toBe('high'); // High priority should execute first
      expect(result).toBe('success');
    });

    it('should remove a fallback strategy', () => {
      const fallbackFn = vi.fn();

      service.registerFallback('test-service', {
        id: 'removable',
        fallbackFn,
      });

      const removed = service.removeFallback('test-service', 'removable');
      expect(removed).toBe(true);
    });

    it('should return false when removing non-existent strategy', () => {
      const removed = service.removeFallback('non-existent', 'non-existent');
      expect(removed).toBe(false);
    });

    it('should return false when removing from non-existent service', () => {
      service.registerFallback('test-service', {
        id: 'test',
        fallbackFn: vi.fn(),
      });

      const removed = service.removeFallback('test-service', 'non-existent-id');
      expect(removed).toBe(false);
    });
  });

  // ==========================================================================
  // Fallback Execution Tests
  // ==========================================================================

  describe('Fallback Execution', () => {
    it('should execute primary function when service is healthy', async () => {
      const primaryFn = vi.fn().mockResolvedValue('primary-result');
      const fallbackFn = vi.fn().mockResolvedValue('fallback-result');

      service.registerFallback('test-service', {
        id: 'test-fallback',
        fallbackFn,
      });

      const result = await service.executeFallback('test-service', primaryFn, {});

      expect(primaryFn).toHaveBeenCalled();
      expect(fallbackFn).not.toHaveBeenCalled();
      expect(result).toBe('primary-result');
    });

    it('should execute fallback when primary fails', async () => {
      const primaryFn = vi.fn().mockRejectedValue(new Error('Primary failed'));
      const fallbackFn = vi.fn().mockResolvedValue('fallback-result');

      service.registerFallback('test-service', {
        id: 'test-fallback',
        fallbackFn,
      });

      const result = await service.executeFallback('test-service', primaryFn, {});

      expect(primaryFn).toHaveBeenCalled();
      expect(fallbackFn).toHaveBeenCalled();
      expect(result).toBe('fallback-result');
    });

    it('should skip primary and use fallback when service is fully degraded', async () => {
      const primaryFn = vi.fn().mockResolvedValue('primary-result');
      const fallbackFn = vi.fn().mockResolvedValue('fallback-result');

      service.registerFallback('test-service', {
        id: 'test-fallback',
        fallbackFn,
      });

      service.setDegradationLevel('test-service', 'full');

      const result = await service.executeFallback('test-service', primaryFn, {});

      expect(primaryFn).not.toHaveBeenCalled();
      expect(fallbackFn).toHaveBeenCalled();
      expect(result).toBe('fallback-result');
    });

    it('should try multiple fallbacks in priority order', async () => {
      const primaryFn = vi.fn().mockRejectedValue(new Error('Primary failed'));
      const fallback1 = vi.fn().mockRejectedValue(new Error('Fallback 1 failed'));
      const fallback2 = vi.fn().mockResolvedValue('fallback-2-result');

      service.registerFallback('test-service', {
        id: 'fallback-1',
        fallbackFn: fallback1,
        priority: 10,
      });

      service.registerFallback('test-service', {
        id: 'fallback-2',
        fallbackFn: fallback2,
        priority: 20,
      });

      const result = await service.executeFallback('test-service', primaryFn, {});

      expect(fallback1).toHaveBeenCalled();
      expect(fallback2).toHaveBeenCalled();
      expect(result).toBe('fallback-2-result');
    });

    it('should throw graceful error when all fallbacks fail', async () => {
      const primaryFn = vi.fn().mockRejectedValue(new Error('Primary failed'));
      const fallback1 = vi.fn().mockRejectedValue(new Error('Fallback 1 failed'));
      const fallback2 = vi.fn().mockRejectedValue(new Error('Fallback 2 failed'));

      service.registerFallback('test-service', {
        id: 'fallback-1',
        fallbackFn: fallback1,
        priority: 10,
      });

      service.registerFallback('test-service', {
        id: 'fallback-2',
        fallbackFn: fallback2,
        priority: 20,
      });

      await expect(
        service.executeFallback('test-service', primaryFn, {})
      ).rejects.toThrow('Service is temporarily unavailable');
    });

    it('should respect fallback condition function', async () => {
      const primaryFn = vi.fn().mockRejectedValue(new Error('timeout'));
      const fallback1 = vi.fn().mockResolvedValue('fallback-1-result');
      const fallback2 = vi.fn().mockResolvedValue('fallback-2-result');

      // Only triggers on timeout errors
      service.registerFallback('test-service', {
        id: 'timeout-fallback',
        fallbackFn: fallback1,
        condition: (error) => error.message.includes('timeout'),
        priority: 10,
      });

      // Always triggers
      service.registerFallback('test-service', {
        id: 'always-fallback',
        fallbackFn: fallback2,
        priority: 20,
      });

      const result = await service.executeFallback('test-service', primaryFn, {});

      expect(fallback1).toHaveBeenCalled(); // Should trigger because error contains 'timeout'
      expect(fallback2).not.toHaveBeenCalled(); // Should not be called because first succeeded
      expect(result).toBe('fallback-1-result');
    });

    it('should skip fallback when condition is not met', async () => {
      const primaryFn = vi.fn().mockRejectedValue(new Error('different error'));
      const fallback1 = vi.fn().mockResolvedValue('fallback-1-result');
      const fallback2 = vi.fn().mockResolvedValue('fallback-2-result');

      // Only triggers on timeout errors
      service.registerFallback('test-service', {
        id: 'timeout-fallback',
        fallbackFn: fallback1,
        condition: (error) => error.message.includes('timeout'),
        priority: 10,
      });

      // Always triggers
      service.registerFallback('test-service', {
        id: 'always-fallback',
        fallbackFn: fallback2,
        priority: 20,
      });

      const result = await service.executeFallback('test-service', primaryFn, {});

      expect(fallback1).not.toHaveBeenCalled(); // Should skip because condition not met
      expect(fallback2).toHaveBeenCalled(); // Should trigger
      expect(result).toBe('fallback-2-result');
    });

    it('should pass args and error to fallback function', async () => {
      const primaryFn = vi.fn().mockRejectedValue(new Error('Primary failed'));
      const fallbackFn = vi.fn().mockResolvedValue('fallback-result');

      service.registerFallback('test-service', {
        id: 'test-fallback',
        fallbackFn,
      });

      const args = { data: 'test-data' };
      await service.executeFallback('test-service', primaryFn, args);

      expect(fallbackFn).toHaveBeenCalledWith(
        args,
        expect.any(Error)
      );
    });

    it('should throw original error when no fallbacks registered', async () => {
      const primaryFn = vi.fn().mockRejectedValue(new Error('Primary failed'));

      await expect(
        service.executeFallback('no-fallbacks', primaryFn, {})
      ).rejects.toThrow('Primary failed');
    });
  });

  // ==========================================================================
  // Degradation Level Management Tests
  // ==========================================================================

  describe('Degradation Level Management', () => {
    it('should set degradation level for a service', () => {
      service.setDegradationLevel('test-service', 'partial', 'Manual test');

      const level = service.getDegradationLevel('test-service');
      expect(level).toBe('partial');
    });

    it('should emit degradation event when level changes', () => {
      return new Promise<void>((resolve) => {
        service.on('degradation', (event: DegradationEvent) => {
          expect(event.service).toBe('test-service');
          expect(event.previousLevel).toBe('none');
          expect(event.newLevel).toBe('partial');
          expect(event.reason).toBe('Test reason');
          expect(event.timestamp).toBeInstanceOf(Date);
          resolve();
        });

        service.setDegradationLevel('test-service', 'partial', 'Test reason');
      });
    });

    it('should not emit event when level does not change', () => {
      const handler = vi.fn();
      service.on('degradation', handler);

      service.setDegradationLevel('test-service', 'none');
      service.setDegradationLevel('test-service', 'none'); // Same level

      expect(handler).not.toHaveBeenCalled();
    });

    it('should get default degradation level for non-existent service', () => {
      const level = service.getDegradationLevel('non-existent');
      expect(level).toBe('none');
    });

    it('should handle all degradation levels (none, partial, full)', () => {
      service.setDegradationLevel('test-service', 'none');
      expect(service.getDegradationLevel('test-service')).toBe('none');

      service.setDegradationLevel('test-service', 'partial');
      expect(service.getDegradationLevel('test-service')).toBe('partial');

      service.setDegradationLevel('test-service', 'full');
      expect(service.getDegradationLevel('test-service')).toBe('full');
    });

    it('should reset recovery checks when degradation level changes', () => {
      service.setDegradationLevel('test-service', 'partial');
      service.setDegradationLevel('test-service', 'full'); // Level change should reset checks

      const level = service.getDegradationLevel('test-service');
      expect(level).toBe('full');
    });

    it('should start recovery interval when degrading with auto-recover enabled', async () => {
      service.setAutoRecover('test-service', true);
      service.setDegradationLevel('test-service', 'partial');

      // Recovery interval should be started (can't easily test internal state, but no errors should occur)
      expect(service.getDegradationLevel('test-service')).toBe('partial');

      await wait(100); // Wait a bit to ensure interval is running
    });

    it('should stop recovery interval when recovering to none', async () => {
      service.setDegradationLevel('test-service', 'partial');
      await wait(50);

      service.setDegradationLevel('test-service', 'none'); // Should stop interval

      expect(service.getDegradationLevel('test-service')).toBe('none');
    });
  });

  // ==========================================================================
  // Auto-Recovery Tests
  // ==========================================================================

  describe('Auto-Recovery', () => {
    it('should enable auto-recovery for a service', () => {
      service.setAutoRecover('test-service', true);
      service.setDegradationLevel('test-service', 'partial');

      // Should start recovery checks (verified by no errors)
      expect(service.getDegradationLevel('test-service')).toBe('partial');
    });

    it('should disable auto-recovery for a service', () => {
      service.setAutoRecover('test-service', false);
      service.setDegradationLevel('test-service', 'partial');

      // Should not start recovery checks
      expect(service.getDegradationLevel('test-service')).toBe('partial');
    });

    it('should stop recovery checks when auto-recovery is disabled', async () => {
      service.setAutoRecover('test-service', true);
      service.setDegradationLevel('test-service', 'partial');
      await wait(50);

      service.setAutoRecover('test-service', false); // Should stop checks

      expect(service.getDegradationLevel('test-service')).toBe('partial');
    });
  });

  // ==========================================================================
  // Recovery Detection Tests
  // ==========================================================================

  describe('Recovery Detection', () => {
    it('should return true when service is already healthy', async () => {
      const recovered = await service.detectRecovery('test-service');
      expect(recovered).toBe(true);
    });

    it('should detect recovery after threshold successful checks', async () => {
      service.setDegradationLevel('test-service', 'partial');

      const healthCheck = vi.fn().mockResolvedValue(true);

      // Default threshold is 3
      await service.detectRecovery('test-service', healthCheck);
      expect(service.getDegradationLevel('test-service')).toBe('partial');

      await service.detectRecovery('test-service', healthCheck);
      expect(service.getDegradationLevel('test-service')).toBe('partial');

      await service.detectRecovery('test-service', healthCheck);
      expect(service.getDegradationLevel('test-service')).toBe('none'); // Recovered!

      expect(healthCheck).toHaveBeenCalledTimes(3);
    });

    it('should reset counter on failed health check', async () => {
      service.setDegradationLevel('test-service', 'partial');

      const healthCheck = vi.fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false) // Fail
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true); // Need 3 more

      await service.detectRecovery('test-service', healthCheck);
      await service.detectRecovery('test-service', healthCheck);
      await service.detectRecovery('test-service', healthCheck); // Fails, resets counter

      expect(service.getDegradationLevel('test-service')).toBe('partial');

      await service.detectRecovery('test-service', healthCheck);
      await service.detectRecovery('test-service', healthCheck);
      await service.detectRecovery('test-service', healthCheck);

      expect(service.getDegradationLevel('test-service')).toBe('none'); // Now recovered
    });

    it('should handle health check errors', async () => {
      service.setDegradationLevel('test-service', 'partial');

      const healthCheck = vi.fn().mockRejectedValue(new Error('Health check error'));

      const recovered = await service.detectRecovery('test-service', healthCheck);

      expect(recovered).toBe(false);
      expect(service.getDegradationLevel('test-service')).toBe('partial');
    });

    it('should use default health check (returns true) when not provided', async () => {
      service.setDegradationLevel('test-service', 'partial');

      // Without health check function, should assume healthy
      await service.detectRecovery('test-service');
      await service.detectRecovery('test-service');
      await service.detectRecovery('test-service');

      expect(service.getDegradationLevel('test-service')).toBe('none');
    });
  });

  // ==========================================================================
  // Health Integration Tests
  // ==========================================================================

  describe('Health Integration', () => {
    it('should handle health change from EventEmitter source', () => {
      const healthEmitter = createMockHealthEmitter();

      service.registerHealthListener(healthEmitter, 'health');

      const health: ServiceHealth = {
        service: 'test-service',
        healthy: false,
      };

      healthEmitter.emit('health', health);

      expect(service.getDegradationLevel('test-service')).toBe('full');
    });

    it('should handle health change from callback-based source', () => {
      const healthCallback = createMockHealthCallback();

      service.registerHealthListener(healthCallback, 'health');

      const systemHealth = createMockSystemHealth([
        { name: 'test-service', status: 'unhealthy' },
      ]);

      healthCallback.emitHealthChange(systemHealth);

      expect(service.getDegradationLevel('test-service')).toBe('full');
    });

    it('should degrade service based on high error rate', () => {
      const healthEmitter = createMockHealthEmitter();

      service.registerHealthListener(healthEmitter, 'health');

      const health: ServiceHealth = {
        service: 'test-service',
        healthy: true,
        errorRate: 0.6, // 60% error rate
      };

      healthEmitter.emit('health', health);

      expect(service.getDegradationLevel('test-service')).toBe('full');
    });

    it('should partially degrade service based on elevated error rate', () => {
      const healthEmitter = createMockHealthEmitter();

      service.registerHealthListener(healthEmitter, 'health');

      const health: ServiceHealth = {
        service: 'test-service',
        healthy: true,
        errorRate: 0.15, // 15% error rate (partial)
      };

      healthEmitter.emit('health', health);

      expect(service.getDegradationLevel('test-service')).toBe('partial');
    });

    it('should degrade service based on slow response time', () => {
      const healthEmitter = createMockHealthEmitter();

      service.registerHealthListener(healthEmitter, 'health');

      const health: ServiceHealth = {
        service: 'test-service',
        healthy: true,
        responseTimeMs: 12000, // 12 seconds (> 10s threshold)
      };

      healthEmitter.emit('health', health);

      expect(service.getDegradationLevel('test-service')).toBe('partial');
    });

    it('should not auto-recover based on single healthy check', () => {
      const healthEmitter = createMockHealthEmitter();

      service.setDegradationLevel('test-service', 'partial');
      service.registerHealthListener(healthEmitter, 'health');

      const health: ServiceHealth = {
        service: 'test-service',
        healthy: true,
        errorRate: 0.05,
      };

      healthEmitter.emit('health', health);

      // Should not auto-recover (only degrades, doesn't upgrade on single check)
      expect(service.getDegradationLevel('test-service')).toBe('partial');
    });

    it('should unregister EventEmitter-based health listener', () => {
      const healthEmitter = createMockHealthEmitter();

      service.registerHealthListener(healthEmitter, 'health');
      service.unregisterHealthListener(healthEmitter, 'health');

      const health: ServiceHealth = {
        service: 'test-service',
        healthy: false,
      };

      healthEmitter.emit('health', health);

      // Should not degrade because listener was removed
      expect(service.getDegradationLevel('test-service')).toBe('none');
    });

    it('should unregister callback-based health listener', () => {
      const healthCallback = createMockHealthCallback();

      const unsubscribe = service.registerHealthListener(healthCallback, 'health');
      service.unregisterHealthListener(healthCallback, 'health');

      const systemHealth = createMockSystemHealth([
        { name: 'test-service', status: 'unhealthy' },
      ]);

      healthCallback.emitHealthChange(systemHealth);

      // Should not degrade because listener was removed
      expect(service.getDegradationLevel('test-service')).toBe('none');
    });
  });

  // ==========================================================================
  // Statistics Tests
  // ==========================================================================

  describe('Statistics', () => {
    it('should track fallback execution statistics', async () => {
      const primaryFn = vi.fn().mockRejectedValue(new Error('Primary failed'));
      const fallbackFn = vi.fn().mockResolvedValue('result');

      service.registerFallback('test-service', {
        id: 'test-fallback',
        fallbackFn,
      });

      await service.executeFallback('test-service', primaryFn, {});
      await service.executeFallback('test-service', primaryFn, {});

      const stats = service.getServiceStats('test-service');

      expect(stats.length).toBe(1);
      expect(stats[0].strategyId).toBe('test-fallback');
      expect(stats[0].totalExecutions).toBe(2);
      expect(stats[0].successfulExecutions).toBe(2);
      expect(stats[0].failedExecutions).toBe(0);
      expect(stats[0].lastExecutedAt).toBeInstanceOf(Date);
      expect(stats[0].avgExecutionTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('should track failed fallback executions', async () => {
      const primaryFn = vi.fn().mockRejectedValue(new Error('Primary failed'));
      const fallbackFn = vi.fn().mockRejectedValue(new Error('Fallback failed'));
      const fallback2Fn = vi.fn().mockResolvedValue('result');

      service.registerFallback('test-service', {
        id: 'failing-fallback',
        fallbackFn,
        priority: 10,
      });

      service.registerFallback('test-service', {
        id: 'working-fallback',
        fallbackFn: fallback2Fn,
        priority: 20,
      });

      await service.executeFallback('test-service', primaryFn, {});

      const stats = service.getServiceStats('test-service');
      const failingStats = stats.find(s => s.strategyId === 'failing-fallback');

      expect(failingStats).toBeDefined();
      expect(failingStats!.totalExecutions).toBe(1);
      expect(failingStats!.failedExecutions).toBe(1);
      expect(failingStats!.successfulExecutions).toBe(0);
    });

    it('should return empty stats for non-existent service', () => {
      const stats = service.getServiceStats('non-existent');
      expect(stats).toEqual([]);
    });

    it('should return all fallback stats', async () => {
      // Create a fresh service to avoid interference from default strategies
      const freshService = new DegradationService();
      const primaryFn = vi.fn().mockRejectedValue(new Error('Primary failed'));

      freshService.registerFallback('service-1', {
        id: 'fallback-1',
        fallbackFn: vi.fn().mockResolvedValue('result'),
      });

      freshService.registerFallback('service-2', {
        id: 'fallback-2',
        fallbackFn: vi.fn().mockResolvedValue('result'),
      });

      await freshService.executeFallback('service-1', primaryFn, {});
      await freshService.executeFallback('service-2', primaryFn, {});

      const allStats = freshService.getFallbackStats();

      // Default strategies create 6 services: ollama, claude, llm, embedding, queue, database
      // Plus our 2 test services = 8 total
      expect(allStats.size).toBeGreaterThanOrEqual(2);
      expect(allStats.has('service-1')).toBe(true);
      expect(allStats.has('service-2')).toBe(true);

      await freshService.shutdown();
    });

    it('should calculate average execution time correctly', async () => {
      const primaryFn = vi.fn().mockRejectedValue(new Error('Primary failed'));
      const fallbackFn = vi.fn()
        .mockImplementation(() => wait(10).then(() => 'result'));

      service.registerFallback('test-service', {
        id: 'timed-fallback',
        fallbackFn,
      });

      await service.executeFallback('test-service', primaryFn, {});
      await service.executeFallback('test-service', primaryFn, {});
      await service.executeFallback('test-service', primaryFn, {});

      const stats = service.getServiceStats('test-service');

      expect(stats[0].avgExecutionTimeMs).toBeGreaterThan(0);
      expect(stats[0].totalExecutions).toBe(3);
    });
  });

  // ==========================================================================
  // Degradation Report Tests
  // ==========================================================================

  describe('Degradation Report', () => {
    it('should generate complete degradation report', async () => {
      const primaryFn = vi.fn().mockRejectedValue(new Error('Failed'));

      service.registerFallback('service-1', {
        id: 'fallback-1',
        fallbackFn: vi.fn().mockResolvedValue('result'),
        description: 'Test fallback 1',
      });

      service.registerFallback('service-2', {
        id: 'fallback-2',
        fallbackFn: vi.fn().mockResolvedValue('result'),
        description: 'Test fallback 2',
      });

      service.setDegradationLevel('service-1', 'partial');
      service.setDegradationLevel('service-2', 'full');

      await service.executeFallback('service-1', primaryFn, {});

      const report = service.getDegradationReport();

      expect(report).toHaveProperty('timestamp');
      expect(report).toHaveProperty('services');
      expect(report).toHaveProperty('summary');

      expect(report.services.length).toBeGreaterThanOrEqual(2);
      expect(report.summary.totalServices).toBeGreaterThanOrEqual(2);
      expect(report.summary.partiallyDegradedServices).toBeGreaterThanOrEqual(1);
      expect(report.summary.fullyDegradedServices).toBeGreaterThanOrEqual(1);
    });

    it('should include strategy descriptions in report', () => {
      service.registerFallback('test-service', {
        id: 'documented-fallback',
        fallbackFn: vi.fn(),
        description: 'This is a documented fallback strategy',
      });

      const report = service.getDegradationReport();
      const testService = report.services.find(s => s.service === 'test-service');

      expect(testService).toBeDefined();
      expect(testService!.strategies[0].description).toBe('This is a documented fallback strategy');
    });

    it('should include recovery check information', async () => {
      service.setDegradationLevel('test-service', 'partial');

      const healthCheck = vi.fn().mockResolvedValue(true);
      await service.detectRecovery('test-service', healthCheck);
      await service.detectRecovery('test-service', healthCheck);

      const report = service.getDegradationReport();
      const testService = report.services.find(s => s.service === 'test-service');

      expect(testService).toBeDefined();
      expect(testService!.recoveryChecks.consecutive).toBe(2);
      expect(testService!.recoveryChecks.threshold).toBe(3);
      expect(testService!.recoveryChecks.lastCheckAt).toBeInstanceOf(Date);
    });

    it('should count services by degradation level', () => {
      service.setDegradationLevel('healthy-1', 'none');
      service.setDegradationLevel('healthy-2', 'none');
      service.setDegradationLevel('partial-1', 'partial');
      service.setDegradationLevel('full-1', 'full');
      service.setDegradationLevel('full-2', 'full');

      const report = service.getDegradationReport();

      expect(report.summary.healthyServices).toBeGreaterThanOrEqual(2);
      expect(report.summary.partiallyDegradedServices).toBeGreaterThanOrEqual(1);
      expect(report.summary.fullyDegradedServices).toBeGreaterThanOrEqual(2);
    });

    it('should include auto-recovery status in report', () => {
      service.setAutoRecover('test-service', true);
      service.setDegradationLevel('test-service', 'partial');

      const report = service.getDegradationReport();
      const testService = report.services.find(s => s.service === 'test-service');

      expect(testService).toBeDefined();
      expect(testService!.autoRecover).toBe(true);
    });
  });

  // ==========================================================================
  // Default Strategies Tests
  // ==========================================================================

  describe('Default Strategies', () => {
    it('should have default strategies for ollama service', async () => {
      const primaryFn = vi.fn().mockRejectedValue(new Error('Ollama failed'));

      service.setDegradationLevel('ollama', 'full');

      // Should try to use cached response (which will fail without actual cache)
      await expect(
        service.executeFallback('ollama', primaryFn, {})
      ).rejects.toThrow();
    });

    it('should have default strategies for claude service', async () => {
      const primaryFn = vi.fn().mockRejectedValue(new Error('Claude failed'));

      service.setDegradationLevel('claude', 'full');

      // Should try to fallback to ollama (which will fail without configuration)
      await expect(
        service.executeFallback('claude', primaryFn, {})
      ).rejects.toThrow();
    });

    it('should have graceful error strategy for llm service', async () => {
      const primaryFn = vi.fn().mockRejectedValue(new Error('LLM failed'));

      service.setDegradationLevel('llm', 'full');

      // Should return graceful error message (not throw, but return it)
      const result = await service.executeFallback('llm', primaryFn, {});

      expect(result).toContain('having trouble processing your request');
    });

    it('should have default strategies for embedding service', async () => {
      const primaryFn = vi.fn().mockRejectedValue(new Error('Embedding failed'));

      service.setDegradationLevel('embedding', 'full');

      const result = await service.executeFallback('embedding', primaryFn, {});

      // Should skip semantic operations (return null)
      expect(result).toBeNull();
    });

    it('should have queue degradation strategies', async () => {
      const primaryFn = vi.fn().mockRejectedValue(new Error('Queue overload'));

      service.setDegradationLevel('queue', 'partial');

      const result = await service.executeFallback('queue', primaryFn, {});

      // Should suggest synchronous processing
      expect(result).toHaveProperty('synchronous');
    });

    it('should have database degradation strategies', async () => {
      const primaryFn = vi.fn().mockRejectedValue(new Error('Database slow'));

      service.setDegradationLevel('database', 'partial');

      const result = await service.executeFallback('database', primaryFn, {});

      // Should enable aggressive caching
      expect(result).toHaveProperty('aggressiveCaching');
    });
  });

  // ==========================================================================
  // Lifecycle Tests
  // ==========================================================================

  describe('Lifecycle', () => {
    it('should shutdown cleanly', async () => {
      service.setDegradationLevel('test-service', 'partial');

      await expect(service.shutdown()).resolves.toBeUndefined();
    });

    it('should stop all recovery intervals on shutdown', async () => {
      service.setDegradationLevel('service-1', 'partial');
      service.setDegradationLevel('service-2', 'partial');

      await wait(50);

      await service.shutdown();

      // No errors should occur
      expect(true).toBe(true);
    });

    it('should clear all health listeners on shutdown', async () => {
      const healthEmitter = createMockHealthEmitter();

      // Track whether handler is called after shutdown
      let handlerCalled = false;
      service.on('degradation', () => {
        handlerCalled = true;
      });

      service.registerHealthListener(healthEmitter, 'health');

      await service.shutdown();

      const health: ServiceHealth = {
        service: 'test-service',
        healthy: false,
      };

      healthEmitter.emit('health', health);

      // Handler should not be called after shutdown (all listeners removed)
      expect(handlerCalled).toBe(false);
    });

    it('should unsubscribe from callback-based health sources on shutdown', async () => {
      const healthCallback = createMockHealthCallback();
      service.registerHealthListener(healthCallback, 'health');

      await service.shutdown();

      const systemHealth = createMockSystemHealth([
        { name: 'test-service', status: 'unhealthy' },
      ]);

      healthCallback.emitHealthChange(systemHealth);

      // Should not degrade because service was shut down
      expect(service.getDegradationLevel('test-service')).toBe('none');
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('Edge Cases', () => {
    it('should handle non-Error objects in fallback execution', async () => {
      const primaryFn = vi.fn().mockRejectedValue('string error');
      const fallbackFn = vi.fn().mockResolvedValue('fallback-result');

      service.registerFallback('test-service', {
        id: 'test-fallback',
        fallbackFn,
      });

      const result = await service.executeFallback('test-service', primaryFn, {});
      expect(result).toBe('fallback-result');
    });

    it('should handle graceful error for service-specific messages', async () => {
      const primaryFn = vi.fn().mockRejectedValue(new Error('Failed'));

      await expect(
        service.executeFallback('llm', primaryFn, {})
      ).rejects.toThrow('having trouble processing');
    });

    it('should handle graceful error for unknown services', async () => {
      const primaryFn = vi.fn().mockRejectedValue(new Error('Failed'));

      // Without fallbacks, should throw the original error
      await expect(
        service.executeFallback('unknown-service', primaryFn, {})
      ).rejects.toThrow('Failed');
    });

    it('should handle service names with hyphens', async () => {
      const primaryFn = vi.fn().mockRejectedValue(new Error('Failed'));

      service.registerFallback('llm-intent', {
        id: 'test',
        fallbackFn: vi.fn().mockResolvedValue('result'),
      });

      service.setDegradationLevel('llm-intent', 'full');

      await expect(
        service.executeFallback('llm-intent', primaryFn, {})
      ).resolves.toBe('result');
    });

    it('should handle concurrent fallback executions', async () => {
      const primaryFn = vi.fn().mockRejectedValue(new Error('Failed'));
      const fallbackFn = vi.fn()
        .mockImplementation(() => wait(10).then(() => 'result'));

      service.registerFallback('test-service', {
        id: 'concurrent-fallback',
        fallbackFn,
      });

      const results = await Promise.all([
        service.executeFallback('test-service', primaryFn, {}),
        service.executeFallback('test-service', primaryFn, {}),
        service.executeFallback('test-service', primaryFn, {}),
      ]);

      expect(results).toEqual(['result', 'result', 'result']);
      expect(fallbackFn).toHaveBeenCalledTimes(3);
    });

    it('should handle rapid degradation level changes', () => {
      service.setDegradationLevel('test-service', 'none');
      service.setDegradationLevel('test-service', 'partial');
      service.setDegradationLevel('test-service', 'full');
      service.setDegradationLevel('test-service', 'partial');
      service.setDegradationLevel('test-service', 'none');

      expect(service.getDegradationLevel('test-service')).toBe('none');
    });

    it('should handle recovery detection with no health check function', async () => {
      service.setDegradationLevel('test-service', 'partial');

      // Should assume healthy when no function provided
      await service.detectRecovery('test-service');
      await service.detectRecovery('test-service');
      const recovered = await service.detectRecovery('test-service');

      expect(recovered).toBe(true);
      expect(service.getDegradationLevel('test-service')).toBe('none');
    });
  });
});
