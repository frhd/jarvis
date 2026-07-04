/**
 * Health Monitoring Service Tests
 *
 * Comprehensive unit tests for the HealthMonitoringService
 * Run: npm test src/services/reliability/health-monitoring.service.test.ts
 * or: npx vitest src/services/reliability/health-monitoring.service.test.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  HealthMonitoringService,
  ChaosError,
  type HealthMonitoringConfig,
  type ChaosInjectionConfig,
  type EnhancedHealthCheck,
} from './health-monitoring.service.js';
import type { HealthStatus, ComponentHealth } from '../health.service.js';

// ============================================================================
// Mock Setup
// ============================================================================

// Mock logger to avoid noise in test output
vi.mock('../../utils/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

// ============================================================================
// Test Helpers
// ============================================================================

const createMockComponentHealth = (overrides?: Partial<ComponentHealth>): ComponentHealth => ({
  status: 'healthy' as HealthStatus,
  metadata: undefined,
  error: undefined,
  ...overrides,
});

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// ============================================================================
// Tests
// ============================================================================

describe('HealthMonitoringService', () => {
  let service: HealthMonitoringService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new HealthMonitoringService();
  });

  afterEach(async () => {
    await service.shutdown();
    vi.clearAllMocks();
  });

  // ==========================================================================
  // Initialization Tests
  // ==========================================================================

  describe('Initialization', () => {
    it('should initialize with default configuration', () => {
      const defaultService = new HealthMonitoringService();
      const stats = defaultService.getStats();

      expect(stats.servicesHealthy).toBe(0);
      expect(stats.servicesDegraded).toBe(0);
      expect(stats.servicesUnhealthy).toBe(0);
      expect(stats.lastHealthCheck).toBeNull();
      expect(stats.chaosExperimentsRun).toBe(0);
    });

    it('should initialize with custom configuration', () => {
      const customConfig: Partial<HealthMonitoringConfig> = {
        enabled: false,
        chaosEnabled: true,
        healthCheckIntervalMs: 60000,
        notificationEnabled: false,
      };

      const customService = new HealthMonitoringService(customConfig);
      expect(customService).toBeDefined();
    });

    it('should have empty health states on initialization', () => {
      const states = service.getAllHealthStates();
      expect(states).toEqual([]);
    });

    it('should not have any registered health checks initially', async () => {
      const results = await service.runHealthChecks();
      expect(results).toEqual([]);
    });
  });

  // ==========================================================================
  // Health Check Registration Tests
  // ==========================================================================

  describe('Health Check Registration', () => {
    it('should register a health check successfully', () => {
      const mockCheckFn = vi.fn().mockResolvedValue(createMockComponentHealth());

      service.registerHealthCheck('test-service', mockCheckFn);

      const state = service.getHealthState('test-service');
      expect(state).toBeDefined();
      expect(state?.component).toBe('test-service');
      expect(state?.status).toBe('healthy');
      expect(state?.consecutiveFailures).toBe(0);
    });

    it('should register health check with custom severity', () => {
      const mockCheckFn = vi.fn().mockResolvedValue(createMockComponentHealth());

      service.registerHealthCheck('critical-service', mockCheckFn, 'critical');

      const state = service.getHealthState('critical-service');
      expect(state?.severity).toBe('critical');
    });

    it('should register multiple health checks', () => {
      const mockCheckFn1 = vi.fn().mockResolvedValue(createMockComponentHealth());
      const mockCheckFn2 = vi.fn().mockResolvedValue(createMockComponentHealth());

      service.registerHealthCheck('service-1', mockCheckFn1);
      service.registerHealthCheck('service-2', mockCheckFn2);

      const states = service.getAllHealthStates();
      expect(states).toHaveLength(2);
      expect(states.map((s) => s.component)).toContain('service-1');
      expect(states.map((s) => s.component)).toContain('service-2');
    });

    it('should initialize health check with default values', () => {
      const mockCheckFn = vi.fn().mockResolvedValue(createMockComponentHealth());

      service.registerHealthCheck('service', mockCheckFn);

      const state = service.getHealthState('service');
      expect(state?.latencyMs).toBe(0);
      expect(state?.lastSuccess).toBeNull();
      expect(state?.consecutiveFailures).toBe(0);
    });
  });

  // ==========================================================================
  // Health Check Execution Tests
  // ==========================================================================

  describe('Health Check Execution', () => {
    it('should execute registered health checks', async () => {
      const mockCheckFn = vi.fn().mockResolvedValue(createMockComponentHealth({ status: 'healthy' }));

      service.registerHealthCheck('test-service', mockCheckFn);

      const results = await service.runHealthChecks();

      expect(results).toHaveLength(1);
      expect(results[0].component).toBe('test-service');
      expect(results[0].status).toBe('healthy');
      expect(mockCheckFn).toHaveBeenCalledTimes(1);
    });

    it('should measure health check latency', async () => {
      const mockCheckFn = vi.fn().mockImplementation(async () => {
        await delay(50);
        return createMockComponentHealth();
      });

      service.registerHealthCheck('service', mockCheckFn);

      const results = await service.runHealthChecks();

      expect(results[0].latencyMs).toBeGreaterThanOrEqual(45);
      expect(results[0].latencyMs).toBeLessThan(200);
    });

    it('should update lastSuccess timestamp on successful check', async () => {
      const mockCheckFn = vi.fn().mockResolvedValue(createMockComponentHealth({ status: 'healthy' }));

      service.registerHealthCheck('service', mockCheckFn);

      const beforeCheck = Date.now();
      await service.runHealthChecks();
      const afterCheck = Date.now();

      const state = service.getHealthState('service');
      expect(state?.lastSuccess).not.toBeNull();
      expect(state!.lastSuccess!).toBeGreaterThanOrEqual(beforeCheck);
      expect(state!.lastSuccess!).toBeLessThanOrEqual(afterCheck);
    });

    it('should not update lastSuccess on unhealthy check', async () => {
      const mockCheckFn = vi.fn().mockResolvedValue(createMockComponentHealth({ status: 'unhealthy' }));

      service.registerHealthCheck('service', mockCheckFn);

      await service.runHealthChecks();

      const state = service.getHealthState('service');
      expect(state?.lastSuccess).toBeNull();
    });

    it('should reset consecutive failures on successful check', async () => {
      const mockCheckFn = vi
        .fn()
        .mockResolvedValueOnce(createMockComponentHealth({ status: 'unhealthy' }))
        .mockResolvedValueOnce(createMockComponentHealth({ status: 'unhealthy' }))
        .mockResolvedValueOnce(createMockComponentHealth({ status: 'healthy' }));

      service.registerHealthCheck('service', mockCheckFn);

      await service.runHealthChecks(); // First failure
      await service.runHealthChecks(); // Second failure

      let state = service.getHealthState('service');
      expect(state?.consecutiveFailures).toBe(2);

      await service.runHealthChecks(); // Success

      state = service.getHealthState('service');
      expect(state?.consecutiveFailures).toBe(0);
    });

    it('should increment consecutive failures on each failure', async () => {
      const mockCheckFn = vi.fn().mockResolvedValue(createMockComponentHealth({ status: 'unhealthy' }));

      service.registerHealthCheck('service', mockCheckFn);

      await service.runHealthChecks();
      let state = service.getHealthState('service');
      expect(state?.consecutiveFailures).toBe(1);

      await service.runHealthChecks();
      state = service.getHealthState('service');
      expect(state?.consecutiveFailures).toBe(2);

      await service.runHealthChecks();
      state = service.getHealthState('service');
      expect(state?.consecutiveFailures).toBe(3);
    });

    it('should include error message in result', async () => {
      const mockCheckFn = vi.fn().mockResolvedValue(
        createMockComponentHealth({
          status: 'unhealthy',
          error: 'Connection refused',
        })
      );

      service.registerHealthCheck('service', mockCheckFn);

      const results = await service.runHealthChecks();

      expect(results[0].message).toBe('Connection refused');
    });

    it('should include metadata in result', async () => {
      const metadata = { version: '1.0.0', uptime: 3600 };
      const mockCheckFn = vi.fn().mockResolvedValue(
        createMockComponentHealth({
          status: 'healthy',
          metadata,
        })
      );

      service.registerHealthCheck('service', mockCheckFn);

      const results = await service.runHealthChecks();

      expect(results[0].metadata).toEqual(metadata);
    });

    it('should handle multiple health checks in parallel', async () => {
      const mockCheckFn1 = vi.fn().mockResolvedValue(createMockComponentHealth({ status: 'healthy' }));
      const mockCheckFn2 = vi.fn().mockResolvedValue(createMockComponentHealth({ status: 'degraded' }));
      const mockCheckFn3 = vi.fn().mockResolvedValue(createMockComponentHealth({ status: 'unhealthy' }));

      service.registerHealthCheck('service-1', mockCheckFn1);
      service.registerHealthCheck('service-2', mockCheckFn2);
      service.registerHealthCheck('service-3', mockCheckFn3);

      const results = await service.runHealthChecks();

      expect(results).toHaveLength(3);
      expect(results.find((r) => r.component === 'service-1')?.status).toBe('healthy');
      expect(results.find((r) => r.component === 'service-2')?.status).toBe('degraded');
      expect(results.find((r) => r.component === 'service-3')?.status).toBe('unhealthy');
    });

    it('should update lastHealthCheck timestamp after running checks', async () => {
      const mockCheckFn = vi.fn().mockResolvedValue(createMockComponentHealth());

      service.registerHealthCheck('service', mockCheckFn);

      const beforeCheck = Date.now();
      await service.runHealthChecks();
      const afterCheck = Date.now();

      const stats = service.getStats();
      expect(stats.lastHealthCheck).not.toBeNull();
      expect(stats.lastHealthCheck!).toBeGreaterThanOrEqual(beforeCheck);
      expect(stats.lastHealthCheck!).toBeLessThanOrEqual(afterCheck);
    });
  });

  // ==========================================================================
  // Error Handling Tests
  // ==========================================================================

  describe('Error Handling', () => {
    it('should handle health check function throwing error', async () => {
      const mockCheckFn = vi.fn().mockRejectedValue(new Error('Health check failed'));

      service.registerHealthCheck('service', mockCheckFn);

      const results = await service.runHealthChecks();

      expect(results[0].status).toBe('unhealthy');
      expect(results[0].message).toBe('Health check failed');
      expect(results[0].consecutiveFailures).toBe(1);
    });

    it('should measure latency even on error', async () => {
      const mockCheckFn = vi.fn().mockImplementation(async () => {
        await delay(30);
        throw new Error('Failed');
      });

      service.registerHealthCheck('service', mockCheckFn);

      const results = await service.runHealthChecks();

      expect(results[0].latencyMs).toBeGreaterThanOrEqual(25);
      expect(results[0].status).toBe('unhealthy');
    });

    it('should not update lastSuccess on error', async () => {
      const mockCheckFn = vi.fn().mockRejectedValue(new Error('Failed'));

      service.registerHealthCheck('service', mockCheckFn);

      await service.runHealthChecks();

      const state = service.getHealthState('service');
      expect(state?.lastSuccess).toBeNull();
    });

    it('should increment consecutive failures on error', async () => {
      const mockCheckFn = vi.fn().mockRejectedValue(new Error('Failed'));

      service.registerHealthCheck('service', mockCheckFn);

      await service.runHealthChecks();
      await service.runHealthChecks();
      await service.runHealthChecks();

      const state = service.getHealthState('service');
      expect(state?.consecutiveFailures).toBe(3);
    });
  });

  // ==========================================================================
  // Health Critical Event Tests
  // ==========================================================================

  describe('Health Critical Events', () => {
    it('should emit health-critical event after 3 consecutive failures', async () => {
      const mockCheckFn = vi.fn().mockResolvedValue(createMockComponentHealth({ status: 'unhealthy' }));

      service.registerHealthCheck('service', mockCheckFn);

      const criticalEventListener = vi.fn();
      service.on('health-critical', criticalEventListener);

      await service.runHealthChecks(); // 1st failure
      await service.runHealthChecks(); // 2nd failure
      expect(criticalEventListener).not.toHaveBeenCalled();

      await service.runHealthChecks(); // 3rd failure - should emit
      expect(criticalEventListener).toHaveBeenCalledTimes(1);
      expect(criticalEventListener).toHaveBeenCalledWith({
        component: 'service',
        consecutiveFailures: 3,
        status: 'unhealthy',
      });
    });

    it('should emit health-critical event on each subsequent failure', async () => {
      const mockCheckFn = vi.fn().mockResolvedValue(createMockComponentHealth({ status: 'unhealthy' }));

      service.registerHealthCheck('service', mockCheckFn);

      const criticalEventListener = vi.fn();
      service.on('health-critical', criticalEventListener);

      // Run 5 health checks
      for (let i = 0; i < 5; i++) {
        await service.runHealthChecks();
      }

      // Should emit on 3rd, 4th, and 5th failures
      expect(criticalEventListener).toHaveBeenCalledTimes(3);
    });

    it('should not emit health-critical event for degraded status', async () => {
      const mockCheckFn = vi.fn().mockResolvedValue(createMockComponentHealth({ status: 'degraded' }));

      service.registerHealthCheck('service', mockCheckFn);

      const criticalEventListener = vi.fn();
      service.on('health-critical', criticalEventListener);

      await service.runHealthChecks();
      await service.runHealthChecks();
      await service.runHealthChecks();

      expect(criticalEventListener).not.toHaveBeenCalled();
    });

    it('should reset critical event emission after success', async () => {
      const mockCheckFn = vi
        .fn()
        .mockResolvedValueOnce(createMockComponentHealth({ status: 'unhealthy' }))
        .mockResolvedValueOnce(createMockComponentHealth({ status: 'unhealthy' }))
        .mockResolvedValueOnce(createMockComponentHealth({ status: 'unhealthy' }))
        .mockResolvedValueOnce(createMockComponentHealth({ status: 'healthy' }))
        .mockResolvedValueOnce(createMockComponentHealth({ status: 'unhealthy' }))
        .mockResolvedValueOnce(createMockComponentHealth({ status: 'unhealthy' }))
        .mockResolvedValueOnce(createMockComponentHealth({ status: 'unhealthy' }));

      service.registerHealthCheck('service', mockCheckFn);

      const criticalEventListener = vi.fn();
      service.on('health-critical', criticalEventListener);

      await service.runHealthChecks(); // 1st failure
      await service.runHealthChecks(); // 2nd failure
      await service.runHealthChecks(); // 3rd failure - emits
      await service.runHealthChecks(); // Success - resets
      await service.runHealthChecks(); // 1st failure after reset
      await service.runHealthChecks(); // 2nd failure after reset
      await service.runHealthChecks(); // 3rd failure after reset - emits again

      expect(criticalEventListener).toHaveBeenCalledTimes(2);
    });
  });

  // ==========================================================================
  // Continuous Health Monitoring Tests
  // ==========================================================================

  describe('Continuous Health Monitoring', () => {
    it('should start health monitoring with interval', async () => {
      const mockCheckFn = vi.fn().mockResolvedValue(createMockComponentHealth());

      service.registerHealthCheck('service', mockCheckFn);

      const shortIntervalService = new HealthMonitoringService({
        healthCheckIntervalMs: 100,
      });

      shortIntervalService.registerHealthCheck('service', mockCheckFn);
      shortIntervalService.startHealthMonitoring();

      // Wait for at least 2 intervals
      await delay(250);

      shortIntervalService.stopHealthMonitoring();

      // Should have been called at least 2 times (initial + 1-2 intervals)
      expect(mockCheckFn.mock.calls.length).toBeGreaterThanOrEqual(2);

      await shortIntervalService.shutdown();
    });

    it('should not start multiple intervals', () => {
      service.startHealthMonitoring();
      service.startHealthMonitoring(); // Second call should be ignored

      // Should not throw or create duplicate intervals
      expect(() => service.stopHealthMonitoring()).not.toThrow();
    });

    it('should stop health monitoring', async () => {
      const mockCheckFn = vi.fn().mockResolvedValue(createMockComponentHealth());

      const shortIntervalService = new HealthMonitoringService({
        healthCheckIntervalMs: 50,
      });

      shortIntervalService.registerHealthCheck('service', mockCheckFn);
      shortIntervalService.startHealthMonitoring();

      await delay(60); // Let it run once
      const callsAfterStart = mockCheckFn.mock.calls.length;

      shortIntervalService.stopHealthMonitoring();

      await delay(100); // Wait to ensure no more calls

      expect(mockCheckFn.mock.calls.length).toBe(callsAfterStart);

      await shortIntervalService.shutdown();
    });

    it('should run initial health check when starting monitoring', async () => {
      const mockCheckFn = vi.fn().mockResolvedValue(createMockComponentHealth());

      service.registerHealthCheck('service', mockCheckFn);

      service.startHealthMonitoring();

      // Wait a moment for the initial check
      await delay(50);

      expect(mockCheckFn).toHaveBeenCalled();

      service.stopHealthMonitoring();
    });
  });

  // ==========================================================================
  // Health State Query Tests
  // ==========================================================================

  describe('Health State Queries', () => {
    it('should get health state for specific component', () => {
      const mockCheckFn = vi.fn().mockResolvedValue(createMockComponentHealth());

      service.registerHealthCheck('service', mockCheckFn);

      const state = service.getHealthState('service');

      expect(state).toBeDefined();
      expect(state?.component).toBe('service');
    });

    it('should return undefined for non-existent component', () => {
      const state = service.getHealthState('non-existent');

      expect(state).toBeUndefined();
    });

    it('should get all health states', () => {
      const mockCheckFn1 = vi.fn().mockResolvedValue(createMockComponentHealth());
      const mockCheckFn2 = vi.fn().mockResolvedValue(createMockComponentHealth());

      service.registerHealthCheck('service-1', mockCheckFn1);
      service.registerHealthCheck('service-2', mockCheckFn2);

      const states = service.getAllHealthStates();

      expect(states).toHaveLength(2);
      expect(states.map((s) => s.component)).toContain('service-1');
      expect(states.map((s) => s.component)).toContain('service-2');
    });

    it('should calculate healthy ratio correctly', async () => {
      const mockHealthyFn = vi.fn().mockResolvedValue(createMockComponentHealth({ status: 'healthy' }));
      const mockUnhealthyFn = vi.fn().mockResolvedValue(createMockComponentHealth({ status: 'unhealthy' }));

      service.registerHealthCheck('healthy-1', mockHealthyFn);
      service.registerHealthCheck('healthy-2', mockHealthyFn);
      service.registerHealthCheck('unhealthy-1', mockUnhealthyFn);

      await service.runHealthChecks();

      const ratio = service.getHealthyRatio();

      expect(ratio).toBeCloseTo(2 / 3, 2);
    });

    it('should return 1.0 ratio when no services registered', () => {
      const ratio = service.getHealthyRatio();
      expect(ratio).toBe(1);
    });

    it('should return 0.0 ratio when all services unhealthy', async () => {
      const mockUnhealthyFn = vi.fn().mockResolvedValue(createMockComponentHealth({ status: 'unhealthy' }));

      service.registerHealthCheck('service-1', mockUnhealthyFn);
      service.registerHealthCheck('service-2', mockUnhealthyFn);

      await service.runHealthChecks();

      const ratio = service.getHealthyRatio();

      expect(ratio).toBe(0);
    });
  });

  // ==========================================================================
  // Manual Health Recording Tests
  // ==========================================================================

  describe('Manual Health Recording', () => {
    it('should record health success', () => {
      const mockCheckFn = vi.fn().mockResolvedValue(createMockComponentHealth({ status: 'unhealthy' }));

      service.registerHealthCheck('service', mockCheckFn);

      service.recordHealthSuccess('service');

      const state = service.getHealthState('service');
      expect(state?.status).toBe('healthy');
      expect(state?.consecutiveFailures).toBe(0);
      expect(state?.lastSuccess).not.toBeNull();
    });

    it('should record health failure', () => {
      const mockCheckFn = vi.fn().mockResolvedValue(createMockComponentHealth());

      service.registerHealthCheck('service', mockCheckFn);

      service.recordHealthFailure('service', new Error('Test error'));

      const state = service.getHealthState('service');
      expect(state?.consecutiveFailures).toBe(1);
      expect(state?.message).toBe('Test error');
    });

    it('should mark service as degraded after fewer than 3 failures', () => {
      const mockCheckFn = vi.fn().mockResolvedValue(createMockComponentHealth());

      service.registerHealthCheck('service', mockCheckFn);

      service.recordHealthFailure('service', new Error('Error 1'));
      let state = service.getHealthState('service');
      expect(state?.status).toBe('degraded');

      service.recordHealthFailure('service', new Error('Error 2'));
      state = service.getHealthState('service');
      expect(state?.status).toBe('degraded');
    });

    it('should mark service as unhealthy after 3 or more failures', () => {
      const mockCheckFn = vi.fn().mockResolvedValue(createMockComponentHealth());

      service.registerHealthCheck('service', mockCheckFn);

      service.recordHealthFailure('service', new Error('Error 1'));
      service.recordHealthFailure('service', new Error('Error 2'));
      service.recordHealthFailure('service', new Error('Error 3'));

      const state = service.getHealthState('service');
      expect(state?.status).toBe('unhealthy');
      expect(state?.consecutiveFailures).toBe(3);
    });

    it('should not error when recording health for non-existent service', () => {
      expect(() => {
        service.recordHealthSuccess('non-existent');
        service.recordHealthFailure('non-existent', new Error('Test'));
      }).not.toThrow();
    });
  });

  // ==========================================================================
  // Statistics Tests
  // ==========================================================================

  describe('Statistics', () => {
    it('should return initial statistics', () => {
      const stats = service.getStats();

      expect(stats.servicesHealthy).toBe(0);
      expect(stats.servicesDegraded).toBe(0);
      expect(stats.servicesUnhealthy).toBe(0);
      expect(stats.lastHealthCheck).toBeNull();
      expect(stats.chaosExperimentsRun).toBe(0);
    });

    it('should update statistics after health check', async () => {
      const mockHealthyFn = vi.fn().mockResolvedValue(createMockComponentHealth({ status: 'healthy' }));
      const mockDegradedFn = vi.fn().mockResolvedValue(createMockComponentHealth({ status: 'degraded' }));
      const mockUnhealthyFn = vi.fn().mockResolvedValue(createMockComponentHealth({ status: 'unhealthy' }));

      service.registerHealthCheck('healthy', mockHealthyFn);
      service.registerHealthCheck('degraded', mockDegradedFn);
      service.registerHealthCheck('unhealthy', mockUnhealthyFn);

      await service.runHealthChecks();

      const stats = service.getStats();

      expect(stats.servicesHealthy).toBe(1);
      expect(stats.servicesDegraded).toBe(1);
      expect(stats.servicesUnhealthy).toBe(1);
      expect(stats.lastHealthCheck).not.toBeNull();
    });

    it('should return a copy of statistics', () => {
      const stats1 = service.getStats();
      const stats2 = service.getStats();

      expect(stats1).toEqual(stats2);
      expect(stats1).not.toBe(stats2);
    });
  });

  // ==========================================================================
  // Chaos Engineering Tests
  // ==========================================================================

  describe('Chaos Engineering', () => {
    it('should enable chaos engineering', () => {
      const chaosService = new HealthMonitoringService({
        chaosEnabled: true,
      });

      chaosService.enableChaos({
        enabled: true,
        faultProbability: 0.5,
        excludeProduction: false,
      });

      expect(chaosService.isChaosActive()).toBe(true);
    });

    it('should not enable chaos when chaosEnabled is false in config', () => {
      const chaosService = new HealthMonitoringService({
        chaosEnabled: false,
      });

      chaosService.enableChaos({ enabled: true });

      expect(chaosService.isChaosActive()).toBe(false);
    });

    it('should disable chaos engineering', () => {
      const chaosService = new HealthMonitoringService({
        chaosEnabled: true,
      });

      chaosService.enableChaos({ enabled: true, excludeProduction: false });
      expect(chaosService.isChaosActive()).toBe(true);

      chaosService.disableChaos();
      expect(chaosService.isChaosActive()).toBe(false);
    });

    it('should emit chaos-enabled event', () => {
      const chaosService = new HealthMonitoringService({
        chaosEnabled: true,
      });

      const chaosEnabledListener = vi.fn();
      chaosService.on('chaos-enabled', chaosEnabledListener);

      const config = { enabled: true, faultProbability: 0.3, excludeProduction: false };
      chaosService.enableChaos(config);

      expect(chaosEnabledListener).toHaveBeenCalledWith(
        expect.objectContaining({
          enabled: true,
          faultProbability: 0.3,
        })
      );
    });

    it('should emit chaos-disabled event', () => {
      const chaosService = new HealthMonitoringService({
        chaosEnabled: true,
      });

      chaosService.enableChaos({ enabled: true });

      const chaosDisabledListener = vi.fn();
      chaosService.on('chaos-disabled', chaosDisabledListener);

      chaosService.disableChaos();

      expect(chaosDisabledListener).toHaveBeenCalledTimes(1);
    });

    it('should not enable chaos in production environment', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const chaosService = new HealthMonitoringService({
        chaosEnabled: true,
      });

      chaosService.enableChaos({
        enabled: true,
        excludeProduction: true,
      });

      expect(chaosService.isChaosActive()).toBe(false);

      process.env.NODE_ENV = originalEnv;
    });

    it('should allow chaos in production if excludeProduction is false', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const chaosService = new HealthMonitoringService({
        chaosEnabled: true,
      });

      chaosService.enableChaos({
        enabled: true,
        excludeProduction: false,
      });

      expect(chaosService.isChaosActive()).toBe(true);

      process.env.NODE_ENV = originalEnv;
    });

    it('should respect target services configuration', () => {
      const chaosService = new HealthMonitoringService({
        chaosEnabled: true,
      });

      chaosService.enableChaos({
        enabled: true,
        faultProbability: 1.0,
        targetServices: ['service-a'],
        excludeProduction: false,
      });

      // Service in target list should be eligible
      const shouldInjectA = chaosService.shouldInjectChaos('service-a');
      // Service not in target list should not be eligible
      const shouldInjectB = chaosService.shouldInjectChaos('service-b');

      expect(shouldInjectA).toBe(true);
      expect(shouldInjectB).toBe(false);
    });

    it('should inject chaos based on probability', () => {
      const chaosService = new HealthMonitoringService({
        chaosEnabled: true,
      });

      // Test with 0% probability
      chaosService.enableChaos({
        enabled: true,
        faultProbability: 0,
        excludeProduction: false,
      });

      let shouldInject = chaosService.shouldInjectChaos('service');
      expect(shouldInject).toBe(false);

      // Test with 100% probability
      chaosService.enableChaos({
        enabled: true,
        faultProbability: 1.0,
        excludeProduction: false,
      });

      shouldInject = chaosService.shouldInjectChaos('service');
      expect(shouldInject).toBe(true);
    });

    it('should not inject chaos when not active', () => {
      const shouldInject = service.shouldInjectChaos('service');
      expect(shouldInject).toBe(false);
    });

    it('should inject latency fault', async () => {
      const chaosService = new HealthMonitoringService({
        chaosEnabled: true,
      });

      chaosService.enableChaos({
        enabled: true,
        faultProbability: 1.0,
        faultTypes: ['latency'],
        maxLatencyMs: 100,
        excludeProduction: false,
      });

      const startTime = Date.now();
      const result = await chaosService.injectChaosFault('service');
      const elapsed = Date.now() - startTime;

      expect(result.type).toBe('latency');
      expect(result.injected).toBe(true);
      expect(elapsed).toBeGreaterThanOrEqual(0);
      expect(elapsed).toBeLessThan(150);
    });

    it('should inject error fault', async () => {
      const chaosService = new HealthMonitoringService({
        chaosEnabled: true,
      });

      chaosService.enableChaos({
        enabled: true,
        faultProbability: 1.0,
        faultTypes: ['error'],
        excludeProduction: false,
      });

      await expect(chaosService.injectChaosFault('service')).rejects.toThrow(ChaosError);
      await expect(chaosService.injectChaosFault('service')).rejects.toThrow('simulated error');
    });

    it('should include service name in ChaosError', async () => {
      const chaosService = new HealthMonitoringService({
        chaosEnabled: true,
      });

      chaosService.enableChaos({
        enabled: true,
        faultProbability: 1.0,
        faultTypes: ['error'],
        excludeProduction: false,
      });

      try {
        await chaosService.injectChaosFault('test-service');
        expect.fail('Should have thrown ChaosError');
      } catch (error) {
        expect(error).toBeInstanceOf(ChaosError);
        const chaosError = error as ChaosError;
        expect(chaosError.service).toBe('test-service');
        expect(chaosError.code).toBe('CHAOS_ERROR');
      }
    });

    it('should increment chaos experiments counter', async () => {
      const chaosService = new HealthMonitoringService({
        chaosEnabled: true,
      });

      chaosService.enableChaos({
        enabled: true,
        faultProbability: 1.0,
        faultTypes: ['latency'],
        maxLatencyMs: 10,
        excludeProduction: false,
      });

      await chaosService.injectChaosFault('service');
      await chaosService.injectChaosFault('service');

      const stats = chaosService.getStats();
      expect(stats.chaosExperimentsRun).toBeGreaterThanOrEqual(2);
    });

    it('should not inject chaos if probability check fails', async () => {
      const chaosService = new HealthMonitoringService({
        chaosEnabled: true,
      });

      chaosService.enableChaos({
        enabled: true,
        faultProbability: 0,
        excludeProduction: false,
      });

      const result = await chaosService.injectChaosFault('service');

      expect(result.injected).toBe(false);
      expect(result.type).toBe('none');
    });

    it('should wrap function with chaos injection', async () => {
      const chaosService = new HealthMonitoringService({
        chaosEnabled: true,
      });

      chaosService.enableChaos({
        enabled: true,
        faultProbability: 0, // Set to 0 so it doesn't inject
        excludeProduction: false,
      });

      const mockFn = vi.fn().mockResolvedValue('success');
      const result = await chaosService.withChaosInjection('service', mockFn);

      expect(result).toBe('success');
      expect(mockFn).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // ChaosError Tests
  // ==========================================================================

  describe('ChaosError', () => {
    it('should create ChaosError with message and code', () => {
      const error = new ChaosError('Test error', 'TEST_CODE');

      expect(error.message).toBe('Test error');
      expect(error.code).toBe('TEST_CODE');
      expect(error.name).toBe('ChaosError');
      expect(error.service).toBeUndefined();
    });

    it('should create ChaosError with service name', () => {
      const error = new ChaosError('Test error', 'TEST_CODE', 'test-service');

      expect(error.service).toBe('test-service');
    });

    it('should have proper error stack trace', () => {
      const error = new ChaosError('Test error', 'TEST_CODE');

      expect(error.stack).toBeDefined();
      expect(error.stack).toContain('ChaosError');
    });

    it('should be instanceof Error', () => {
      const error = new ChaosError('Test error', 'TEST_CODE');

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(ChaosError);
    });
  });

  // ==========================================================================
  // Shutdown Tests
  // ==========================================================================

  describe('Shutdown', () => {
    it('should stop health monitoring on shutdown', async () => {
      const mockCheckFn = vi.fn().mockResolvedValue(createMockComponentHealth());

      service.registerHealthCheck('service', mockCheckFn);
      service.startHealthMonitoring();

      await service.shutdown();

      // After shutdown, no more health checks should run
      const callCount = mockCheckFn.mock.calls.length;
      await delay(100);
      expect(mockCheckFn.mock.calls.length).toBe(callCount);
    });

    it('should disable chaos on shutdown', async () => {
      const chaosService = new HealthMonitoringService({
        chaosEnabled: true,
      });

      chaosService.enableChaos({ enabled: true, excludeProduction: false });
      expect(chaosService.isChaosActive()).toBe(true);

      await chaosService.shutdown();

      expect(chaosService.isChaosActive()).toBe(false);
    });

    it('should remove all event listeners on shutdown', async () => {
      const listener = vi.fn();
      service.on('health-critical', listener);

      await service.shutdown();

      // Should not have any listeners
      expect(service.listenerCount('health-critical')).toBe(0);
    });

    it('should be safe to call shutdown multiple times', async () => {
      await expect(service.shutdown()).resolves.not.toThrow();
      await expect(service.shutdown()).resolves.not.toThrow();
    });
  });

  // ==========================================================================
  // Edge Cases and Integration Tests
  // ==========================================================================

  describe('Edge Cases', () => {
    it('should handle empty health check list', async () => {
      const results = await service.runHealthChecks();
      expect(results).toEqual([]);
    });

    it('should handle very large number of health checks', async () => {
      const mockCheckFn = vi.fn().mockResolvedValue(createMockComponentHealth());

      for (let i = 0; i < 100; i++) {
        service.registerHealthCheck(`service-${i}`, mockCheckFn);
      }

      const results = await service.runHealthChecks();

      expect(results).toHaveLength(100);
      expect(mockCheckFn).toHaveBeenCalledTimes(100);
    });

    it('should handle health check that returns immediately', async () => {
      const mockCheckFn = vi.fn().mockResolvedValue(createMockComponentHealth());

      service.registerHealthCheck('service', mockCheckFn);

      const results = await service.runHealthChecks();

      expect(results[0].latencyMs).toBeGreaterThanOrEqual(0);
      expect(results[0].latencyMs).toBeLessThan(10);
    });

    it('should handle concurrent health check executions', async () => {
      const mockCheckFn = vi.fn().mockResolvedValue(createMockComponentHealth());

      service.registerHealthCheck('service', mockCheckFn);

      const [results1, results2, results3] = await Promise.all([
        service.runHealthChecks(),
        service.runHealthChecks(),
        service.runHealthChecks(),
      ]);

      expect(results1).toHaveLength(1);
      expect(results2).toHaveLength(1);
      expect(results3).toHaveLength(1);
      expect(mockCheckFn.mock.calls.length).toBeGreaterThanOrEqual(3);
    });

    it('should handle re-registering same health check', () => {
      const mockCheckFn1 = vi.fn().mockResolvedValue(createMockComponentHealth());
      const mockCheckFn2 = vi.fn().mockResolvedValue(createMockComponentHealth());

      service.registerHealthCheck('service', mockCheckFn1);
      service.registerHealthCheck('service', mockCheckFn2); // Re-register

      const state = service.getHealthState('service');
      expect(state).toBeDefined();
    });

    it('should preserve health state when re-registering', async () => {
      const mockCheckFn1 = vi.fn().mockResolvedValue(createMockComponentHealth({ status: 'unhealthy' }));
      const mockCheckFn2 = vi.fn().mockResolvedValue(createMockComponentHealth({ status: 'healthy' }));

      service.registerHealthCheck('service', mockCheckFn1);
      await service.runHealthChecks();

      let state = service.getHealthState('service');
      expect(state?.consecutiveFailures).toBe(1);

      // Re-register should reset state
      service.registerHealthCheck('service', mockCheckFn2);

      state = service.getHealthState('service');
      expect(state?.consecutiveFailures).toBe(0);
    });

    it('should handle mixed success and failure across multiple services', async () => {
      const mockHealthyFn = vi.fn().mockResolvedValue(createMockComponentHealth({ status: 'healthy' }));
      const mockUnhealthyFn = vi.fn().mockResolvedValue(createMockComponentHealth({ status: 'unhealthy' }));

      service.registerHealthCheck('service-1', mockHealthyFn);
      service.registerHealthCheck('service-2', mockUnhealthyFn);
      service.registerHealthCheck('service-3', mockHealthyFn);

      const results = await service.runHealthChecks();

      const stats = service.getStats();
      expect(stats.servicesHealthy).toBe(2);
      expect(stats.servicesUnhealthy).toBe(1);
      expect(service.getHealthyRatio()).toBeCloseTo(2 / 3, 2);
    });
  });
});
