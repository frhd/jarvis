/**
 * CircuitBreakerService Tests
 *
 * Run: npm test src/services/circuitBreaker.service.test.ts
 * or: npx vitest src/services/circuitBreaker.service.test.ts
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { CircuitBreakerService, CircuitOpenError, CircuitBreakerConfig } from './circuitBreaker.service';
import { CircuitBreakerRepository } from '../repositories/circuitBreaker.repository';
import { CircuitState, CircuitBreakerStateRecord } from '../types';

// Mock the repository
vi.mock('../repositories/circuitBreaker.repository');

// Mock logger to avoid noise in test output
vi.mock('../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

describe('CircuitBreakerService', () => {
  let mockRepository: CircuitBreakerRepository;
  let service: CircuitBreakerService;
  const serviceName = 'test-service';

  beforeEach(() => {
    // Reset all mocks before each test
    vi.clearAllMocks();

    // Create mock repository with default implementations
    mockRepository = {
      findByServiceName: vi.fn(),
      upsert: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      reset: vi.fn(),
      deleteByServiceName: vi.fn(),
      findAll: vi.fn(),
    } as unknown as CircuitBreakerRepository;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Initialization', () => {
    it('should start in CLOSED state', async () => {
      vi.mocked(mockRepository.findByServiceName).mockResolvedValue(null);
      vi.mocked(mockRepository.upsert).mockResolvedValue({
        id: '1',
        serviceName,
        state: 'CLOSED',
        failureCount: 0,
        successCount: 0,
        lastFailureAt: null,
        lastSuccessAt: null,
        lastStateChangeAt: new Date(),
        nextAttemptAt: null,
        halfOpenAttempts: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as CircuitBreakerStateRecord);

      service = new CircuitBreakerService(serviceName, {}, mockRepository);
      await service.initialize();

      expect(service.getState()).toBe('CLOSED');
      expect(mockRepository.findByServiceName).toHaveBeenCalledWith(serviceName);
    });

    it('should load existing state from database', async () => {
      const existingState: CircuitBreakerStateRecord = {
        id: '1',
        serviceName,
        state: 'OPEN',
        failureCount: 5,
        successCount: 10,
        lastFailureAt: new Date(),
        lastSuccessAt: new Date(),
        lastStateChangeAt: new Date(),
        nextAttemptAt: new Date(Date.now() + 30000),
        halfOpenAttempts: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(mockRepository.findByServiceName).mockResolvedValue(existingState);

      service = new CircuitBreakerService(serviceName, {}, mockRepository);
      await service.initialize();

      expect(service.getState()).toBe('OPEN');
      expect(mockRepository.findByServiceName).toHaveBeenCalledWith(serviceName);
    });

    it('should use default config when no config provided', async () => {
      vi.mocked(mockRepository.findByServiceName).mockResolvedValue(null);
      vi.mocked(mockRepository.upsert).mockResolvedValue({
        id: '1',
        serviceName,
        state: 'CLOSED',
        failureCount: 0,
        successCount: 0,
        lastFailureAt: null,
        lastSuccessAt: null,
        lastStateChangeAt: new Date(),
        nextAttemptAt: null,
        halfOpenAttempts: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as CircuitBreakerStateRecord);

      service = new CircuitBreakerService(serviceName, {}, mockRepository);
      await service.initialize();

      const stats = service.getStats();
      expect(stats.config.failureThreshold).toBe(5);
      expect(stats.config.resetTimeoutMs).toBe(30000);
      expect(stats.config.halfOpenRequests).toBe(3);
    });

    it('should merge custom config with defaults', async () => {
      vi.mocked(mockRepository.findByServiceName).mockResolvedValue(null);
      vi.mocked(mockRepository.upsert).mockResolvedValue({
        id: '1',
        serviceName,
        state: 'CLOSED',
        failureCount: 0,
        successCount: 0,
        lastFailureAt: null,
        lastSuccessAt: null,
        lastStateChangeAt: new Date(),
        nextAttemptAt: null,
        halfOpenAttempts: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as CircuitBreakerStateRecord);

      const customConfig: Partial<CircuitBreakerConfig> = {
        failureThreshold: 3,
        resetTimeoutMs: 60000,
      };

      service = new CircuitBreakerService(serviceName, customConfig, mockRepository);
      await service.initialize();

      const stats = service.getStats();
      expect(stats.config.failureThreshold).toBe(3);
      expect(stats.config.resetTimeoutMs).toBe(60000);
      expect(stats.config.halfOpenRequests).toBe(3); // Default value
    });
  });

  describe('State Transitions: CLOSED -> OPEN', () => {
    beforeEach(async () => {
      vi.mocked(mockRepository.findByServiceName).mockResolvedValue(null);
      vi.mocked(mockRepository.upsert).mockResolvedValue({
        id: '1',
        serviceName,
        state: 'CLOSED',
        failureCount: 0,
        successCount: 0,
        lastFailureAt: null,
        lastSuccessAt: null,
        lastStateChangeAt: new Date(),
        nextAttemptAt: null,
        halfOpenAttempts: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as CircuitBreakerStateRecord);

      service = new CircuitBreakerService(
        serviceName,
        { failureThreshold: 3, resetTimeoutMs: 30000, halfOpenRequests: 2 },
        mockRepository
      );
      await service.initialize();
    });

    it('should transition to OPEN after reaching failure threshold', async () => {
      const failingFn = vi.fn().mockRejectedValue(new Error('Service error'));

      // First 2 failures should keep circuit CLOSED
      await expect(service.execute(failingFn)).rejects.toThrow('Service error');
      expect(service.getState()).toBe('CLOSED');

      await expect(service.execute(failingFn)).rejects.toThrow('Service error');
      expect(service.getState()).toBe('CLOSED');

      // Third failure should OPEN the circuit
      await expect(service.execute(failingFn)).rejects.toThrow('Service error');
      expect(service.getState()).toBe('OPEN');

      const stats = service.getStats();
      expect(stats.failureCount).toBe(3);
      expect(stats.nextAttemptAt).not.toBeNull();
    });

    it('should reject calls immediately when OPEN', async () => {
      const failingFn = vi.fn().mockRejectedValue(new Error('Service error'));

      // Trip the circuit
      await expect(service.execute(failingFn)).rejects.toThrow('Service error');
      await expect(service.execute(failingFn)).rejects.toThrow('Service error');
      await expect(service.execute(failingFn)).rejects.toThrow('Service error');

      expect(service.getState()).toBe('OPEN');

      // Now the function should not be called at all
      const successFn = vi.fn().mockResolvedValue('success');
      await expect(service.execute(successFn)).rejects.toThrow(CircuitOpenError);
      expect(successFn).not.toHaveBeenCalled();
    });

    it('should set nextAttemptAt when transitioning to OPEN', async () => {
      const failingFn = vi.fn().mockRejectedValue(new Error('Service error'));
      const beforeOpen = Date.now();

      // Trip the circuit
      await expect(service.execute(failingFn)).rejects.toThrow('Service error');
      await expect(service.execute(failingFn)).rejects.toThrow('Service error');
      await expect(service.execute(failingFn)).rejects.toThrow('Service error');

      const afterOpen = Date.now();
      const stats = service.getStats();

      expect(stats.nextAttemptAt).not.toBeNull();
      const nextAttempt = stats.nextAttemptAt!.getTime();
      // Should be approximately 30000ms (resetTimeoutMs) in the future
      expect(nextAttempt).toBeGreaterThanOrEqual(beforeOpen + 30000);
      expect(nextAttempt).toBeLessThanOrEqual(afterOpen + 30000 + 100); // 100ms tolerance
    });

    it('should include service name and nextAttemptAt in CircuitOpenError', async () => {
      const failingFn = vi.fn().mockRejectedValue(new Error('Service error'));

      // Trip the circuit
      await expect(service.execute(failingFn)).rejects.toThrow('Service error');
      await expect(service.execute(failingFn)).rejects.toThrow('Service error');
      await expect(service.execute(failingFn)).rejects.toThrow('Service error');

      // Try to execute and catch the error
      try {
        await service.execute(vi.fn());
        expect.fail('Should have thrown CircuitOpenError');
      } catch (error) {
        expect(error).toBeInstanceOf(CircuitOpenError);
        const circuitError = error as CircuitOpenError;
        expect(circuitError.serviceName).toBe(serviceName);
        expect(circuitError.nextAttemptAt).not.toBeNull();
        expect(circuitError.message).toContain(serviceName);
      }
    });
  });

  describe('State Transitions: OPEN -> HALF_OPEN', () => {
    beforeEach(async () => {
      vi.mocked(mockRepository.findByServiceName).mockResolvedValue(null);
      vi.mocked(mockRepository.upsert).mockResolvedValue({
        id: '1',
        serviceName,
        state: 'CLOSED',
        failureCount: 0,
        successCount: 0,
        lastFailureAt: null,
        lastSuccessAt: null,
        lastStateChangeAt: new Date(),
        nextAttemptAt: null,
        halfOpenAttempts: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as CircuitBreakerStateRecord);

      service = new CircuitBreakerService(
        serviceName,
        { failureThreshold: 2, resetTimeoutMs: 100, halfOpenRequests: 2 },
        mockRepository
      );
      await service.initialize();
    });

    it('should transition to HALF_OPEN after reset timeout', async () => {
      const failingFn = vi.fn().mockRejectedValue(new Error('Service error'));

      // Trip the circuit
      await expect(service.execute(failingFn)).rejects.toThrow('Service error');
      await expect(service.execute(failingFn)).rejects.toThrow('Service error');
      expect(service.getState()).toBe('OPEN');

      // Wait for reset timeout (100ms + buffer)
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Next execution should transition to HALF_OPEN
      const successFn = vi.fn().mockResolvedValue('success');
      await service.execute(successFn);

      expect(service.getState()).toBe('HALF_OPEN');
      expect(successFn).toHaveBeenCalled();
    });

    it('should reset halfOpenAttempts when transitioning to HALF_OPEN', async () => {
      const failingFn = vi.fn().mockRejectedValue(new Error('Service error'));

      // Trip the circuit
      await expect(service.execute(failingFn)).rejects.toThrow('Service error');
      await expect(service.execute(failingFn)).rejects.toThrow('Service error');
      expect(service.getState()).toBe('OPEN');

      // Wait for reset timeout
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Execute should transition to HALF_OPEN
      const successFn = vi.fn().mockResolvedValue('success');
      await service.execute(successFn);

      const stats = service.getStats();
      expect(stats.state).toBe('HALF_OPEN');
      expect(stats.halfOpenAttempts).toBe(1); // One attempt made
      expect(stats.nextAttemptAt).toBeNull();
    });

    it('should reject calls immediately when still OPEN before timeout', async () => {
      const failingFn = vi.fn().mockRejectedValue(new Error('Service error'));

      // Trip the circuit
      await expect(service.execute(failingFn)).rejects.toThrow('Service error');
      await expect(service.execute(failingFn)).rejects.toThrow('Service error');
      expect(service.getState()).toBe('OPEN');

      // Don't wait for timeout, try immediately
      const successFn = vi.fn().mockResolvedValue('success');
      await expect(service.execute(successFn)).rejects.toThrow(CircuitOpenError);
      expect(successFn).not.toHaveBeenCalled();
      expect(service.getState()).toBe('OPEN');
    });
  });

  describe('State Transitions: HALF_OPEN -> CLOSED', () => {
    beforeEach(async () => {
      vi.mocked(mockRepository.findByServiceName).mockResolvedValue(null);
      vi.mocked(mockRepository.upsert).mockResolvedValue({
        id: '1',
        serviceName,
        state: 'CLOSED',
        failureCount: 0,
        successCount: 0,
        lastFailureAt: null,
        lastSuccessAt: null,
        lastStateChangeAt: new Date(),
        nextAttemptAt: null,
        halfOpenAttempts: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as CircuitBreakerStateRecord);

      service = new CircuitBreakerService(
        serviceName,
        { failureThreshold: 2, resetTimeoutMs: 100, halfOpenRequests: 3 },
        mockRepository
      );
      await service.initialize();
    });

    it('should transition to CLOSED after all half-open requests succeed', async () => {
      const failingFn = vi.fn().mockRejectedValue(new Error('Service error'));

      // Trip the circuit
      await expect(service.execute(failingFn)).rejects.toThrow('Service error');
      await expect(service.execute(failingFn)).rejects.toThrow('Service error');
      expect(service.getState()).toBe('OPEN');

      // Wait for reset timeout
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Execute 3 successful requests (halfOpenRequests = 3)
      const successFn = vi.fn().mockResolvedValue('success');
      await service.execute(successFn);
      expect(service.getState()).toBe('HALF_OPEN');

      await service.execute(successFn);
      expect(service.getState()).toBe('HALF_OPEN');

      await service.execute(successFn);
      expect(service.getState()).toBe('CLOSED');

      expect(successFn).toHaveBeenCalledTimes(3);
    });

    it('should reset counters when transitioning to CLOSED', async () => {
      const failingFn = vi.fn().mockRejectedValue(new Error('Service error'));

      // Trip the circuit
      await expect(service.execute(failingFn)).rejects.toThrow('Service error');
      await expect(service.execute(failingFn)).rejects.toThrow('Service error');

      // Wait for reset timeout
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Execute successful requests to close circuit
      const successFn = vi.fn().mockResolvedValue('success');
      await service.execute(successFn);
      await service.execute(successFn);
      await service.execute(successFn);

      const stats = service.getStats();
      expect(stats.state).toBe('CLOSED');
      expect(stats.failureCount).toBe(0);
      expect(stats.successCount).toBe(0);
      expect(stats.halfOpenAttempts).toBe(0);
      expect(stats.nextAttemptAt).toBeNull();
    });
  });

  describe('State Transitions: HALF_OPEN -> OPEN', () => {
    beforeEach(async () => {
      vi.mocked(mockRepository.findByServiceName).mockResolvedValue(null);
      vi.mocked(mockRepository.upsert).mockResolvedValue({
        id: '1',
        serviceName,
        state: 'CLOSED',
        failureCount: 0,
        successCount: 0,
        lastFailureAt: null,
        lastSuccessAt: null,
        lastStateChangeAt: new Date(),
        nextAttemptAt: null,
        halfOpenAttempts: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as CircuitBreakerStateRecord);

      service = new CircuitBreakerService(
        serviceName,
        { failureThreshold: 2, resetTimeoutMs: 100, halfOpenRequests: 3 },
        mockRepository
      );
      await service.initialize();
    });

    it('should transition back to OPEN on any failure in HALF_OPEN state', async () => {
      const failingFn = vi.fn().mockRejectedValue(new Error('Service error'));

      // Trip the circuit
      await expect(service.execute(failingFn)).rejects.toThrow('Service error');
      await expect(service.execute(failingFn)).rejects.toThrow('Service error');
      expect(service.getState()).toBe('OPEN');

      // Wait for reset timeout
      await new Promise((resolve) => setTimeout(resolve, 150));

      // First request succeeds
      const successFn = vi.fn().mockResolvedValue('success');
      await service.execute(successFn);
      expect(service.getState()).toBe('HALF_OPEN');

      // Second request fails - should immediately reopen
      await expect(service.execute(failingFn)).rejects.toThrow('Service error');
      expect(service.getState()).toBe('OPEN');

      const stats = service.getStats();
      expect(stats.nextAttemptAt).not.toBeNull();
    });

    it('should set new nextAttemptAt when reopening from HALF_OPEN', async () => {
      const failingFn = vi.fn().mockRejectedValue(new Error('Service error'));

      // Trip the circuit
      await expect(service.execute(failingFn)).rejects.toThrow('Service error');
      await expect(service.execute(failingFn)).rejects.toThrow('Service error');

      // Wait for reset timeout
      await new Promise((resolve) => setTimeout(resolve, 150));

      // First request succeeds, moving to HALF_OPEN
      const successFn = vi.fn().mockResolvedValue('success');
      await service.execute(successFn);

      const beforeReopen = Date.now();

      // Second request fails, reopening circuit
      await expect(service.execute(failingFn)).rejects.toThrow('Service error');

      const afterReopen = Date.now();
      const stats = service.getStats();

      expect(stats.state).toBe('OPEN');
      expect(stats.nextAttemptAt).not.toBeNull();
      const nextAttempt = stats.nextAttemptAt!.getTime();
      expect(nextAttempt).toBeGreaterThanOrEqual(beforeReopen + 100);
      expect(nextAttempt).toBeLessThanOrEqual(afterReopen + 100 + 100); // 100ms tolerance
    });
  });

  describe('Success Resets Failure Count', () => {
    beforeEach(async () => {
      vi.mocked(mockRepository.findByServiceName).mockResolvedValue(null);
      vi.mocked(mockRepository.upsert).mockResolvedValue({
        id: '1',
        serviceName,
        state: 'CLOSED',
        failureCount: 0,
        successCount: 0,
        lastFailureAt: null,
        lastSuccessAt: null,
        lastStateChangeAt: new Date(),
        nextAttemptAt: null,
        halfOpenAttempts: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as CircuitBreakerStateRecord);

      service = new CircuitBreakerService(
        serviceName,
        { failureThreshold: 3, resetTimeoutMs: 30000, halfOpenRequests: 2 },
        mockRepository
      );
      await service.initialize();
    });

    it('should reset failure count after a success in CLOSED state', async () => {
      const failingFn = vi.fn().mockRejectedValue(new Error('Service error'));
      const successFn = vi.fn().mockResolvedValue('success');

      // Record 2 failures
      await expect(service.execute(failingFn)).rejects.toThrow('Service error');
      await expect(service.execute(failingFn)).rejects.toThrow('Service error');

      let stats = service.getStats();
      expect(stats.failureCount).toBe(2);
      expect(stats.state).toBe('CLOSED');

      // Record a success
      await service.execute(successFn);

      stats = service.getStats();
      expect(stats.failureCount).toBe(0);
      expect(stats.state).toBe('CLOSED');

      // Now we should need 3 more failures to trip
      await expect(service.execute(failingFn)).rejects.toThrow('Service error');
      expect(service.getState()).toBe('CLOSED');

      await expect(service.execute(failingFn)).rejects.toThrow('Service error');
      expect(service.getState()).toBe('CLOSED');

      await expect(service.execute(failingFn)).rejects.toThrow('Service error');
      expect(service.getState()).toBe('OPEN');
    });

    it('should increment success count', async () => {
      const successFn = vi.fn().mockResolvedValue('success');

      await service.execute(successFn);
      let stats = service.getStats();
      expect(stats.successCount).toBe(1);

      await service.execute(successFn);
      stats = service.getStats();
      expect(stats.successCount).toBe(2);
    });

    it('should update lastSuccessAt timestamp', async () => {
      const successFn = vi.fn().mockResolvedValue('success');
      const before = Date.now();

      await service.execute(successFn);

      const after = Date.now();
      const stats = service.getStats();

      expect(stats.lastSuccessAt).not.toBeNull();
      const timestamp = stats.lastSuccessAt!.getTime();
      expect(timestamp).toBeGreaterThanOrEqual(before);
      expect(timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe('Failure Threshold Configuration', () => {
    it('should respect custom failure threshold', async () => {
      vi.mocked(mockRepository.findByServiceName).mockResolvedValue(null);
      vi.mocked(mockRepository.upsert).mockResolvedValue({
        id: '1',
        serviceName,
        state: 'CLOSED',
        failureCount: 0,
        successCount: 0,
        lastFailureAt: null,
        lastSuccessAt: null,
        lastStateChangeAt: new Date(),
        nextAttemptAt: null,
        halfOpenAttempts: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as CircuitBreakerStateRecord);

      service = new CircuitBreakerService(serviceName, { failureThreshold: 1 }, mockRepository);
      await service.initialize();

      const failingFn = vi.fn().mockRejectedValue(new Error('Service error'));

      // Should open after just 1 failure
      await expect(service.execute(failingFn)).rejects.toThrow('Service error');
      expect(service.getState()).toBe('OPEN');
    });

    it('should handle high failure threshold', async () => {
      vi.mocked(mockRepository.findByServiceName).mockResolvedValue(null);
      vi.mocked(mockRepository.upsert).mockResolvedValue({
        id: '1',
        serviceName,
        state: 'CLOSED',
        failureCount: 0,
        successCount: 0,
        lastFailureAt: null,
        lastSuccessAt: null,
        lastStateChangeAt: new Date(),
        nextAttemptAt: null,
        halfOpenAttempts: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as CircuitBreakerStateRecord);

      service = new CircuitBreakerService(serviceName, { failureThreshold: 10 }, mockRepository);
      await service.initialize();

      const failingFn = vi.fn().mockRejectedValue(new Error('Service error'));

      // Should remain closed for 9 failures
      for (let i = 0; i < 9; i++) {
        await expect(service.execute(failingFn)).rejects.toThrow('Service error');
        expect(service.getState()).toBe('CLOSED');
      }

      // 10th failure should open
      await expect(service.execute(failingFn)).rejects.toThrow('Service error');
      expect(service.getState()).toBe('OPEN');
    });
  });

  describe('Reset Timeout Configuration', () => {
    it('should respect custom reset timeout', async () => {
      vi.mocked(mockRepository.findByServiceName).mockResolvedValue(null);
      vi.mocked(mockRepository.upsert).mockResolvedValue({
        id: '1',
        serviceName,
        state: 'CLOSED',
        failureCount: 0,
        successCount: 0,
        lastFailureAt: null,
        lastSuccessAt: null,
        lastStateChangeAt: new Date(),
        nextAttemptAt: null,
        halfOpenAttempts: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as CircuitBreakerStateRecord);

      service = new CircuitBreakerService(
        serviceName,
        { failureThreshold: 1, resetTimeoutMs: 200 },
        mockRepository
      );
      await service.initialize();

      const failingFn = vi.fn().mockRejectedValue(new Error('Service error'));

      // Trip the circuit
      await expect(service.execute(failingFn)).rejects.toThrow('Service error');
      expect(service.getState()).toBe('OPEN');

      // Should still be open before timeout
      await new Promise((resolve) => setTimeout(resolve, 100));
      const successFn = vi.fn().mockResolvedValue('success');
      await expect(service.execute(successFn)).rejects.toThrow(CircuitOpenError);
      expect(service.getState()).toBe('OPEN');

      // Should transition to HALF_OPEN after timeout
      await new Promise((resolve) => setTimeout(resolve, 150));
      await service.execute(successFn);
      expect(service.getState()).toBe('HALF_OPEN');
    });

    it('should calculate nextAttemptAt based on reset timeout', async () => {
      vi.mocked(mockRepository.findByServiceName).mockResolvedValue(null);
      vi.mocked(mockRepository.upsert).mockResolvedValue({
        id: '1',
        serviceName,
        state: 'CLOSED',
        failureCount: 0,
        successCount: 0,
        lastFailureAt: null,
        lastSuccessAt: null,
        lastStateChangeAt: new Date(),
        nextAttemptAt: null,
        halfOpenAttempts: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as CircuitBreakerStateRecord);

      const customTimeout = 5000;
      service = new CircuitBreakerService(
        serviceName,
        { failureThreshold: 1, resetTimeoutMs: customTimeout },
        mockRepository
      );
      await service.initialize();

      const failingFn = vi.fn().mockRejectedValue(new Error('Service error'));
      const beforeOpen = Date.now();

      // Trip the circuit
      await expect(service.execute(failingFn)).rejects.toThrow('Service error');

      const afterOpen = Date.now();
      const stats = service.getStats();

      expect(stats.nextAttemptAt).not.toBeNull();
      const nextAttempt = stats.nextAttemptAt!.getTime();
      expect(nextAttempt).toBeGreaterThanOrEqual(beforeOpen + customTimeout);
      expect(nextAttempt).toBeLessThanOrEqual(afterOpen + customTimeout + 100);
    });
  });

  describe('Multiple Circuit Breakers', () => {
    it('should maintain independent state for different services', async () => {
      vi.mocked(mockRepository.findByServiceName).mockResolvedValue(null);
      vi.mocked(mockRepository.upsert).mockResolvedValue({
        id: '1',
        serviceName: 'service-1',
        state: 'CLOSED',
        failureCount: 0,
        successCount: 0,
        lastFailureAt: null,
        lastSuccessAt: null,
        lastStateChangeAt: new Date(),
        nextAttemptAt: null,
        halfOpenAttempts: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as CircuitBreakerStateRecord);

      const service1 = new CircuitBreakerService('service-1', { failureThreshold: 2 }, mockRepository);
      await service1.initialize();

      vi.mocked(mockRepository.findByServiceName).mockResolvedValue(null);
      vi.mocked(mockRepository.upsert).mockResolvedValue({
        id: '2',
        serviceName: 'service-2',
        state: 'CLOSED',
        failureCount: 0,
        successCount: 0,
        lastFailureAt: null,
        lastSuccessAt: null,
        lastStateChangeAt: new Date(),
        nextAttemptAt: null,
        halfOpenAttempts: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as CircuitBreakerStateRecord);

      const service2 = new CircuitBreakerService('service-2', { failureThreshold: 2 }, mockRepository);
      await service2.initialize();

      const failingFn = vi.fn().mockRejectedValue(new Error('Service error'));

      // Trip service1
      await expect(service1.execute(failingFn)).rejects.toThrow('Service error');
      await expect(service1.execute(failingFn)).rejects.toThrow('Service error');

      expect(service1.getState()).toBe('OPEN');
      expect(service2.getState()).toBe('CLOSED');

      // Service2 should still work
      const successFn = vi.fn().mockResolvedValue('success');
      await service2.execute(successFn);
      expect(service2.getState()).toBe('CLOSED');
    });

    it('should track separate statistics for different services', async () => {
      vi.mocked(mockRepository.findByServiceName).mockResolvedValue(null);
      vi.mocked(mockRepository.upsert).mockResolvedValue({
        id: '1',
        serviceName: 'service-a',
        state: 'CLOSED',
        failureCount: 0,
        successCount: 0,
        lastFailureAt: null,
        lastSuccessAt: null,
        lastStateChangeAt: new Date(),
        nextAttemptAt: null,
        halfOpenAttempts: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as CircuitBreakerStateRecord);

      const serviceA = new CircuitBreakerService('service-a', {}, mockRepository);
      await serviceA.initialize();

      vi.mocked(mockRepository.findByServiceName).mockResolvedValue(null);
      vi.mocked(mockRepository.upsert).mockResolvedValue({
        id: '2',
        serviceName: 'service-b',
        state: 'CLOSED',
        failureCount: 0,
        successCount: 0,
        lastFailureAt: null,
        lastSuccessAt: null,
        lastStateChangeAt: new Date(),
        nextAttemptAt: null,
        halfOpenAttempts: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as CircuitBreakerStateRecord);

      const serviceB = new CircuitBreakerService('service-b', {}, mockRepository);
      await serviceB.initialize();

      const failingFn = vi.fn().mockRejectedValue(new Error('Service error'));
      const successFn = vi.fn().mockResolvedValue('success');

      // Execute different operations on each service
      await expect(serviceA.execute(failingFn)).rejects.toThrow('Service error');
      await serviceB.execute(successFn);
      await serviceB.execute(successFn);

      const statsA = serviceA.getStats();
      const statsB = serviceB.getStats();

      expect(statsA.serviceName).toBe('service-a');
      expect(statsA.failureCount).toBe(1);
      expect(statsA.successCount).toBe(0);

      expect(statsB.serviceName).toBe('service-b');
      expect(statsB.failureCount).toBe(0);
      expect(statsB.successCount).toBe(2);
    });
  });

  describe('Manual Reset', () => {
    beforeEach(async () => {
      vi.mocked(mockRepository.findByServiceName).mockResolvedValue(null);
      vi.mocked(mockRepository.upsert).mockResolvedValue({
        id: '1',
        serviceName,
        state: 'CLOSED',
        failureCount: 0,
        successCount: 0,
        lastFailureAt: null,
        lastSuccessAt: null,
        lastStateChangeAt: new Date(),
        nextAttemptAt: null,
        halfOpenAttempts: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as CircuitBreakerStateRecord);

      service = new CircuitBreakerService(
        serviceName,
        { failureThreshold: 2, resetTimeoutMs: 30000 },
        mockRepository
      );
      await service.initialize();
    });

    it('should manually reset circuit to CLOSED state', async () => {
      const failingFn = vi.fn().mockRejectedValue(new Error('Service error'));

      // Trip the circuit
      await expect(service.execute(failingFn)).rejects.toThrow('Service error');
      await expect(service.execute(failingFn)).rejects.toThrow('Service error');
      expect(service.getState()).toBe('OPEN');

      // Manually reset
      await service.reset();
      expect(service.getState()).toBe('CLOSED');

      // Should be able to execute immediately
      const successFn = vi.fn().mockResolvedValue('success');
      await service.execute(successFn);
      expect(successFn).toHaveBeenCalled();
    });

    it('should reset all counters when manually reset', async () => {
      const failingFn = vi.fn().mockRejectedValue(new Error('Service error'));

      // Trip the circuit
      await expect(service.execute(failingFn)).rejects.toThrow('Service error');
      await expect(service.execute(failingFn)).rejects.toThrow('Service error');

      // Manually reset
      await service.reset();

      const stats = service.getStats();
      expect(stats.state).toBe('CLOSED');
      expect(stats.failureCount).toBe(0);
      expect(stats.successCount).toBe(0);
      expect(stats.nextAttemptAt).toBeNull();
      expect(stats.halfOpenAttempts).toBe(0);
    });
  });

  describe('Half-Open Request Limiting', () => {
    beforeEach(async () => {
      vi.mocked(mockRepository.findByServiceName).mockResolvedValue(null);
      vi.mocked(mockRepository.upsert).mockResolvedValue({
        id: '1',
        serviceName,
        state: 'CLOSED',
        failureCount: 0,
        successCount: 0,
        lastFailureAt: null,
        lastSuccessAt: null,
        lastStateChangeAt: new Date(),
        nextAttemptAt: null,
        halfOpenAttempts: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as CircuitBreakerStateRecord);

      service = new CircuitBreakerService(
        serviceName,
        { failureThreshold: 2, resetTimeoutMs: 100, halfOpenRequests: 2 },
        mockRepository
      );
      await service.initialize();
    });

    it('should limit number of requests in HALF_OPEN state', async () => {
      const failingFn = vi.fn().mockRejectedValue(new Error('Service error'));

      // Trip the circuit
      await expect(service.execute(failingFn)).rejects.toThrow('Service error');
      await expect(service.execute(failingFn)).rejects.toThrow('Service error');
      expect(service.getState()).toBe('OPEN');

      // Wait for reset timeout
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Execute 2 requests sequentially (halfOpenRequests = 2)
      const successFn = vi.fn().mockResolvedValue('success');
      await service.execute(successFn);
      await service.execute(successFn);

      // At this point, circuit should be CLOSED after 2 successful half-open requests
      expect(service.getState()).toBe('CLOSED');
      expect(successFn).toHaveBeenCalledTimes(2);
    });

    it('should track half-open attempts correctly', async () => {
      const failingFn = vi.fn().mockRejectedValue(new Error('Service error'));

      // Trip the circuit
      await expect(service.execute(failingFn)).rejects.toThrow('Service error');
      await expect(service.execute(failingFn)).rejects.toThrow('Service error');

      // Wait for reset timeout
      await new Promise((resolve) => setTimeout(resolve, 150));

      // First half-open request
      const successFn = vi.fn().mockResolvedValue('success');
      await service.execute(successFn);

      let stats = service.getStats();
      expect(stats.halfOpenAttempts).toBe(1);
      expect(stats.state).toBe('HALF_OPEN');

      // Second half-open request - this will close the circuit
      await service.execute(successFn);

      stats = service.getStats();
      // After closing, counters are reset
      expect(stats.halfOpenAttempts).toBe(0);
      expect(stats.state).toBe('CLOSED');
    });
  });

  describe('getStats', () => {
    beforeEach(async () => {
      vi.mocked(mockRepository.findByServiceName).mockResolvedValue(null);
      vi.mocked(mockRepository.upsert).mockResolvedValue({
        id: '1',
        serviceName,
        state: 'CLOSED',
        failureCount: 0,
        successCount: 0,
        lastFailureAt: null,
        lastSuccessAt: null,
        lastStateChangeAt: new Date(),
        nextAttemptAt: null,
        halfOpenAttempts: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as CircuitBreakerStateRecord);

      service = new CircuitBreakerService(serviceName, {}, mockRepository);
      await service.initialize();
    });

    it('should return complete statistics', async () => {
      const stats = service.getStats();

      expect(stats).toHaveProperty('serviceName');
      expect(stats).toHaveProperty('state');
      expect(stats).toHaveProperty('failureCount');
      expect(stats).toHaveProperty('successCount');
      expect(stats).toHaveProperty('lastFailureAt');
      expect(stats).toHaveProperty('lastSuccessAt');
      expect(stats).toHaveProperty('lastStateChangeAt');
      expect(stats).toHaveProperty('nextAttemptAt');
      expect(stats).toHaveProperty('halfOpenAttempts');
      expect(stats).toHaveProperty('config');
    });

    it('should return current configuration', async () => {
      const stats = service.getStats();

      expect(stats.config).toHaveProperty('failureThreshold');
      expect(stats.config).toHaveProperty('resetTimeoutMs');
      expect(stats.config).toHaveProperty('halfOpenRequests');
    });

    it('should reflect current state accurately', async () => {
      const failingFn = vi.fn().mockRejectedValue(new Error('Service error'));

      // Initial state
      let stats = service.getStats();
      expect(stats.state).toBe('CLOSED');
      expect(stats.failureCount).toBe(0);

      // After failure
      await expect(service.execute(failingFn)).rejects.toThrow('Service error');
      stats = service.getStats();
      expect(stats.failureCount).toBe(1);
    });
  });

  describe('isOpen', () => {
    beforeEach(async () => {
      vi.mocked(mockRepository.findByServiceName).mockResolvedValue(null);
      vi.mocked(mockRepository.upsert).mockResolvedValue({
        id: '1',
        serviceName,
        state: 'CLOSED',
        failureCount: 0,
        successCount: 0,
        lastFailureAt: null,
        lastSuccessAt: null,
        lastStateChangeAt: new Date(),
        nextAttemptAt: null,
        halfOpenAttempts: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as CircuitBreakerStateRecord);

      service = new CircuitBreakerService(
        serviceName,
        { failureThreshold: 2, resetTimeoutMs: 100 },
        mockRepository
      );
      await service.initialize();
    });

    it('should return false when CLOSED', () => {
      expect(service.isOpen()).toBe(false);
    });

    it('should return true when OPEN', async () => {
      const failingFn = vi.fn().mockRejectedValue(new Error('Service error'));

      // Trip the circuit
      await expect(service.execute(failingFn)).rejects.toThrow('Service error');
      await expect(service.execute(failingFn)).rejects.toThrow('Service error');

      expect(service.isOpen()).toBe(true);
    });

    it('should return false when HALF_OPEN', async () => {
      const failingFn = vi.fn().mockRejectedValue(new Error('Service error'));

      // Trip the circuit
      await expect(service.execute(failingFn)).rejects.toThrow('Service error');
      await expect(service.execute(failingFn)).rejects.toThrow('Service error');

      // Wait for reset timeout
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Transition to HALF_OPEN
      const successFn = vi.fn().mockResolvedValue('success');
      await service.execute(successFn);

      expect(service.isOpen()).toBe(false);
    });

    it('should return false when OPEN but timeout has elapsed', async () => {
      const failingFn = vi.fn().mockRejectedValue(new Error('Service error'));

      // Trip the circuit
      await expect(service.execute(failingFn)).rejects.toThrow('Service error');
      await expect(service.execute(failingFn)).rejects.toThrow('Service error');

      expect(service.isOpen()).toBe(true);

      // Wait for reset timeout
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Should now allow transition to HALF_OPEN
      expect(service.isOpen()).toBe(false);
    });
  });

  describe('Database Persistence', () => {
    beforeEach(async () => {
      vi.mocked(mockRepository.findByServiceName).mockResolvedValue(null);
      vi.mocked(mockRepository.upsert).mockResolvedValue({
        id: '1',
        serviceName,
        state: 'CLOSED',
        failureCount: 0,
        successCount: 0,
        lastFailureAt: null,
        lastSuccessAt: null,
        lastStateChangeAt: new Date(),
        nextAttemptAt: null,
        halfOpenAttempts: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as CircuitBreakerStateRecord);

      service = new CircuitBreakerService(serviceName, {}, mockRepository);
      await service.initialize();
    });

    it('should persist state changes to database', async () => {
      const failingFn = vi.fn().mockRejectedValue(new Error('Service error'));

      await expect(service.execute(failingFn)).rejects.toThrow('Service error');

      // Should have called upsert multiple times (init + failure)
      expect(mockRepository.upsert).toHaveBeenCalled();
    });

    it('should persist success to database', async () => {
      const successFn = vi.fn().mockResolvedValue('success');

      await service.execute(successFn);

      expect(mockRepository.upsert).toHaveBeenCalled();
    });

    it('should persist state transitions to database', async () => {
      const failingFn = vi.fn().mockRejectedValue(new Error('Service error'));

      // Clear initial calls
      vi.clearAllMocks();

      // Trip circuit - should persist OPEN state
      await expect(service.execute(failingFn)).rejects.toThrow('Service error');
      await expect(service.execute(failingFn)).rejects.toThrow('Service error');
      await expect(service.execute(failingFn)).rejects.toThrow('Service error');
      await expect(service.execute(failingFn)).rejects.toThrow('Service error');
      await expect(service.execute(failingFn)).rejects.toThrow('Service error');

      // Should have persisted each failure
      expect(mockRepository.upsert).toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    it('should handle execute with immediately resolving function', async () => {
      vi.mocked(mockRepository.findByServiceName).mockResolvedValue(null);
      vi.mocked(mockRepository.upsert).mockResolvedValue({
        id: '1',
        serviceName,
        state: 'CLOSED',
        failureCount: 0,
        successCount: 0,
        lastFailureAt: null,
        lastSuccessAt: null,
        lastStateChangeAt: new Date(),
        nextAttemptAt: null,
        halfOpenAttempts: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as CircuitBreakerStateRecord);

      service = new CircuitBreakerService(serviceName, {}, mockRepository);
      await service.initialize();

      const syncFn = vi.fn().mockResolvedValue('immediate');
      const result = await service.execute(syncFn);

      expect(result).toBe('immediate');
      expect(syncFn).toHaveBeenCalled();
    });

    it('should handle execute with function returning non-primitive', async () => {
      vi.mocked(mockRepository.findByServiceName).mockResolvedValue(null);
      vi.mocked(mockRepository.upsert).mockResolvedValue({
        id: '1',
        serviceName,
        state: 'CLOSED',
        failureCount: 0,
        successCount: 0,
        lastFailureAt: null,
        lastSuccessAt: null,
        lastStateChangeAt: new Date(),
        nextAttemptAt: null,
        halfOpenAttempts: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as CircuitBreakerStateRecord);

      service = new CircuitBreakerService(serviceName, {}, mockRepository);
      await service.initialize();

      const complexResult = { data: 'value', nested: { key: 123 } };
      const complexFn = vi.fn().mockResolvedValue(complexResult);
      const result = await service.execute(complexFn);

      expect(result).toEqual(complexResult);
    });

    it('should handle very rapid consecutive calls', async () => {
      vi.mocked(mockRepository.findByServiceName).mockResolvedValue(null);
      vi.mocked(mockRepository.upsert).mockResolvedValue({
        id: '1',
        serviceName,
        state: 'CLOSED',
        failureCount: 0,
        successCount: 0,
        lastFailureAt: null,
        lastSuccessAt: null,
        lastStateChangeAt: new Date(),
        nextAttemptAt: null,
        halfOpenAttempts: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as CircuitBreakerStateRecord);

      service = new CircuitBreakerService(
        serviceName,
        { failureThreshold: 3 },
        mockRepository
      );
      await service.initialize();

      const failingFn = vi.fn().mockRejectedValue(new Error('Service error'));

      // Fire multiple failures rapidly
      const promises = [
        service.execute(failingFn).catch(() => {}),
        service.execute(failingFn).catch(() => {}),
        service.execute(failingFn).catch(() => {}),
      ];

      await Promise.all(promises);

      expect(service.getState()).toBe('OPEN');
    });

    it('should preserve error details when throwing', async () => {
      vi.mocked(mockRepository.findByServiceName).mockResolvedValue(null);
      vi.mocked(mockRepository.upsert).mockResolvedValue({
        id: '1',
        serviceName,
        state: 'CLOSED',
        failureCount: 0,
        successCount: 0,
        lastFailureAt: null,
        lastSuccessAt: null,
        lastStateChangeAt: new Date(),
        nextAttemptAt: null,
        halfOpenAttempts: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as CircuitBreakerStateRecord);

      service = new CircuitBreakerService(serviceName, {}, mockRepository);
      await service.initialize();

      const customError = new Error('Custom error message');
      (customError as any).code = 'CUSTOM_CODE';
      const failingFn = vi.fn().mockRejectedValue(customError);

      try {
        await service.execute(failingFn);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error).toBe(customError);
        expect((error as any).code).toBe('CUSTOM_CODE');
      }
    });
  });
});
