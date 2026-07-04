/**
 * Failover Service Tests
 *
 * Comprehensive tests for the FailoverService which handles:
 * - Primary/backup switching
 * - Health-based routing
 * - Graceful degradation based on system health
 * - Fallback execution strategies
 * - Service tier-based availability
 * - Redundancy management
 *
 * Run: npx vitest src/services/reliability/failover.service.test.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  FailoverService,
  FailoverConfig,
  FallbackConfig,
  BackupServiceConfig,
  FailoverEvent,
  DegradationMode,
  ServiceTier,
  FailoverStrategy,
} from './failover.service.js';
import type { HealthStatus } from '../health.service.js';

// ============================================================================
// Mocks
// ============================================================================

// Mock logger to avoid noise in test output
vi.mock('../../utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock nanoid for predictable IDs in tests
vi.mock('nanoid', () => ({
  nanoid: vi.fn(() => `test-id-${Math.random().toString(36).substring(7)}`),
}));

// ============================================================================
// Test Fixtures
// ============================================================================

const createMockFallbackConfig = (
  overrides?: Partial<Omit<FallbackConfig, 'id' | 'service'>>
): Omit<FallbackConfig, 'id' | 'service'> => ({
  priority: 1,
  enabled: true,
  maxAttempts: 3,
  delayMs: 100,
  ...overrides,
});

const createMockBackupServiceConfig = (
  overrides?: Partial<Omit<BackupServiceConfig, 'id'>>
): Omit<BackupServiceConfig, 'id'> => ({
  primaryService: 'primary-service',
  backupService: 'backup-service',
  strategy: 'active-passive',
  healthCheckIntervalMs: 30000,
  failoverThreshold: 3,
  enabled: true,
  ...overrides,
});

// ============================================================================
// Tests
// ============================================================================

describe('FailoverService', () => {
  let service: FailoverService;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(async () => {
    if (service) {
      await service.shutdown();
    }
    vi.useRealTimers();
    vi.resetAllMocks();
  });

  // ==========================================================================
  // Constructor Tests
  // ==========================================================================

  describe('constructor', () => {
    it('should initialize with default configuration', () => {
      service = new FailoverService();

      expect(service).toBeDefined();
      expect(service.getDegradationMode()).toBe('normal');
      expect(service.getStats()).toEqual({
        totalFailovers: 0,
        successfulFailovers: 0,
        currentDegradationMode: 'normal',
      });
    });

    it('should initialize with custom configuration', () => {
      const customConfig: Partial<FailoverConfig> = {
        enabled: false,
        gracefulDegradationEnabled: false,
        redundancyEnabled: false,
        degradationThresholds: {
          reduced: 0.8,
          minimal: 0.5,
          emergency: 0.3,
        },
      };

      service = new FailoverService(customConfig);

      expect(service).toBeDefined();
      expect(service.getDegradationMode()).toBe('normal');
    });

    it('should merge partial config with defaults', () => {
      const partialConfig: Partial<FailoverConfig> = {
        gracefulDegradationEnabled: false,
      };

      service = new FailoverService(partialConfig);

      expect(service).toBeDefined();
    });
  });

  // ==========================================================================
  // Fallback Registration Tests
  // ==========================================================================

  describe('registerFallback', () => {
    beforeEach(() => {
      service = new FailoverService();
    });

    it('should register a fallback with function', () => {
      const fallbackFn = vi.fn().mockResolvedValue('fallback result');
      const fallbackConfig = createMockFallbackConfig({ fallbackFn, priority: 1 });

      const id = service.registerFallback('test-service', fallbackConfig);

      expect(id).toBeDefined();
      expect(typeof id).toBe('string');

      const fallbacks = service.getFallbacks('test-service');
      expect(fallbacks).toHaveLength(1);
      expect(fallbacks[0].service).toBe('test-service');
      expect(fallbacks[0].priority).toBe(1);
    });

    it('should register a fallback with service name', () => {
      const fallbackConfig = createMockFallbackConfig({
        fallbackService: 'backup-service',
        priority: 2,
      });

      const id = service.registerFallback('test-service', fallbackConfig);

      expect(id).toBeDefined();

      const fallbacks = service.getFallbacks('test-service');
      expect(fallbacks[0].fallbackService).toBe('backup-service');
    });

    it('should sort fallbacks by priority (ascending)', () => {
      const fallback1 = createMockFallbackConfig({ priority: 3 });
      const fallback2 = createMockFallbackConfig({ priority: 1 });
      const fallback3 = createMockFallbackConfig({ priority: 2 });

      service.registerFallback('test-service', fallback1);
      service.registerFallback('test-service', fallback2);
      service.registerFallback('test-service', fallback3);

      const fallbacks = service.getFallbacks('test-service');
      expect(fallbacks).toHaveLength(3);
      expect(fallbacks[0].priority).toBe(1);
      expect(fallbacks[1].priority).toBe(2);
      expect(fallbacks[2].priority).toBe(3);
    });

    it('should register multiple fallbacks for same service', () => {
      const fallback1 = createMockFallbackConfig({ priority: 1 });
      const fallback2 = createMockFallbackConfig({ priority: 2 });

      service.registerFallback('test-service', fallback1);
      service.registerFallback('test-service', fallback2);

      const fallbacks = service.getFallbacks('test-service');
      expect(fallbacks).toHaveLength(2);
    });

    it('should register fallbacks for different services', () => {
      const fallback1 = createMockFallbackConfig();
      const fallback2 = createMockFallbackConfig();

      service.registerFallback('service-1', fallback1);
      service.registerFallback('service-2', fallback2);

      expect(service.getFallbacks('service-1')).toHaveLength(1);
      expect(service.getFallbacks('service-2')).toHaveLength(1);
    });
  });

  // ==========================================================================
  // getFallbacks Tests
  // ==========================================================================

  describe('getFallbacks', () => {
    beforeEach(() => {
      service = new FailoverService();
    });

    it('should return empty array for service with no fallbacks', () => {
      const fallbacks = service.getFallbacks('unknown-service');
      expect(fallbacks).toEqual([]);
    });

    it('should return fallbacks for registered service', () => {
      const fallbackConfig = createMockFallbackConfig();
      service.registerFallback('test-service', fallbackConfig);

      const fallbacks = service.getFallbacks('test-service');
      expect(fallbacks).toHaveLength(1);
    });
  });

  // ==========================================================================
  // executeWithFallback Tests - Success Cases
  // ==========================================================================

  describe('executeWithFallback - success cases', () => {
    beforeEach(() => {
      service = new FailoverService();
    });

    it('should return primary result when primary succeeds', async () => {
      const primaryFn = vi.fn().mockResolvedValue('primary result');
      const onSuccess = vi.fn();

      const result = await service.executeWithFallback(
        'test-service',
        primaryFn,
        undefined,
        onSuccess
      );

      expect(result).toBe('primary result');
      expect(primaryFn).toHaveBeenCalledTimes(1);
      expect(onSuccess).toHaveBeenCalledWith('test-service');
    });

    it('should not call fallbacks when primary succeeds', async () => {
      const primaryFn = vi.fn().mockResolvedValue('primary result');
      const fallbackFn = vi.fn().mockResolvedValue('fallback result');

      service.registerFallback('test-service', createMockFallbackConfig({ fallbackFn }));

      const result = await service.executeWithFallback('test-service', primaryFn);

      expect(result).toBe('primary result');
      expect(fallbackFn).not.toHaveBeenCalled();
    });

    it('should pass through complex return types', async () => {
      const complexResult = { data: [1, 2, 3], status: 'success' };
      const primaryFn = vi.fn().mockResolvedValue(complexResult);

      const result = await service.executeWithFallback('test-service', primaryFn);

      expect(result).toEqual(complexResult);
    });
  });

  // ==========================================================================
  // executeWithFallback Tests - Fallback Cases
  // ==========================================================================

  describe('executeWithFallback - fallback cases', () => {
    beforeEach(() => {
      service = new FailoverService();
    });

    it('should use fallback when primary fails', async () => {
      const primaryFn = vi.fn().mockRejectedValue(new Error('Primary failed'));
      const fallbackFn = vi.fn().mockResolvedValue('fallback result');
      const onFailure = vi.fn();

      service.registerFallback('test-service', createMockFallbackConfig({
        fallbackFn,
        maxAttempts: 1,
      }));

      const result = await service.executeWithFallback(
        'test-service',
        primaryFn,
        undefined,
        undefined,
        onFailure
      );

      expect(result).toBe('fallback result');
      expect(fallbackFn).toHaveBeenCalledTimes(1);
      expect(onFailure).toHaveBeenCalledWith('test-service', expect.any(Error));
    });

    it('should try multiple fallbacks in priority order', async () => {
      const primaryFn = vi.fn().mockRejectedValue(new Error('Primary failed'));
      const fallback1Fn = vi.fn().mockRejectedValue(new Error('Fallback 1 failed'));
      const fallback2Fn = vi.fn().mockResolvedValue('fallback 2 result');

      service.registerFallback('test-service', createMockFallbackConfig({
        fallbackFn: fallback1Fn,
        priority: 1,
        maxAttempts: 1,
      }));
      service.registerFallback('test-service', createMockFallbackConfig({
        fallbackFn: fallback2Fn,
        priority: 2,
        maxAttempts: 1,
      }));

      const result = await service.executeWithFallback('test-service', primaryFn);

      expect(result).toBe('fallback 2 result');
      expect(fallback1Fn).toHaveBeenCalledTimes(1);
      expect(fallback2Fn).toHaveBeenCalledTimes(1);
    });

    it('should skip disabled fallbacks', async () => {
      const primaryFn = vi.fn().mockRejectedValue(new Error('Primary failed'));
      const fallback1Fn = vi.fn().mockResolvedValue('fallback 1 result');
      const fallback2Fn = vi.fn().mockResolvedValue('fallback 2 result');

      service.registerFallback('test-service', createMockFallbackConfig({
        fallbackFn: fallback1Fn,
        priority: 1,
        enabled: false,
      }));
      service.registerFallback('test-service', createMockFallbackConfig({
        fallbackFn: fallback2Fn,
        priority: 2,
        enabled: true,
        maxAttempts: 1,
      }));

      const result = await service.executeWithFallback('test-service', primaryFn);

      expect(result).toBe('fallback 2 result');
      expect(fallback1Fn).not.toHaveBeenCalled();
      expect(fallback2Fn).toHaveBeenCalled();
    });

    it('should retry fallback according to maxAttempts', async () => {
      const primaryFn = vi.fn().mockRejectedValue(new Error('Primary failed'));
      let fallbackAttempts = 0;
      const fallbackFn = vi.fn().mockImplementation(async () => {
        fallbackAttempts++;
        if (fallbackAttempts < 3) {
          throw new Error(`Fallback attempt ${fallbackAttempts} failed`);
        }
        return 'fallback success';
      });

      service.registerFallback('test-service', createMockFallbackConfig({
        fallbackFn,
        maxAttempts: 3,
        delayMs: 10,
      }));

      const result = await service.executeWithFallback('test-service', primaryFn);

      expect(result).toBe('fallback success');
      expect(fallbackFn).toHaveBeenCalledTimes(3);
    });

    it('should apply delay between fallback attempts', async () => {
      const primaryFn = vi.fn().mockRejectedValue(new Error('Primary failed'));
      const fallbackFn = vi.fn()
        .mockRejectedValueOnce(new Error('Attempt 1 failed'))
        .mockResolvedValueOnce('fallback success');

      service.registerFallback('test-service', createMockFallbackConfig({
        fallbackFn,
        maxAttempts: 2,
        delayMs: 100,
      }));

      const promise = service.executeWithFallback('test-service', primaryFn);

      // Fast-forward past the delay
      await vi.advanceTimersByTimeAsync(150);

      const result = await promise;
      expect(result).toBe('fallback success');
    });

    it('should pass args and error to fallback function', async () => {
      const primaryFn = vi.fn().mockRejectedValue(new Error('Primary failed'));
      const fallbackFn = vi.fn().mockResolvedValue('fallback result');
      const args = { param1: 'value1', param2: 42 };

      service.registerFallback('test-service', createMockFallbackConfig({
        fallbackFn,
        maxAttempts: 1,
      }));

      await service.executeWithFallback('test-service', primaryFn, args);

      expect(fallbackFn).toHaveBeenCalledWith(args, expect.any(Error));
      expect(fallbackFn.mock.calls[0][1].message).toBe('Primary failed');
    });

    it('should throw error when all fallbacks fail', async () => {
      const primaryError = new Error('Primary failed');
      const primaryFn = vi.fn().mockRejectedValue(primaryError);
      const fallbackFn = vi.fn().mockRejectedValue(new Error('Fallback failed'));

      service.registerFallback('test-service', createMockFallbackConfig({
        fallbackFn,
        maxAttempts: 1,
      }));

      await expect(
        service.executeWithFallback('test-service', primaryFn)
      ).rejects.toThrow('Primary failed');
    });

    it('should skip fallbacks with fallbackService (not directly callable)', async () => {
      const primaryFn = vi.fn().mockRejectedValue(new Error('Primary failed'));

      service.registerFallback('test-service', createMockFallbackConfig({
        fallbackService: 'backup-service',
        maxAttempts: 1,
      }));

      await expect(
        service.executeWithFallback('test-service', primaryFn)
      ).rejects.toThrow('Primary failed');
    });
  });

  // ==========================================================================
  // executeWithFallback Tests - Disabled State
  // ==========================================================================

  describe('executeWithFallback - disabled state', () => {
    it('should bypass fallbacks when gracefulDegradationEnabled is false', async () => {
      service = new FailoverService({ gracefulDegradationEnabled: false });

      const primaryFn = vi.fn().mockRejectedValue(new Error('Primary failed'));
      const fallbackFn = vi.fn().mockResolvedValue('fallback result');

      service.registerFallback('test-service', createMockFallbackConfig({ fallbackFn }));

      await expect(
        service.executeWithFallback('test-service', primaryFn)
      ).rejects.toThrow('Primary failed');

      expect(fallbackFn).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Degradation Mode Tests
  // ==========================================================================

  describe('degradation mode', () => {
    beforeEach(() => {
      service = new FailoverService();
    });

    it('should start in normal mode', () => {
      expect(service.getDegradationMode()).toBe('normal');
    });

    it('should set degradation mode', () => {
      service.setDegradationMode('reduced', 'Test reason');
      expect(service.getDegradationMode()).toBe('reduced');
    });

    it('should emit event when degradation mode changes', () => {
      const eventHandler = vi.fn();
      service.on('degradation-change', eventHandler);

      service.setDegradationMode('minimal', 'Health degraded');

      expect(eventHandler).toHaveBeenCalledWith({
        previousMode: 'normal',
        newMode: 'minimal',
        reason: 'Health degraded',
      });
    });

    it('should update stats when degradation mode changes', () => {
      service.setDegradationMode('emergency', 'Critical failure');

      const stats = service.getStats();
      expect(stats.currentDegradationMode).toBe('emergency');
    });

    it('should support all degradation modes', () => {
      const modes: DegradationMode[] = ['normal', 'reduced', 'minimal', 'emergency'];

      modes.forEach((mode) => {
        service.setDegradationMode(mode, `Set to ${mode}`);
        expect(service.getDegradationMode()).toBe(mode);
      });
    });
  });

  // ==========================================================================
  // updateDegradationFromHealthRatio Tests
  // ==========================================================================

  describe('updateDegradationFromHealthRatio', () => {
    beforeEach(() => {
      service = new FailoverService();
    });

    it('should set normal mode for high health ratio', () => {
      service.updateDegradationFromHealthRatio(0.9);
      expect(service.getDegradationMode()).toBe('normal');
    });

    it('should set reduced mode for health ratio below reduced threshold', () => {
      service.updateDegradationFromHealthRatio(0.65);
      expect(service.getDegradationMode()).toBe('reduced');
    });

    it('should set minimal mode for health ratio below minimal threshold', () => {
      service.updateDegradationFromHealthRatio(0.35);
      expect(service.getDegradationMode()).toBe('minimal');
    });

    it('should set emergency mode for health ratio below emergency threshold', () => {
      service.updateDegradationFromHealthRatio(0.15);
      expect(service.getDegradationMode()).toBe('emergency');
    });

    it('should use custom thresholds when configured', () => {
      service = new FailoverService({
        degradationThresholds: {
          reduced: 0.8,
          minimal: 0.5,
          emergency: 0.3,
        },
      });

      service.updateDegradationFromHealthRatio(0.75);
      expect(service.getDegradationMode()).toBe('reduced');

      service.updateDegradationFromHealthRatio(0.45);
      expect(service.getDegradationMode()).toBe('minimal');

      service.updateDegradationFromHealthRatio(0.25);
      expect(service.getDegradationMode()).toBe('emergency');
    });

    it('should not emit event if mode does not change', () => {
      const eventHandler = vi.fn();
      service.on('degradation-change', eventHandler);

      service.updateDegradationFromHealthRatio(0.9);
      service.updateDegradationFromHealthRatio(0.85);

      expect(eventHandler).not.toHaveBeenCalled();
    });

    it('should handle edge case at exact threshold', () => {
      // At exactly the reduced threshold (0.7), it should be 'reduced' mode (<=)
      service.updateDegradationFromHealthRatio(0.7);
      expect(service.getDegradationMode()).toBe('reduced');

      // Just above the threshold should be normal
      service.updateDegradationFromHealthRatio(0.71);
      expect(service.getDegradationMode()).toBe('normal');
    });
  });

  // ==========================================================================
  // Service Tier and Availability Tests
  // ==========================================================================

  describe('service tier and availability', () => {
    beforeEach(() => {
      service = new FailoverService();
    });

    it('should set service tier', () => {
      service.setServiceTier('test-service', 'critical');
      expect(service.isServiceAvailable('test-service')).toBe(true);
    });

    it('should allow all services in normal mode', () => {
      const tiers: ServiceTier[] = ['critical', 'important', 'standard', 'optional'];

      tiers.forEach((tier) => {
        service.setServiceTier(`service-${tier}`, tier);
        expect(service.isServiceAvailable(`service-${tier}`)).toBe(true);
      });
    });

    it('should restrict optional services in reduced mode', () => {
      service.setServiceTier('critical-service', 'critical');
      service.setServiceTier('important-service', 'important');
      service.setServiceTier('standard-service', 'standard');
      service.setServiceTier('optional-service', 'optional');

      service.setDegradationMode('reduced', 'Test');

      expect(service.isServiceAvailable('critical-service')).toBe(true);
      expect(service.isServiceAvailable('important-service')).toBe(true);
      expect(service.isServiceAvailable('standard-service')).toBe(true);
      expect(service.isServiceAvailable('optional-service')).toBe(false);
    });

    it('should allow only critical and important in minimal mode', () => {
      service.setServiceTier('critical-service', 'critical');
      service.setServiceTier('important-service', 'important');
      service.setServiceTier('standard-service', 'standard');
      service.setServiceTier('optional-service', 'optional');

      service.setDegradationMode('minimal', 'Test');

      expect(service.isServiceAvailable('critical-service')).toBe(true);
      expect(service.isServiceAvailable('important-service')).toBe(true);
      expect(service.isServiceAvailable('standard-service')).toBe(false);
      expect(service.isServiceAvailable('optional-service')).toBe(false);
    });

    it('should allow only critical services in emergency mode', () => {
      service.setServiceTier('critical-service', 'critical');
      service.setServiceTier('important-service', 'important');
      service.setServiceTier('standard-service', 'standard');
      service.setServiceTier('optional-service', 'optional');

      service.setDegradationMode('emergency', 'Test');

      expect(service.isServiceAvailable('critical-service')).toBe(true);
      expect(service.isServiceAvailable('important-service')).toBe(false);
      expect(service.isServiceAvailable('standard-service')).toBe(false);
      expect(service.isServiceAvailable('optional-service')).toBe(false);
    });

    it('should default to standard tier for unregistered services', () => {
      service.setDegradationMode('reduced', 'Test');
      expect(service.isServiceAvailable('unregistered-service')).toBe(true);

      service.setDegradationMode('minimal', 'Test');
      expect(service.isServiceAvailable('unregistered-service')).toBe(false);
    });
  });

  // ==========================================================================
  // Backup Service Registration Tests
  // ==========================================================================

  describe('registerBackupService', () => {
    beforeEach(() => {
      service = new FailoverService();
    });

    it('should register backup service', () => {
      const config = createMockBackupServiceConfig();
      const id = service.registerBackupService(config);

      expect(id).toBeDefined();
      expect(typeof id).toBe('string');
    });

    it('should set primary as active service initially', () => {
      const config = createMockBackupServiceConfig({
        primaryService: 'my-primary',
        backupService: 'my-backup',
      });

      service.registerBackupService(config);

      expect(service.getActiveService('my-primary')).toBe('my-primary');
    });

    it('should support different failover strategies', () => {
      const strategies: FailoverStrategy[] = [
        'active-passive',
        'active-active',
        'round-robin',
        'weighted',
        'priority',
      ];

      strategies.forEach((strategy) => {
        const config = createMockBackupServiceConfig({
          primaryService: `primary-${strategy}`,
          strategy,
        });
        const id = service.registerBackupService(config);
        expect(id).toBeDefined();
      });
    });

    it('should register multiple backup services', () => {
      const config1 = createMockBackupServiceConfig({ primaryService: 'service-1' });
      const config2 = createMockBackupServiceConfig({ primaryService: 'service-2' });

      const id1 = service.registerBackupService(config1);
      const id2 = service.registerBackupService(config2);

      expect(id1).toBeDefined();
      expect(id2).toBeDefined();
      expect(id1).not.toBe(id2);
    });
  });

  // ==========================================================================
  // getActiveService Tests
  // ==========================================================================

  describe('getActiveService', () => {
    beforeEach(() => {
      service = new FailoverService();
    });

    it('should return primary service as active initially', () => {
      const config = createMockBackupServiceConfig({
        primaryService: 'my-primary',
        backupService: 'my-backup',
      });

      service.registerBackupService(config);

      expect(service.getActiveService('my-primary')).toBe('my-primary');
    });

    it('should return service itself if not registered', () => {
      expect(service.getActiveService('unknown-service')).toBe('unknown-service');
    });

    it('should return backup service after failover', async () => {
      const config = createMockBackupServiceConfig({
        primaryService: 'my-primary',
        backupService: 'my-backup',
      });

      service.registerBackupService(config);
      await service.switchToBackup('my-primary', 'Test failover');

      expect(service.getActiveService('my-primary')).toBe('my-backup');
    });
  });

  // ==========================================================================
  // switchToBackup Tests
  // ==========================================================================

  describe('switchToBackup', () => {
    beforeEach(() => {
      service = new FailoverService();
    });

    it('should switch to backup service', async () => {
      const config = createMockBackupServiceConfig({
        primaryService: 'my-primary',
        backupService: 'my-backup',
      });

      service.registerBackupService(config);

      const result = await service.switchToBackup('my-primary', 'Test failover');

      expect(result).toBe(true);
      expect(service.getActiveService('my-primary')).toBe('my-backup');
    });

    it('should emit failover event on successful switch', async () => {
      const config = createMockBackupServiceConfig({
        primaryService: 'my-primary',
        backupService: 'my-backup',
      });

      service.registerBackupService(config);

      const eventHandler = vi.fn();
      service.on('failover', eventHandler);

      await service.switchToBackup('my-primary', 'Health check failed');

      expect(eventHandler).toHaveBeenCalledWith({
        fromService: 'my-primary',
        toService: 'my-backup',
        reason: 'Health check failed',
      });
    });

    it('should return false when no backup service is registered', async () => {
      const result = await service.switchToBackup('unknown-service', 'Test');
      expect(result).toBe(false);
    });

    it('should not switch if backup service is disabled', async () => {
      const config = createMockBackupServiceConfig({
        primaryService: 'my-primary',
        backupService: 'my-backup',
        enabled: false,
      });

      service.registerBackupService(config);

      const result = await service.switchToBackup('my-primary', 'Test');

      expect(result).toBe(false);
      expect(service.getActiveService('my-primary')).toBe('my-primary');
    });

    it('should update stats on successful switch', async () => {
      const config = createMockBackupServiceConfig({
        primaryService: 'my-primary',
        backupService: 'my-backup',
      });

      service.registerBackupService(config);

      await service.switchToBackup('my-primary', 'Test');

      const stats = service.getStats();
      expect(stats.totalFailovers).toBe(1);
      expect(stats.successfulFailovers).toBe(1);
    });
  });

  // ==========================================================================
  // switchToPrimary Tests
  // ==========================================================================

  describe('switchToPrimary', () => {
    beforeEach(() => {
      service = new FailoverService();
    });

    it('should switch back to primary service', async () => {
      const config = createMockBackupServiceConfig({
        primaryService: 'my-primary',
        backupService: 'my-backup',
      });

      service.registerBackupService(config);
      await service.switchToBackup('my-primary', 'Test failover');

      expect(service.getActiveService('my-primary')).toBe('my-backup');

      const result = await service.switchToPrimary('my-primary', 'healthy');

      expect(result).toBe(true);
      expect(service.getActiveService('my-primary')).toBe('my-primary');
    });

    it('should return true if already on primary', async () => {
      const config = createMockBackupServiceConfig({
        primaryService: 'my-primary',
        backupService: 'my-backup',
      });

      service.registerBackupService(config);

      const result = await service.switchToPrimary('my-primary', 'healthy');

      expect(result).toBe(true);
      expect(service.getActiveService('my-primary')).toBe('my-primary');
    });

    it('should not switch if primary is unhealthy', async () => {
      const config = createMockBackupServiceConfig({
        primaryService: 'my-primary',
        backupService: 'my-backup',
      });

      service.registerBackupService(config);
      await service.switchToBackup('my-primary', 'Test failover');

      const result = await service.switchToPrimary('my-primary', 'unhealthy');

      expect(result).toBe(false);
      expect(service.getActiveService('my-primary')).toBe('my-backup');
    });

    it('should not switch if primary is degraded', async () => {
      const config = createMockBackupServiceConfig({
        primaryService: 'my-primary',
        backupService: 'my-backup',
      });

      service.registerBackupService(config);
      await service.switchToBackup('my-primary', 'Test failover');

      const result = await service.switchToPrimary('my-primary', 'degraded');

      expect(result).toBe(false);
      expect(service.getActiveService('my-primary')).toBe('my-backup');
    });

    it('should switch without health check when health status is undefined', async () => {
      const config = createMockBackupServiceConfig({
        primaryService: 'my-primary',
        backupService: 'my-backup',
      });

      service.registerBackupService(config);
      await service.switchToBackup('my-primary', 'Test failover');

      const result = await service.switchToPrimary('my-primary');

      expect(result).toBe(true);
      expect(service.getActiveService('my-primary')).toBe('my-primary');
    });
  });

  // ==========================================================================
  // executeFailover Tests
  // ==========================================================================

  describe('executeFailover', () => {
    beforeEach(() => {
      service = new FailoverService();
    });

    it('should execute failover with explicit target service', async () => {
      const event = await service.executeFailover(
        'service-a',
        'Manual failover',
        'service-b'
      );

      expect(event.fromService).toBe('service-a');
      expect(event.toService).toBe('service-b');
      expect(event.reason).toBe('Manual failover');
      expect(event.success).toBe(true);
      expect(event.automatic).toBe(true);
    });

    it('should find backup service automatically', async () => {
      const config = createMockBackupServiceConfig({
        primaryService: 'my-primary',
        backupService: 'my-backup',
      });

      service.registerBackupService(config);

      const event = await service.executeFailover('my-primary', 'Auto failover');

      expect(event.fromService).toBe('my-primary');
      expect(event.toService).toBe('my-backup');
      expect(event.success).toBe(true);
    });

    it('should fail if no backup service available', async () => {
      const event = await service.executeFailover('unknown-service', 'Test');

      expect(event.fromService).toBe('unknown-service');
      expect(event.toService).toBe('unknown-service');
      expect(event.success).toBe(false);
    });

    it('should emit failover event', async () => {
      const eventHandler = vi.fn();
      service.on('failover', eventHandler);

      await service.executeFailover('service-a', 'Test', 'service-b');

      expect(eventHandler).toHaveBeenCalledWith({
        fromService: 'service-a',
        toService: 'service-b',
        reason: 'Test',
      });
    });

    it('should update stats on failover', async () => {
      await service.executeFailover('service-a', 'Test', 'service-b');

      const stats = service.getStats();
      expect(stats.totalFailovers).toBe(1);
      expect(stats.successfulFailovers).toBe(1);
    });

    it('should not execute when disabled', async () => {
      service = new FailoverService({ enabled: false });

      const event = await service.executeFailover('service-a', 'Test', 'service-b');

      expect(event.success).toBe(false);
      expect(service.getActiveService('service-a')).toBe('service-a');
    });

    it('should record event in history', async () => {
      await service.executeFailover('service-a', 'Test', 'service-b');

      const history = service.getFailoverHistory(1);
      expect(history).toHaveLength(1);
      expect(history[0].fromService).toBe('service-a');
      expect(history[0].toService).toBe('service-b');
    });

    it('should include durationMs in event', async () => {
      const event = await service.executeFailover('service-a', 'Test', 'service-b');

      expect(event.durationMs).toBeGreaterThanOrEqual(0);
      expect(typeof event.durationMs).toBe('number');
    });

    it('should have unique event ID', async () => {
      const event1 = await service.executeFailover('service-a', 'Test 1', 'service-b');
      const event2 = await service.executeFailover('service-c', 'Test 2', 'service-d');

      expect(event1.id).toBeDefined();
      expect(event2.id).toBeDefined();
      expect(event1.id).not.toBe(event2.id);
    });
  });

  // ==========================================================================
  // Statistics Tests
  // ==========================================================================

  describe('getStats', () => {
    beforeEach(() => {
      service = new FailoverService();
    });

    it('should return initial stats', () => {
      const stats = service.getStats();

      expect(stats).toEqual({
        totalFailovers: 0,
        successfulFailovers: 0,
        currentDegradationMode: 'normal',
      });
    });

    it('should track total and successful failovers', async () => {
      const config = createMockBackupServiceConfig({
        primaryService: 'my-primary',
        backupService: 'my-backup',
      });

      service.registerBackupService(config);

      await service.executeFailover('my-primary', 'Test 1');
      await service.executeFailover('my-primary', 'Test 2');
      await service.executeFailover('unknown-service', 'Test 3'); // Will fail

      const stats = service.getStats();
      expect(stats.totalFailovers).toBe(3);
      expect(stats.successfulFailovers).toBe(2);
    });

    it('should update current degradation mode', () => {
      service.setDegradationMode('minimal', 'Test');

      const stats = service.getStats();
      expect(stats.currentDegradationMode).toBe('minimal');
    });
  });

  // ==========================================================================
  // Failover History Tests
  // ==========================================================================

  describe('getFailoverHistory', () => {
    beforeEach(() => {
      service = new FailoverService();
    });

    it('should return empty array initially', () => {
      const history = service.getFailoverHistory();
      expect(history).toEqual([]);
    });

    it('should return recent failover events', async () => {
      await service.executeFailover('service-a', 'Test 1', 'service-b');
      await service.executeFailover('service-c', 'Test 2', 'service-d');

      const history = service.getFailoverHistory(10);
      expect(history).toHaveLength(2);
      expect(history[0].fromService).toBe('service-c'); // Most recent first
      expect(history[1].fromService).toBe('service-a');
    });

    it('should limit results to specified count', async () => {
      for (let i = 0; i < 5; i++) {
        await service.executeFailover(`service-${i}`, `Test ${i}`, `backup-${i}`);
      }

      const history = service.getFailoverHistory(3);
      expect(history).toHaveLength(3);
    });

    it('should maintain history up to max size (1000)', async () => {
      // Add more than max history size
      for (let i = 0; i < 1050; i++) {
        await service.executeFailover(`service-${i}`, `Test ${i}`, `backup-${i}`);
      }

      const fullHistory = service.getFailoverHistory(2000);
      expect(fullHistory.length).toBeLessThanOrEqual(1000);
    });

    it('should default to 10 events when no limit specified', async () => {
      for (let i = 0; i < 15; i++) {
        await service.executeFailover(`service-${i}`, `Test ${i}`, `backup-${i}`);
      }

      const history = service.getFailoverHistory();
      expect(history).toHaveLength(10);
    });
  });

  // ==========================================================================
  // Shutdown Tests
  // ==========================================================================

  describe('shutdown', () => {
    beforeEach(() => {
      service = new FailoverService();
    });

    it('should remove all event listeners', async () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      service.on('failover', handler1);
      service.on('degradation-change', handler2);

      await service.shutdown();

      await service.executeFailover('service-a', 'Test', 'service-b');
      service.setDegradationMode('minimal', 'Test');

      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).not.toHaveBeenCalled();
    });

    it('should be safe to call shutdown multiple times', async () => {
      await expect(service.shutdown()).resolves.not.toThrow();
      await expect(service.shutdown()).resolves.not.toThrow();
    });

    it('should complete gracefully', async () => {
      await service.executeFailover('service-a', 'Test', 'service-b');
      await expect(service.shutdown()).resolves.not.toThrow();
    });
  });

  // ==========================================================================
  // Edge Cases and Integration Tests
  // ==========================================================================

  describe('edge cases', () => {
    beforeEach(() => {
      service = new FailoverService();
    });

    it('should handle concurrent failovers', async () => {
      const config1 = createMockBackupServiceConfig({
        primaryService: 'service-1',
        backupService: 'backup-1',
      });
      const config2 = createMockBackupServiceConfig({
        primaryService: 'service-2',
        backupService: 'backup-2',
      });

      service.registerBackupService(config1);
      service.registerBackupService(config2);

      const [result1, result2] = await Promise.all([
        service.switchToBackup('service-1', 'Concurrent test 1'),
        service.switchToBackup('service-2', 'Concurrent test 2'),
      ]);

      expect(result1).toBe(true);
      expect(result2).toBe(true);
      expect(service.getActiveService('service-1')).toBe('backup-1');
      expect(service.getActiveService('service-2')).toBe('backup-2');
    });

    it('should handle fallback with zero delay', async () => {
      const primaryFn = vi.fn().mockRejectedValue(new Error('Primary failed'));
      const fallbackFn = vi.fn().mockResolvedValue('fallback result');

      service.registerFallback('test-service', createMockFallbackConfig({
        fallbackFn,
        maxAttempts: 2,
        delayMs: 0,
      }));

      const result = await service.executeWithFallback('test-service', primaryFn);

      expect(result).toBe('fallback result');
    });

    it('should handle empty reason in failover', async () => {
      const event = await service.executeFailover('service-a', '', 'service-b');

      expect(event.reason).toBe('');
      expect(event.success).toBe(true);
    });

    it('should handle service name with special characters', async () => {
      const serviceName = 'service-with-special-chars-#$%';
      const fallbackFn = vi.fn().mockResolvedValue('result');

      service.registerFallback(serviceName, createMockFallbackConfig({
        fallbackFn,
        maxAttempts: 1,
      }));

      const fallbacks = service.getFallbacks(serviceName);
      expect(fallbacks).toHaveLength(1);
    });

    it('should handle extremely high health ratios', () => {
      service.updateDegradationFromHealthRatio(1.5);
      expect(service.getDegradationMode()).toBe('normal');
    });

    it('should handle negative health ratios', () => {
      service.updateDegradationFromHealthRatio(-0.5);
      expect(service.getDegradationMode()).toBe('emergency');
    });

    it('should handle very long fallback chains', async () => {
      const primaryFn = vi.fn().mockRejectedValue(new Error('Primary failed'));

      // Register 10 fallbacks
      for (let i = 0; i < 10; i++) {
        const fallbackFn = vi.fn().mockRejectedValue(new Error(`Fallback ${i} failed`));
        service.registerFallback('test-service', createMockFallbackConfig({
          fallbackFn,
          priority: i,
          maxAttempts: 1,
        }));
      }

      // Add one that succeeds at the end
      const successFn = vi.fn().mockResolvedValue('success');
      service.registerFallback('test-service', createMockFallbackConfig({
        fallbackFn: successFn,
        priority: 10,
        maxAttempts: 1,
      }));

      const result = await service.executeWithFallback('test-service', primaryFn);

      expect(result).toBe('success');
    });

    it('should maintain state consistency after multiple operations', async () => {
      const config = createMockBackupServiceConfig({
        primaryService: 'my-primary',
        backupService: 'my-backup',
      });

      service.registerBackupService(config);

      // Perform multiple switches
      await service.switchToBackup('my-primary', 'Test 1');
      await service.switchToPrimary('my-primary', 'healthy');
      await service.switchToBackup('my-primary', 'Test 2');

      expect(service.getActiveService('my-primary')).toBe('my-backup');

      const stats = service.getStats();
      expect(stats.totalFailovers).toBe(2); // Only switchToBackup calls count
    });
  });

  // ==========================================================================
  // Configuration Integration Tests
  // ==========================================================================

  describe('configuration integration', () => {
    it('should work with redundancy enabled but graceful degradation disabled', async () => {
      service = new FailoverService({
        redundancyEnabled: true,
        gracefulDegradationEnabled: false,
      });

      const config = createMockBackupServiceConfig({
        primaryService: 'my-primary',
        backupService: 'my-backup',
      });

      service.registerBackupService(config);
      const result = await service.switchToBackup('my-primary', 'Test');

      expect(result).toBe(true);
    });

    it('should work with graceful degradation enabled but redundancy disabled', async () => {
      service = new FailoverService({
        redundancyEnabled: false,
        gracefulDegradationEnabled: true,
      });

      const primaryFn = vi.fn().mockRejectedValue(new Error('Failed'));
      const fallbackFn = vi.fn().mockResolvedValue('result');

      service.registerFallback('test-service', createMockFallbackConfig({
        fallbackFn,
        maxAttempts: 1,
      }));

      const result = await service.executeWithFallback('test-service', primaryFn);
      expect(result).toBe('result');
    });

    it('should work with everything disabled', () => {
      service = new FailoverService({
        enabled: false,
        redundancyEnabled: false,
        gracefulDegradationEnabled: false,
      });

      expect(service).toBeDefined();
      expect(service.getDegradationMode()).toBe('normal');
    });

    it('should respect custom service tiers from config', () => {
      service = new FailoverService({
        serviceTiers: {
          'service-a': 'critical',
          'service-b': 'optional',
        },
      });

      service.setDegradationMode('reduced', 'Test');

      expect(service.isServiceAvailable('service-a')).toBe(true);
      expect(service.isServiceAvailable('service-b')).toBe(false);
    });
  });
});
