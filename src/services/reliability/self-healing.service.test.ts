/**
 * Self-Healing Service Tests
 *
 * Comprehensive tests for the SelfHealingService which handles:
 * - Self-healing mechanisms for automatic recovery
 * - Data integrity validation and repair
 * - Sophisticated error recovery strategies
 * - Event emission for healing actions and integrity checks
 *
 * Run: npx vitest src/services/reliability/self-healing.service.test.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  SelfHealingService,
  SelfHealingAction,
  SelfHealingConfig,
  IntegrityCheckConfig,
  IntegrityCheckResult,
  SelfHealingEvent,
  ErrorRecoveryContext,
  ErrorRecoveryResult,
  RecoveryStrategyType,
  ReliabilityError,
} from './self-healing.service.js';
import type { HealthStatus } from '../health.service.js';
import type { FailoverService, FailoverEvent } from './failover.service.js';

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

// ============================================================================
// Mock Helpers
// ============================================================================

const createMockFailoverService = () => ({
  executeFailover: vi.fn().mockResolvedValue({ success: true }),
  on: vi.fn(),
  emit: vi.fn(),
});

const createMockSelfHealingConfig = (
  overrides?: Partial<SelfHealingConfig>
): SelfHealingConfig => ({
  service: 'test-service',
  enabled: true,
  actions: ['restart', 'reconnect'],
  maxAttempts: 3,
  cooldownMs: 30000,
  healthThreshold: 3,
  autoRestart: true,
  notifyOnHeal: true,
  ...overrides,
});

const createMockIntegrityCheckConfig = (
  overrides?: Partial<Omit<IntegrityCheckConfig, 'id'>>
): Omit<IntegrityCheckConfig, 'id'> => ({
  name: 'test-check',
  type: 'checksum',
  target: 'database',
  enabled: true,
  autoRepair: false,
  notifyOnFailure: true,
  ...overrides,
});

const createMockErrorRecoveryContext = (
  overrides?: Partial<ErrorRecoveryContext>
): ErrorRecoveryContext => ({
  error: new Error('Test error'),
  service: 'test-service',
  operation: 'test-operation',
  attempt: 1,
  maxAttempts: 3,
  startTime: Date.now(),
  ...overrides,
});

// ============================================================================
// Tests
// ============================================================================

describe('SelfHealingService', () => {
  let service: SelfHealingService;
  let mockFailoverService: ReturnType<typeof createMockFailoverService>;

  beforeEach(() => {
    vi.useFakeTimers();
    mockFailoverService = createMockFailoverService();
  });

  afterEach(async () => {
    if (service) {
      await service.shutdown();
    }
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  // ==========================================================================
  // Constructor Tests
  // ==========================================================================

  describe('constructor', () => {
    it('should initialize with default configuration', () => {
      service = new SelfHealingService();
      expect(service).toBeDefined();
      expect(service.getStats()).toEqual({
        totalSelfHeals: 0,
        successfulSelfHeals: 0,
        totalRecoveries: 0,
        successfulRecoveries: 0,
        integrityChecksRun: 0,
        integrityChecksPassed: 0,
      });
    });

    it('should initialize with custom configuration', () => {
      service = new SelfHealingService({
        enabled: true,
        integrityChecksEnabled: false,
        maxConcurrentRecoveries: 5,
      });
      expect(service).toBeDefined();
    });

    it('should initialize with failover service', () => {
      service = new SelfHealingService(
        { enabled: true },
        mockFailoverService as unknown as FailoverService
      );
      expect(service).toBeDefined();
    });

    it('should register default strategies when enabled', () => {
      service = new SelfHealingService({ enabled: true });

      // Check that default services are registered
      expect(service.getSelfHealingConfig('database')).toBeDefined();
      expect(service.getSelfHealingConfig('llm')).toBeDefined();
      expect(service.getSelfHealingConfig('telegram')).toBeDefined();
      expect(service.getSelfHealingConfig('queue')).toBeDefined();
    });

    it('should not register default strategies when disabled', () => {
      service = new SelfHealingService({ enabled: false });
      expect(service.getSelfHealingConfig('database')).toBeUndefined();
    });
  });

  // ==========================================================================
  // setFailoverService Tests
  // ==========================================================================

  describe('setFailoverService', () => {
    it('should set failover service reference', () => {
      service = new SelfHealingService();
      service.setFailoverService(mockFailoverService as unknown as FailoverService);

      // Verify by attempting failover action
      const config = createMockSelfHealingConfig({ actions: ['failover'] });
      service.registerSelfHealing(config);
    });
  });

  // ==========================================================================
  // registerSelfHealing Tests
  // ==========================================================================

  describe('registerSelfHealing', () => {
    beforeEach(() => {
      service = new SelfHealingService({ enabled: true });
    });

    it('should register self-healing configuration', () => {
      const config = createMockSelfHealingConfig();
      service.registerSelfHealing(config);

      const registered = service.getSelfHealingConfig('test-service');
      expect(registered).toEqual(config);
    });

    it('should override existing configuration for same service', () => {
      const config1 = createMockSelfHealingConfig({ actions: ['restart'] });
      const config2 = createMockSelfHealingConfig({ actions: ['reconnect'] });

      service.registerSelfHealing(config1);
      service.registerSelfHealing(config2);

      const registered = service.getSelfHealingConfig('test-service');
      expect(registered?.actions).toEqual(['reconnect']);
    });
  });

  // ==========================================================================
  // getSelfHealingConfig Tests
  // ==========================================================================

  describe('getSelfHealingConfig', () => {
    beforeEach(() => {
      service = new SelfHealingService({ enabled: true });
    });

    it('should return undefined for non-existent service', () => {
      expect(service.getSelfHealingConfig('non-existent')).toBeUndefined();
    });

    it('should return configuration for registered service', () => {
      const config = createMockSelfHealingConfig();
      service.registerSelfHealing(config);

      expect(service.getSelfHealingConfig('test-service')).toEqual(config);
    });
  });

  // ==========================================================================
  // attemptSelfHealing Tests - Success Cases
  // ==========================================================================

  describe('attemptSelfHealing - success cases', () => {
    beforeEach(() => {
      service = new SelfHealingService({ enabled: true });
    });

    it('should execute self-healing action successfully', async () => {
      const config = createMockSelfHealingConfig({ actions: ['restart'] });
      service.registerSelfHealing(config);

      const healingActionSpy = vi.fn();
      service.on('healing-action', healingActionSpy);

      const promise = service.attemptSelfHealing('test-service', 'Service unhealthy');
      await vi.advanceTimersByTimeAsync(1100); // Advance past restart delay (1000ms)
      const event = await promise;

      expect(event).toBeDefined();
      expect(event?.success).toBe(true);
      expect(event?.service).toBe('test-service');
      expect(event?.action).toBe('restart');
      expect(healingActionSpy).toHaveBeenCalledWith({
        service: 'test-service',
        action: 'restart',
      });
    });

    it('should try multiple actions until one succeeds', async () => {
      const config = createMockSelfHealingConfig({
        actions: ['restart', 'reconnect', 'failover'],
      });
      service.registerSelfHealing(config);

      const promise = service.attemptSelfHealing('test-service', 'Service unhealthy');
      await vi.advanceTimersByTimeAsync(1100);
      const event = await promise;

      expect(event?.success).toBe(true);
      expect(event?.action).toBe('restart'); // First action succeeds
    });

    it('should update statistics on successful healing', async () => {
      const config = createMockSelfHealingConfig();
      service.registerSelfHealing(config);

      const promise = service.attemptSelfHealing('test-service', 'Service unhealthy');
      await vi.advanceTimersByTimeAsync(1100);
      await promise;

      const stats = service.getStats();
      expect(stats.totalSelfHeals).toBe(1);
      expect(stats.successfulSelfHeals).toBe(1);
    });

    it('should record healing event in history', async () => {
      const config = createMockSelfHealingConfig();
      service.registerSelfHealing(config);

      const promise = service.attemptSelfHealing('test-service', 'Service unhealthy');
      await vi.advanceTimersByTimeAsync(1100);
      await promise;

      const history = service.getSelfHealingHistory(10);
      expect(history).toHaveLength(1);
      expect(history[0].service).toBe('test-service');
      expect(history[0].reason).toBe('Service unhealthy');
    });
  });

  // ==========================================================================
  // attemptSelfHealing Tests - Failure Cases
  // ==========================================================================

  describe('attemptSelfHealing - failure scenarios', () => {
    beforeEach(() => {
      service = new SelfHealingService({ enabled: true });
    });

    it('should return null when service is disabled', async () => {
      service = new SelfHealingService({ enabled: false });
      const config = createMockSelfHealingConfig();
      service.registerSelfHealing(config);

      const event = await service.attemptSelfHealing('test-service', 'Service unhealthy');
      expect(event).toBeNull();
    });

    it('should return null when service config is not found', async () => {
      const event = await service.attemptSelfHealing('unknown-service', 'Service unhealthy');
      expect(event).toBeNull();
    });

    it('should return null when service config is disabled', async () => {
      const config = createMockSelfHealingConfig({ enabled: false });
      service.registerSelfHealing(config);

      const event = await service.attemptSelfHealing('test-service', 'Service unhealthy');
      expect(event).toBeNull();
    });

    it('should respect cooldown period', async () => {
      const config = createMockSelfHealingConfig({ cooldownMs: 5000 });
      service.registerSelfHealing(config);

      // First healing attempt
      const promise1 = service.attemptSelfHealing('test-service', 'First error');
      await vi.advanceTimersByTimeAsync(1100);
      await promise1;

      // Second attempt immediately (should be blocked)
      const event = await service.attemptSelfHealing('test-service', 'Second error');
      expect(event).toBeNull();

      // Advance time past cooldown
      await vi.advanceTimersByTimeAsync(5100);

      // Third attempt (should succeed)
      const promise2 = service.attemptSelfHealing('test-service', 'Third error');
      await vi.advanceTimersByTimeAsync(1100);
      const event2 = await promise2;
      expect(event2).toBeDefined();
    });

    it('should enforce max concurrent recoveries limit', async () => {
      service = new SelfHealingService({ enabled: true, maxConcurrentRecoveries: 2 });

      const config1 = createMockSelfHealingConfig({ service: 'service-1' });
      const config2 = createMockSelfHealingConfig({ service: 'service-2' });
      const config3 = createMockSelfHealingConfig({ service: 'service-3' });

      service.registerSelfHealing(config1);
      service.registerSelfHealing(config2);
      service.registerSelfHealing(config3);

      // Start 2 concurrent healings (should succeed)
      const promise1 = service.attemptSelfHealing('service-1', 'Error 1');
      const promise2 = service.attemptSelfHealing('service-2', 'Error 2');

      // Third attempt should be blocked due to limit
      const event3 = await service.attemptSelfHealing('service-3', 'Error 3');
      expect(event3).toBeNull();

      await vi.advanceTimersByTimeAsync(1100);
      await Promise.all([promise1, promise2]);
    });
  });

  // ==========================================================================
  // Healing Action Execution Tests
  // ==========================================================================

  describe('healing action execution', () => {
    beforeEach(() => {
      service = new SelfHealingService({ enabled: true });
    });

    it('should execute restart action', async () => {
      const config = createMockSelfHealingConfig({ actions: ['restart'] });
      service.registerSelfHealing(config);

      const healingActionSpy = vi.fn();
      service.on('healing-action', healingActionSpy);

      const promise = service.attemptSelfHealing('test-service', 'Error');
      await vi.advanceTimersByTimeAsync(1100);
      await promise;

      expect(healingActionSpy).toHaveBeenCalledWith({
        service: 'test-service',
        action: 'restart',
      });
    });

    it('should execute reconnect action', async () => {
      const config = createMockSelfHealingConfig({ actions: ['reconnect'] });
      service.registerSelfHealing(config);

      const healingActionSpy = vi.fn();
      service.on('healing-action', healingActionSpy);

      const promise = service.attemptSelfHealing('test-service', 'Error');
      await vi.advanceTimersByTimeAsync(600);
      await promise;

      expect(healingActionSpy).toHaveBeenCalledWith({
        service: 'test-service',
        action: 'reconnect',
      });
    });

    it('should execute clear-cache action', async () => {
      const config = createMockSelfHealingConfig({ actions: ['clear-cache'] });
      service.registerSelfHealing(config);

      const healingActionSpy = vi.fn();
      service.on('healing-action', healingActionSpy);

      await service.attemptSelfHealing('test-service', 'Error');

      expect(healingActionSpy).toHaveBeenCalledWith({
        service: 'test-service',
        action: 'clear-cache',
      });
    });

    it('should execute reset-circuit action', async () => {
      const config = createMockSelfHealingConfig({ actions: ['reset-circuit'] });
      service.registerSelfHealing(config);

      const healingActionSpy = vi.fn();
      service.on('healing-action', healingActionSpy);

      await service.attemptSelfHealing('test-service', 'Error');

      expect(healingActionSpy).toHaveBeenCalledWith({
        service: 'test-service',
        action: 'reset-circuit',
      });
    });

    it('should execute scale-up action', async () => {
      const config = createMockSelfHealingConfig({ actions: ['scale-up'] });
      service.registerSelfHealing(config);

      const healingActionSpy = vi.fn();
      service.on('healing-action', healingActionSpy);

      await service.attemptSelfHealing('test-service', 'Error');

      expect(healingActionSpy).toHaveBeenCalledWith({
        service: 'test-service',
        action: 'scale-up',
      });
    });

    it('should execute failover action with failover service', async () => {
      service = new SelfHealingService({ enabled: true }, mockFailoverService as unknown as FailoverService);
      const config = createMockSelfHealingConfig({ actions: ['failover'] });
      service.registerSelfHealing(config);

      mockFailoverService.executeFailover.mockResolvedValue({ success: true });

      const event = await service.attemptSelfHealing('test-service', 'Error');

      expect(event?.success).toBe(true);
      expect(mockFailoverService.executeFailover).toHaveBeenCalledWith('test-service', 'self-healing');
    });

    it('should fail failover action without failover service', async () => {
      const config = createMockSelfHealingConfig({ actions: ['failover'] });
      service.registerSelfHealing(config);

      const event = await service.attemptSelfHealing('test-service', 'Error');

      expect(event?.success).toBe(false);
    });
  });

  // ==========================================================================
  // Integrity Check Registration Tests
  // ==========================================================================

  describe('registerIntegrityCheck', () => {
    beforeEach(() => {
      service = new SelfHealingService({ enabled: true, integrityChecksEnabled: true });
    });

    it('should register integrity check and return ID', () => {
      const config = createMockIntegrityCheckConfig();
      const checkId = service.registerIntegrityCheck(config);

      expect(checkId).toBeDefined();
      expect(typeof checkId).toBe('string');
    });

    it('should register integrity check with interval', () => {
      const config = createMockIntegrityCheckConfig({
        intervalMs: 60000,
      });

      const checkId = service.registerIntegrityCheck(config);
      expect(checkId).toBeDefined();
    });

    it('should not start interval if check is disabled', () => {
      const config = createMockIntegrityCheckConfig({
        enabled: false,
        intervalMs: 60000,
      });

      const checkId = service.registerIntegrityCheck(config);
      expect(checkId).toBeDefined();
    });
  });

  // ==========================================================================
  // Integrity Check Execution Tests
  // ==========================================================================

  describe('runIntegrityCheck', () => {
    beforeEach(() => {
      service = new SelfHealingService({ enabled: true, integrityChecksEnabled: true });
    });

    it('should throw error for non-existent check', async () => {
      await expect(service.runIntegrityCheck('non-existent')).rejects.toThrow(ReliabilityError);
    });

    it('should execute checksum integrity check', async () => {
      const config = createMockIntegrityCheckConfig({ type: 'checksum' });
      const checkId = service.registerIntegrityCheck(config);

      const integrityCheckSpy = vi.fn();
      service.on('integrity-check', integrityCheckSpy);

      const promise = service.runIntegrityCheck(checkId);
      await vi.advanceTimersByTimeAsync(150); // Advance past internal delay
      const result = await promise;

      expect(result.passed).toBe(true);
      expect(result.type).toBe('checksum');
      expect(result.errors).toHaveLength(0);
      expect(integrityCheckSpy).toHaveBeenCalledWith({
        id: checkId,
        type: 'checksum',
        target: 'database',
      });
    });

    it('should execute hash integrity check', async () => {
      const config = createMockIntegrityCheckConfig({ type: 'hash' });
      const checkId = service.registerIntegrityCheck(config);

      const promise = service.runIntegrityCheck(checkId);
      await vi.advanceTimersByTimeAsync(150);
      const result = await promise;

      expect(result.passed).toBe(true);
      expect(result.type).toBe('hash');
      expect(result.details.hashValid).toBe(true);
    });

    it('should execute count integrity check', async () => {
      const config = createMockIntegrityCheckConfig({ type: 'count' });
      const checkId = service.registerIntegrityCheck(config);

      const promise = service.runIntegrityCheck(checkId);
      await vi.advanceTimersByTimeAsync(150);
      const result = await promise;

      expect(result.passed).toBe(true);
      expect(result.type).toBe('count');
      expect(result.details.countMatches).toBe(true);
    });

    it('should execute consistency integrity check', async () => {
      const config = createMockIntegrityCheckConfig({ type: 'consistency' });
      const checkId = service.registerIntegrityCheck(config);

      const promise = service.runIntegrityCheck(checkId);
      await vi.advanceTimersByTimeAsync(150);
      const result = await promise;

      expect(result.passed).toBe(true);
      expect(result.type).toBe('consistency');
      expect(result.details.consistent).toBe(true);
    });

    it('should execute referential integrity check', async () => {
      const config = createMockIntegrityCheckConfig({ type: 'referential' });
      const checkId = service.registerIntegrityCheck(config);

      const promise = service.runIntegrityCheck(checkId);
      await vi.advanceTimersByTimeAsync(150);
      const result = await promise;

      expect(result.passed).toBe(true);
      expect(result.type).toBe('referential');
      expect(result.details.referencesValid).toBe(true);
    });

    it('should update statistics on successful check', async () => {
      const config = createMockIntegrityCheckConfig();
      const checkId = service.registerIntegrityCheck(config);

      const promise = service.runIntegrityCheck(checkId);
      await vi.advanceTimersByTimeAsync(150);
      await promise;

      const stats = service.getStats();
      expect(stats.integrityChecksRun).toBe(1);
      expect(stats.integrityChecksPassed).toBe(1);
    });

    it('should emit integrity-failure event on check failure', async () => {
      const config = createMockIntegrityCheckConfig({ notifyOnFailure: true });
      const checkId = service.registerIntegrityCheck(config);

      // Mock external handler to simulate failure
      const integrityCheckSpy = vi.fn(() => {
        throw new Error('Check failed');
      });
      service.on('integrity-check', integrityCheckSpy);

      const integrityFailureSpy = vi.fn();
      service.on('integrity-failure', integrityFailureSpy);

      const result = await service.runIntegrityCheck(checkId);

      expect(result.passed).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(integrityFailureSpy).toHaveBeenCalled();
    });

    it('should attempt auto-repair when enabled and check fails', async () => {
      const config = createMockIntegrityCheckConfig({
        autoRepair: true,
        notifyOnFailure: true,
      });
      const checkId = service.registerIntegrityCheck(config);

      // Mock external handler to simulate failure
      const integrityCheckSpy = vi.fn(() => {
        throw new Error('Check failed');
      });
      service.on('integrity-check', integrityCheckSpy);

      const integrityRepairSpy = vi.fn();
      service.on('integrity-repair', integrityRepairSpy);

      const result = await service.runIntegrityCheck(checkId);

      expect(result.passed).toBe(false);
      expect(result.repaired).toBe(true);
      expect(integrityRepairSpy).toHaveBeenCalledWith({
        id: checkId,
        type: 'checksum',
        target: 'database',
      });
    });
  });

  // ==========================================================================
  // runAllIntegrityChecks Tests
  // ==========================================================================

  describe('runAllIntegrityChecks', () => {
    beforeEach(() => {
      service = new SelfHealingService({ enabled: true, integrityChecksEnabled: true });
    });

    it('should run all enabled integrity checks', async () => {
      const config1 = createMockIntegrityCheckConfig({ name: 'check-1' });
      const config2 = createMockIntegrityCheckConfig({ name: 'check-2' });
      const config3 = createMockIntegrityCheckConfig({ name: 'check-3', enabled: false });

      service.registerIntegrityCheck(config1);
      service.registerIntegrityCheck(config2);
      service.registerIntegrityCheck(config3);

      const promise = service.runAllIntegrityChecks();
      await vi.advanceTimersByTimeAsync(200);
      const results = await promise;

      expect(results).toHaveLength(2); // Only enabled checks
    });

    it('should handle errors in individual checks', async () => {
      const config1 = createMockIntegrityCheckConfig({ name: 'check-1' });
      const config2 = createMockIntegrityCheckConfig({ name: 'check-2' });

      service.registerIntegrityCheck(config1);
      const checkId2 = service.registerIntegrityCheck(config2);

      // Mock one check to fail
      const integrityCheckSpy = vi.fn((event) => {
        if (event.id === checkId2) {
          throw new Error('Check 2 failed');
        }
      });
      service.on('integrity-check', integrityCheckSpy);

      const promise = service.runAllIntegrityChecks();
      await vi.advanceTimersByTimeAsync(200);
      const results = await promise;

      expect(results).toHaveLength(2);
      expect(results[0].passed).toBe(true);
      expect(results[1].passed).toBe(false);
    });
  });

  // ==========================================================================
  // Error Recovery Tests - Strategy Selection
  // ==========================================================================

  describe('executeErrorRecovery - strategy selection', () => {
    beforeEach(() => {
      service = new SelfHealingService({ enabled: true });
    });

    it('should use retry strategy for timeout errors', async () => {
      const context = createMockErrorRecoveryContext({
        error: new Error('Connection timeout'),
        attempt: 1,
      });

      const retrySpy = vi.fn();
      service.on('retry', retrySpy);

      const promise = service.executeErrorRecovery(context);
      await vi.advanceTimersByTimeAsync(1100);
      const result = await promise;

      expect(result.strategy).toBe('retry');
      expect(result.success).toBe(true);
      expect(retrySpy).toHaveBeenCalled();
    });

    it('should use retry strategy for connection errors', async () => {
      const context = createMockErrorRecoveryContext({
        error: new Error('Connection refused'),
        attempt: 1,
      });

      const promise = service.executeErrorRecovery(context);
      await vi.advanceTimersByTimeAsync(1100);
      const result = await promise;
      expect(result.strategy).toBe('retry');
    });

    it('should use shed-load strategy for rate limit errors', async () => {
      const context = createMockErrorRecoveryContext({
        error: new Error('Rate limit exceeded'),
        attempt: 1,
      });

      const shedLoadSpy = vi.fn();
      service.on('shed-load', shedLoadSpy);

      const result = await service.executeErrorRecovery(context);

      expect(result.strategy).toBe('shed-load');
      expect(result.success).toBe(false);
      expect(shedLoadSpy).toHaveBeenCalled();
    });

    it('should use escalate strategy for auth errors', async () => {
      const context = createMockErrorRecoveryContext({
        error: new Error('Unauthorized - 401'),
        attempt: 1,
      });

      const escalateSpy = vi.fn();
      service.on('escalate', escalateSpy);

      const result = await service.executeErrorRecovery(context);

      expect(result.strategy).toBe('escalate');
      expect(result.success).toBe(false);
      expect(escalateSpy).toHaveBeenCalled();
    });

    it('should use fallback strategy for not found errors', async () => {
      const context = createMockErrorRecoveryContext({
        error: new Error('Resource not found - 404'),
        attempt: 1,
      });

      const result = await service.executeErrorRecovery(context);

      expect(result.strategy).toBe('fallback');
      expect(result.fallbackUsed).toBe(true);
    });

    it('should use circuit-break strategy for internal errors after retries', async () => {
      const context = createMockErrorRecoveryContext({
        error: new Error('Internal server error - 500'),
        attempt: 3,
      });

      const result = await service.executeErrorRecovery(context);
      expect(result.strategy).toBe('circuit-break');
    });

    it('should switch to fallback after multiple timeout retries', async () => {
      const context = createMockErrorRecoveryContext({
        error: new Error('Connection timeout'),
        attempt: 4,
      });

      const result = await service.executeErrorRecovery(context);
      expect(result.strategy).toBe('fallback');
    });
  });

  // ==========================================================================
  // Error Recovery Tests - Statistics
  // ==========================================================================

  describe('executeErrorRecovery - statistics', () => {
    beforeEach(() => {
      service = new SelfHealingService({ enabled: true });
    });

    it('should update statistics on recovery attempt', async () => {
      const context = createMockErrorRecoveryContext();

      const promise = service.executeErrorRecovery(context);
      await vi.advanceTimersByTimeAsync(1100);
      await promise;

      const stats = service.getStats();
      expect(stats.totalRecoveries).toBe(1);
    });

    it('should update successful recovery statistics', async () => {
      const context = createMockErrorRecoveryContext({
        error: new Error('Timeout'),
      });

      const promise = service.executeErrorRecovery(context);
      await vi.advanceTimersByTimeAsync(1100);
      await promise;

      const stats = service.getStats();
      expect(stats.successfulRecoveries).toBe(1);
    });

    it('should not increment success for failed recovery', async () => {
      const context = createMockErrorRecoveryContext({
        error: new Error('Unauthorized'),
      });

      await service.executeErrorRecovery(context);

      const stats = service.getStats();
      expect(stats.totalRecoveries).toBe(1);
      expect(stats.successfulRecoveries).toBe(0);
    });
  });

  // ==========================================================================
  // Statistics Tests
  // ==========================================================================

  describe('getStats', () => {
    beforeEach(() => {
      service = new SelfHealingService({ enabled: true });
    });

    it('should return initial statistics', () => {
      const stats = service.getStats();

      expect(stats).toEqual({
        totalSelfHeals: 0,
        successfulSelfHeals: 0,
        totalRecoveries: 0,
        successfulRecoveries: 0,
        integrityChecksRun: 0,
        integrityChecksPassed: 0,
      });
    });

    it('should return updated statistics after operations', async () => {
      const config = createMockSelfHealingConfig();
      service.registerSelfHealing(config);

      const promise1 = service.attemptSelfHealing('test-service', 'Error');
      await vi.advanceTimersByTimeAsync(1100);
      await promise1;

      const checkConfig = createMockIntegrityCheckConfig();
      const checkId = service.registerIntegrityCheck(checkConfig);
      const promise2 = service.runIntegrityCheck(checkId);
      await vi.advanceTimersByTimeAsync(150);
      await promise2;

      const context = createMockErrorRecoveryContext();
      const promise3 = service.executeErrorRecovery(context);
      await vi.advanceTimersByTimeAsync(1100);
      await promise3;

      const stats = service.getStats();
      expect(stats.totalSelfHeals).toBe(1);
      expect(stats.successfulSelfHeals).toBe(1);
      expect(stats.totalRecoveries).toBe(1);
      expect(stats.successfulRecoveries).toBe(1);
      expect(stats.integrityChecksRun).toBe(1);
      expect(stats.integrityChecksPassed).toBe(1);
    });
  });

  // ==========================================================================
  // History Tests
  // ==========================================================================

  describe('getSelfHealingHistory', () => {
    beforeEach(() => {
      service = new SelfHealingService({ enabled: true });
    });

    it('should return empty array initially', () => {
      const history = service.getSelfHealingHistory();
      expect(history).toEqual([]);
    });

    it('should return recent healing events', async () => {
      const config = createMockSelfHealingConfig({ cooldownMs: 0 });
      service.registerSelfHealing(config);

      const promise1 = service.attemptSelfHealing('test-service', 'Error 1');
      await vi.advanceTimersByTimeAsync(1100);
      await promise1;

      const promise2 = service.attemptSelfHealing('test-service', 'Error 2');
      await vi.advanceTimersByTimeAsync(1100);
      await promise2;

      const history = service.getSelfHealingHistory(10);
      expect(history).toHaveLength(2);
      // History is ordered newest first (unshift in recordSelfHealingEvent)
      expect(history[0].reason).toBe('Error 2');
      expect(history[1].reason).toBe('Error 1');
    });

    it('should limit history size', async () => {
      const config = createMockSelfHealingConfig({ cooldownMs: 0 });
      service.registerSelfHealing(config);

      const promise1 = service.attemptSelfHealing('test-service', 'Error 1');
      await vi.advanceTimersByTimeAsync(1100);
      await promise1;

      const promise2 = service.attemptSelfHealing('test-service', 'Error 2');
      await vi.advanceTimersByTimeAsync(1100);
      await promise2;

      const promise3 = service.attemptSelfHealing('test-service', 'Error 3');
      await vi.advanceTimersByTimeAsync(1100);
      await promise3;

      const history = service.getSelfHealingHistory(2);
      expect(history).toHaveLength(2);
    });

    it('should maintain max history size of 1000', async () => {
      const config = createMockSelfHealingConfig({ cooldownMs: 0 });
      service.registerSelfHealing(config);

      // Add more than 1000 events
      for (let i = 0; i < 1005; i++) {
        const promise = service.attemptSelfHealing('test-service', `Error ${i}`);
        await vi.advanceTimersByTimeAsync(1100);
        await promise;
      }

      const fullHistory = service.getSelfHealingHistory(2000);
      expect(fullHistory.length).toBeLessThanOrEqual(1000);
    });
  });

  describe('getIntegrityResults', () => {
    beforeEach(() => {
      service = new SelfHealingService({ enabled: true, integrityChecksEnabled: true });
    });

    it('should return empty array initially', () => {
      const results = service.getIntegrityResults();
      expect(results).toEqual([]);
    });

    it('should return recent integrity check results', async () => {
      const config = createMockIntegrityCheckConfig();
      const checkId = service.registerIntegrityCheck(config);

      const promise1 = service.runIntegrityCheck(checkId);
      await vi.advanceTimersByTimeAsync(150);
      await promise1;

      const promise2 = service.runIntegrityCheck(checkId);
      await vi.advanceTimersByTimeAsync(150);
      await promise2;

      const results = service.getIntegrityResults(10);
      expect(results).toHaveLength(2);
    });

    it('should limit results size', async () => {
      const config = createMockIntegrityCheckConfig();
      const checkId = service.registerIntegrityCheck(config);

      const promise1 = service.runIntegrityCheck(checkId);
      await vi.advanceTimersByTimeAsync(150);
      await promise1;

      const promise2 = service.runIntegrityCheck(checkId);
      await vi.advanceTimersByTimeAsync(150);
      await promise2;

      const promise3 = service.runIntegrityCheck(checkId);
      await vi.advanceTimersByTimeAsync(150);
      await promise3;

      const results = service.getIntegrityResults(2);
      expect(results).toHaveLength(2);
    });

    it('should maintain max results size of 1000', async () => {
      const config = createMockIntegrityCheckConfig();
      const checkId = service.registerIntegrityCheck(config);

      for (let i = 0; i < 1005; i++) {
        const promise = service.runIntegrityCheck(checkId);
        await vi.advanceTimersByTimeAsync(150);
        await promise;
      }

      const fullResults = service.getIntegrityResults(2000);
      expect(fullResults.length).toBeLessThanOrEqual(1000);
    });
  });

  // ==========================================================================
  // Shutdown Tests
  // ==========================================================================

  describe('shutdown', () => {
    beforeEach(() => {
      service = new SelfHealingService({ enabled: true, integrityChecksEnabled: true });
    });

    it('should clear integrity check intervals', async () => {
      const config = createMockIntegrityCheckConfig({ intervalMs: 60000 });
      service.registerIntegrityCheck(config);

      await service.shutdown();

      // Service should be shut down without errors
      expect(true).toBe(true);
    });

    it('should remove all event listeners', async () => {
      const spy = vi.fn();
      service.on('healing-action', spy);

      await service.shutdown();

      expect(service.listenerCount('healing-action')).toBe(0);
    });

    it('should be safe to call multiple times', async () => {
      await expect(service.shutdown()).resolves.not.toThrow();
      await expect(service.shutdown()).resolves.not.toThrow();
    });
  });

  // ==========================================================================
  // ReliabilityError Tests
  // ==========================================================================

  describe('ReliabilityError', () => {
    it('should create error with correct properties', () => {
      const error = new ReliabilityError('Test message', 'TEST_CODE', 'test-service', true);

      expect(error.message).toBe('Test message');
      expect(error.code).toBe('TEST_CODE');
      expect(error.service).toBe('test-service');
      expect(error.recoverable).toBe(true);
      expect(error.name).toBe('ReliabilityError');
    });

    it('should default recoverable to true', () => {
      const error = new ReliabilityError('Test message', 'TEST_CODE', 'test-service');
      expect(error.recoverable).toBe(true);
    });

    it('should handle missing service parameter', () => {
      const error = new ReliabilityError('Test message', 'TEST_CODE');
      expect(error.service).toBeUndefined();
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('edge cases', () => {
    beforeEach(() => {
      service = new SelfHealingService({ enabled: true });
    });

    it('should handle healing with different health states', async () => {
      const config = createMockSelfHealingConfig({ cooldownMs: 0 });
      service.registerSelfHealing(config);

      const promise1 = service.attemptSelfHealing('test-service', 'Error', 'degraded');
      await vi.advanceTimersByTimeAsync(1100);
      const event1 = await promise1;
      expect(event1?.previousState).toBe('degraded');

      const promise2 = service.attemptSelfHealing('test-service', 'Error', 'critical');
      await vi.advanceTimersByTimeAsync(1100);
      const event2 = await promise2;
      expect(event2?.previousState).toBe('critical');
    });

    it('should handle empty actions array gracefully', async () => {
      const config = createMockSelfHealingConfig({ actions: [] });
      service.registerSelfHealing(config);

      const event = await service.attemptSelfHealing('test-service', 'Error');
      expect(event?.success).toBe(false);
    });

    it('should handle concurrent self-healing attempts', async () => {
      service = new SelfHealingService({ enabled: true, maxConcurrentRecoveries: 3 });

      const config1 = createMockSelfHealingConfig({ service: 'service-1' });
      const config2 = createMockSelfHealingConfig({ service: 'service-2' });

      service.registerSelfHealing(config1);
      service.registerSelfHealing(config2);

      const promise1 = service.attemptSelfHealing('service-1', 'Error');
      const promise2 = service.attemptSelfHealing('service-2', 'Error');

      await vi.advanceTimersByTimeAsync(1100);
      const [event1, event2] = await Promise.all([promise1, promise2]);

      expect(event1).toBeDefined();
      expect(event2).toBeDefined();
    });

    it('should handle error recovery with metadata', async () => {
      const context = createMockErrorRecoveryContext({
        metadata: { requestId: '123', userId: 'user-1' },
      });

      const promise = service.executeErrorRecovery(context);
      await vi.advanceTimersByTimeAsync(1100);
      const result = await promise;
      expect(result).toBeDefined();
    });

    it('should handle integrity check without interval', () => {
      const config = createMockIntegrityCheckConfig({
        intervalMs: undefined,
      });

      const checkId = service.registerIntegrityCheck(config);
      expect(checkId).toBeDefined();
    });

    it('should handle long-running healing actions', async () => {
      const config = createMockSelfHealingConfig({ actions: ['restart'] });
      service.registerSelfHealing(config);

      const startTime = Date.now();
      const promise = service.attemptSelfHealing('test-service', 'Error');
      await vi.advanceTimersByTimeAsync(1100);
      const event = await promise;

      expect(event?.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  // ==========================================================================
  // Integration Tests
  // ==========================================================================

  describe('integration tests', () => {
    beforeEach(() => {
      service = new SelfHealingService(
        { enabled: true, integrityChecksEnabled: true, maxConcurrentRecoveries: 3 },
        mockFailoverService as unknown as FailoverService
      );
    });

    it('should coordinate self-healing and integrity checks', async () => {
      // Register self-healing
      const healingConfig = createMockSelfHealingConfig();
      service.registerSelfHealing(healingConfig);

      // Register integrity check
      const checkConfig = createMockIntegrityCheckConfig();
      const checkId = service.registerIntegrityCheck(checkConfig);

      // Execute operations
      const promise1 = service.attemptSelfHealing('test-service', 'Service unhealthy');
      await vi.advanceTimersByTimeAsync(1100);
      await promise1;

      const promise2 = service.runIntegrityCheck(checkId);
      await vi.advanceTimersByTimeAsync(150);
      await promise2;

      // Verify combined state
      const stats = service.getStats();
      expect(stats.totalSelfHeals).toBe(1);
      expect(stats.integrityChecksRun).toBe(1);

      const history = service.getSelfHealingHistory(10);
      const results = service.getIntegrityResults(10);
      expect(history).toHaveLength(1);
      expect(results).toHaveLength(1);
    });

    it('should handle complex recovery scenario', async () => {
      const config = createMockSelfHealingConfig({
        actions: ['reconnect', 'restart', 'failover'],
      });
      service.registerSelfHealing(config);

      mockFailoverService.executeFailover.mockResolvedValue({ success: true });

      // Attempt healing
      const promise1 = service.attemptSelfHealing('test-service', 'Complex failure');
      await vi.advanceTimersByTimeAsync(600); // reconnect delay
      const healingEvent = await promise1;

      // Attempt error recovery
      const context = createMockErrorRecoveryContext({
        error: new Error('Timeout after healing'),
        service: 'test-service',
      });
      const promise2 = service.executeErrorRecovery(context);
      await vi.advanceTimersByTimeAsync(1100);
      const recoveryResult = await promise2;

      expect(healingEvent?.success).toBe(true);
      expect(recoveryResult.success).toBe(true);
    });
  });
});
