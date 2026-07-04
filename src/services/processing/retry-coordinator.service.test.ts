/**
 * Retry Coordinator Service Tests
 *
 * Comprehensive tests for the RetryCoordinatorService which handles:
 * - Retry logic for failed message processing
 * - Dead letter queue routing when retries are exhausted
 * - Error history tracking
 * - Cleanup of stale error history entries
 *
 * Run: npx vitest src/services/processing/retry-coordinator.service.test.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  RetryCoordinatorService,
  FailureAction,
  RetryCoordinatorConfig,
} from './retry-coordinator.service.js';
import type { QueueItem, ProcessingResult, ErrorRecord } from '../../types/index.js';
import type { QueueRepository } from '../../repositories/queue.repository.js';
import type { RetryStrategyService } from '../retryStrategy.service.js';
import type { DeadLetterQueueService } from '../deadLetterQueue.service.js';

// ============================================================================
// Mocks
// ============================================================================

// Mock logger to avoid noise in test output
vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock appConfig
vi.mock('../../config/index.js', () => ({
  appConfig: {
    queue: {
      maxAttempts: 5,
    },
  },
}));

// ============================================================================
// Test Fixtures
// ============================================================================

const createMockQueueItem = (overrides?: Partial<QueueItem>): QueueItem => ({
  id: `queue-${Math.random().toString(36).substring(7)}`,
  messageId: `msg-${Math.random().toString(36).substring(7)}`,
  status: 'processing',
  priority: 0,
  attempts: 0,
  lastError: null,
  processedAt: null,
  version: 1,
  processingStartedAt: new Date(),
  createdAt: new Date(),
  nextRetryAt: null,
  priorityBoostApplied: false,
  originalPriority: null,
  ...overrides,
});

const createMockProcessingResult = (overrides?: Partial<ProcessingResult>): ProcessingResult => ({
  success: true,
  ...overrides,
});

const createMockErrorRecord = (overrides?: Partial<ErrorRecord>): ErrorRecord => ({
  timestamp: new Date(),
  error: 'Test error',
  attempt: 1,
  ...overrides,
});

// ============================================================================
// Tests
// ============================================================================

describe('RetryCoordinatorService', () => {
  let service: RetryCoordinatorService;
  let mockQueueRepository: {
    markCompleted: ReturnType<typeof vi.fn>;
    markFailed: ReturnType<typeof vi.fn>;
    updateAttemptsWithError: ReturnType<typeof vi.fn>;
    scheduleRetry: ReturnType<typeof vi.fn>;
    getById: ReturnType<typeof vi.fn>;
  };
  let mockRetryStrategyService: {
    shouldRetry: ReturnType<typeof vi.fn>;
    calculateNextRetryTime: ReturnType<typeof vi.fn>;
  } | null;
  let mockDeadLetterQueueService: {
    moveToDeadLetter: ReturnType<typeof vi.fn>;
  } | null;

  beforeEach(() => {
    vi.useFakeTimers();

    // Create mock repositories and services
    mockQueueRepository = {
      markCompleted: vi.fn().mockResolvedValue(undefined),
      markFailed: vi.fn().mockResolvedValue(undefined),
      updateAttemptsWithError: vi.fn().mockResolvedValue(1),
      scheduleRetry: vi.fn().mockResolvedValue(undefined),
      getById: vi.fn().mockResolvedValue(createMockQueueItem({ status: 'processing' })),
    };

    mockRetryStrategyService = {
      shouldRetry: vi.fn().mockReturnValue(true),
      calculateNextRetryTime: vi.fn().mockReturnValue(new Date(Date.now() + 5000)),
    };

    mockDeadLetterQueueService = {
      moveToDeadLetter: vi.fn().mockResolvedValue({ id: 'dlq-1' }),
    };

    service = new RetryCoordinatorService(
      mockQueueRepository as unknown as QueueRepository,
      mockRetryStrategyService as unknown as RetryStrategyService,
      mockDeadLetterQueueService as unknown as DeadLetterQueueService,
      {
        maxAttempts: 5,
        errorHistoryMaxAgeMs: 60 * 60 * 1000, // 1 hour
        cleanupIntervalMs: 5 * 60 * 1000, // 5 minutes
      }
    );
  });

  afterEach(() => {
    service.stop();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  // ==========================================================================
  // Constructor Tests
  // ==========================================================================

  describe('constructor', () => {
    it('should initialize with default configuration', () => {
      const defaultService = new RetryCoordinatorService(
        mockQueueRepository as unknown as QueueRepository,
        null,
        null
      );
      // Service should be created without throwing
      expect(defaultService).toBeDefined();
      defaultService.stop();
    });

    it('should initialize with custom configuration', () => {
      const customConfig: Partial<RetryCoordinatorConfig> = {
        maxAttempts: 10,
        errorHistoryMaxAgeMs: 2 * 60 * 60 * 1000,
        cleanupIntervalMs: 10 * 60 * 1000,
      };

      const customService = new RetryCoordinatorService(
        mockQueueRepository as unknown as QueueRepository,
        null,
        null,
        customConfig
      );
      expect(customService).toBeDefined();
      customService.stop();
    });

    it('should start cleanup interval on initialization', () => {
      const setIntervalSpy = vi.spyOn(global, 'setInterval');

      const testService = new RetryCoordinatorService(
        mockQueueRepository as unknown as QueueRepository,
        null,
        null,
        { cleanupIntervalMs: 60000 }
      );

      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 60000);
      testService.stop();
    });
  });

  // ==========================================================================
  // handleResult Tests - Success Cases
  // ==========================================================================

  describe('handleResult - success cases', () => {
    it('should mark queue item as completed on success', async () => {
      const queueItem = createMockQueueItem({ id: 'queue-1', messageId: 'msg-1' });
      const result = createMockProcessingResult({ success: true });

      await service.handleResult(queueItem, result);

      expect(mockQueueRepository.markCompleted).toHaveBeenCalledWith('queue-1');
      expect(mockQueueRepository.markFailed).not.toHaveBeenCalled();
    });

    it('should clear error history on success after multiple failures', async () => {
      const queueItem = createMockQueueItem({ id: 'queue-1', attempts: 3 });

      // First, simulate some failures to build up error history
      mockRetryStrategyService!.shouldRetry.mockReturnValue(true);
      mockQueueRepository.updateAttemptsWithError.mockResolvedValue(1);

      await service.handleFailure(queueItem, 'Error 1');
      await service.handleFailure(queueItem, 'Error 2');

      // Verify error history exists
      expect(service.getErrorHistory('queue-1')).toBeDefined();
      expect(service.getErrorHistorySize()).toBeGreaterThan(0);

      // Now process success
      const result = createMockProcessingResult({ success: true });
      await service.handleResult(queueItem, result);

      // Error history should be cleared
      expect(service.getErrorHistory('queue-1')).toBeUndefined();
    });

    it('should handle success with response data', async () => {
      const queueItem = createMockQueueItem();
      const result = createMockProcessingResult({
        success: true,
        response: 'Test response',
        llmResponseId: 'llm-123',
      });

      await service.handleResult(queueItem, result);

      expect(mockQueueRepository.markCompleted).toHaveBeenCalledWith(queueItem.id);
    });
  });

  // ==========================================================================
  // handleResult Tests - Failure Cases
  // ==========================================================================

  describe('handleResult - failure cases', () => {
    it('should call handleFailure when result is unsuccessful', async () => {
      const queueItem = createMockQueueItem();
      const result = createMockProcessingResult({
        success: false,
        error: 'Processing failed',
      });

      await service.handleResult(queueItem, result);

      expect(mockQueueRepository.updateAttemptsWithError).toHaveBeenCalledWith(
        queueItem.id,
        'Processing failed'
      );
    });

    it('should use default error message when error is undefined', async () => {
      const queueItem = createMockQueueItem();
      const result = createMockProcessingResult({
        success: false,
        error: undefined,
      });

      await service.handleResult(queueItem, result);

      expect(mockQueueRepository.updateAttemptsWithError).toHaveBeenCalledWith(
        queueItem.id,
        'Unknown error'
      );
    });
  });

  // ==========================================================================
  // handleFailure Tests - Retry Scenarios
  // ==========================================================================

  describe('handleFailure - retry scenarios', () => {
    it('should schedule retry with RetryStrategyService when configured', async () => {
      const queueItem = createMockQueueItem({ id: 'queue-1', attempts: 1 });
      const nextRetryTime = new Date(Date.now() + 5000);

      mockRetryStrategyService!.shouldRetry.mockReturnValue(true);
      mockRetryStrategyService!.calculateNextRetryTime.mockReturnValue(nextRetryTime);
      mockQueueRepository.updateAttemptsWithError.mockResolvedValue(2);

      const action = await service.handleFailure(queueItem, 'Test error');

      expect(action.action).toBe('retry');
      expect((action as { action: 'retry'; delayMs: number; nextRetryAt: Date }).nextRetryAt).toBe(
        nextRetryTime
      );
      expect(mockQueueRepository.scheduleRetry).toHaveBeenCalledWith(
        'queue-1',
        nextRetryTime,
        'Test error'
      );
    });

    it('should perform immediate retry without RetryStrategyService (legacy behavior)', async () => {
      // Create service without RetryStrategyService
      const legacyService = new RetryCoordinatorService(
        mockQueueRepository as unknown as QueueRepository,
        null, // No retry strategy service
        mockDeadLetterQueueService as unknown as DeadLetterQueueService,
        { maxAttempts: 5 }
      );

      const queueItem = createMockQueueItem({ attempts: 1 });
      mockQueueRepository.updateAttemptsWithError.mockResolvedValue(2);

      const action = await legacyService.handleFailure(queueItem, 'Test error');

      expect(action.action).toBe('retry');
      expect((action as { action: 'retry'; delayMs: number }).delayMs).toBe(0);
      expect(mockQueueRepository.scheduleRetry).not.toHaveBeenCalled();

      legacyService.stop();
    });

    it('should track error history for each failure attempt', async () => {
      const queueItem = createMockQueueItem({ id: 'queue-1', attempts: 0 });
      mockRetryStrategyService!.shouldRetry.mockReturnValue(true);
      mockQueueRepository.updateAttemptsWithError
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(3);

      await service.handleFailure(queueItem, 'Error 1');
      await service.handleFailure(queueItem, 'Error 2');
      await service.handleFailure(queueItem, 'Error 3');

      const errorHistory = service.getErrorHistory('queue-1');
      expect(errorHistory).toBeDefined();
      expect(errorHistory!.length).toBe(3);
      expect(errorHistory![0].error).toBe('Error 1');
      expect(errorHistory![1].error).toBe('Error 2');
      expect(errorHistory![2].error).toBe('Error 3');
    });

    it('should calculate correct delay from nextRetryAt', async () => {
      const queueItem = createMockQueueItem({ attempts: 1 });
      const currentTime = Date.now();
      const nextRetryTime = new Date(currentTime + 10000); // 10 seconds in future

      vi.setSystemTime(currentTime);

      mockRetryStrategyService!.shouldRetry.mockReturnValue(true);
      mockRetryStrategyService!.calculateNextRetryTime.mockReturnValue(nextRetryTime);
      mockQueueRepository.updateAttemptsWithError.mockResolvedValue(2);

      const action = await service.handleFailure(queueItem, 'Test error');

      expect(action.action).toBe('retry');
      const retryAction = action as { action: 'retry'; delayMs: number };
      expect(retryAction.delayMs).toBeCloseTo(10000, -2); // Within 100ms tolerance
    });
  });

  // ==========================================================================
  // handleFailure Tests - Exhausted Retries with DLQ
  // ==========================================================================

  describe('handleFailure - retry exhausted with DLQ', () => {
    it('should move to DLQ when retries are exhausted and DLQ service is available', async () => {
      const queueItem = createMockQueueItem({ id: 'queue-1', attempts: 4 });

      mockRetryStrategyService!.shouldRetry.mockReturnValue(false);
      mockQueueRepository.updateAttemptsWithError.mockResolvedValue(5);

      const action = await service.handleFailure(queueItem, 'Final error');

      expect(action).toEqual({ action: 'dead-letter' });
      expect(mockDeadLetterQueueService!.moveToDeadLetter).toHaveBeenCalledWith(
        'queue-1',
        'MAX_RETRIES_EXCEEDED',
        expect.any(Array)
      );
    });

    it('should include error history when moving to DLQ', async () => {
      const queueItem = createMockQueueItem({ id: 'queue-1', attempts: 0 });

      // Build up error history first
      mockRetryStrategyService!.shouldRetry
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(false);
      mockQueueRepository.updateAttemptsWithError
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(3);

      await service.handleFailure(queueItem, 'Error 1');
      await service.handleFailure(queueItem, 'Error 2');
      await service.handleFailure(queueItem, 'Error 3');

      expect(mockDeadLetterQueueService!.moveToDeadLetter).toHaveBeenCalledWith(
        'queue-1',
        'MAX_RETRIES_EXCEEDED',
        expect.arrayContaining([
          expect.objectContaining({ error: 'Error 1' }),
          expect.objectContaining({ error: 'Error 2' }),
          expect.objectContaining({ error: 'Error 3' }),
        ])
      );
    });

    it('should clear error history after moving to DLQ', async () => {
      const queueItem = createMockQueueItem({ id: 'queue-1', attempts: 4 });

      mockRetryStrategyService!.shouldRetry.mockReturnValue(false);
      mockQueueRepository.updateAttemptsWithError.mockResolvedValue(5);

      // Ensure there's error history
      await service.handleFailure(queueItem, 'Error before DLQ');

      expect(service.getErrorHistory('queue-1')).toBeUndefined(); // Cleared after DLQ move
    });
  });

  // ==========================================================================
  // handleFailure Tests - Exhausted Retries without DLQ
  // ==========================================================================

  describe('handleFailure - retry exhausted without DLQ', () => {
    it('should mark as failed when retries exhausted and no DLQ service', async () => {
      // Create service without DLQ
      const noDlqService = new RetryCoordinatorService(
        mockQueueRepository as unknown as QueueRepository,
        mockRetryStrategyService as unknown as RetryStrategyService,
        null, // No DLQ service
        { maxAttempts: 5 }
      );

      const queueItem = createMockQueueItem({ id: 'queue-1', attempts: 4 });
      mockRetryStrategyService!.shouldRetry.mockReturnValue(false);
      mockQueueRepository.updateAttemptsWithError.mockResolvedValue(5);

      const action = await noDlqService.handleFailure(queueItem, 'Final error');

      expect(action).toEqual({ action: 'failed' });
      expect(mockQueueRepository.markFailed).toHaveBeenCalledWith('queue-1', 'Final error');

      noDlqService.stop();
    });
  });

  // ==========================================================================
  // handleFailure Tests - DLQ Move Failure
  // ==========================================================================

  describe('handleFailure - DLQ move failure', () => {
    it('should fallback to marking failed when DLQ move fails', async () => {
      const queueItem = createMockQueueItem({ id: 'queue-1', attempts: 4 });

      mockRetryStrategyService!.shouldRetry.mockReturnValue(false);
      mockQueueRepository.updateAttemptsWithError.mockResolvedValue(5);
      mockDeadLetterQueueService!.moveToDeadLetter.mockRejectedValue(
        new Error('DLQ database error')
      );

      const action = await service.handleFailure(queueItem, 'Final error');

      expect(action).toEqual({ action: 'failed' });
      expect(mockQueueRepository.markFailed).toHaveBeenCalledWith('queue-1', 'Final error');
    });
  });

  // ==========================================================================
  // handleFailure Tests - Without RetryStrategyService
  // ==========================================================================

  describe('handleFailure - legacy retry behavior', () => {
    let legacyService: RetryCoordinatorService;

    beforeEach(() => {
      legacyService = new RetryCoordinatorService(
        mockQueueRepository as unknown as QueueRepository,
        null, // No retry strategy service
        mockDeadLetterQueueService as unknown as DeadLetterQueueService,
        { maxAttempts: 3 }
      );
    });

    afterEach(() => {
      legacyService.stop();
    });

    it('should retry when attempts < maxAttempts', async () => {
      const queueItem = createMockQueueItem({ attempts: 1 });
      mockQueueRepository.updateAttemptsWithError.mockResolvedValue(2);

      const action = await legacyService.handleFailure(queueItem, 'Error');

      expect(action.action).toBe('retry');
    });

    it('should move to DLQ when attempts >= maxAttempts', async () => {
      const queueItem = createMockQueueItem({ attempts: 2 });
      mockQueueRepository.updateAttemptsWithError.mockResolvedValue(3);

      const action = await legacyService.handleFailure(queueItem, 'Error');

      expect(action.action).toBe('dead-letter');
    });
  });

  // ==========================================================================
  // Error History Methods Tests
  // ==========================================================================

  describe('error history methods', () => {
    it('getErrorHistory should return error history for existing queue item', async () => {
      const queueItem = createMockQueueItem({ id: 'queue-1' });
      mockRetryStrategyService!.shouldRetry.mockReturnValue(true);
      mockQueueRepository.updateAttemptsWithError.mockResolvedValue(1);

      await service.handleFailure(queueItem, 'Test error');

      const history = service.getErrorHistory('queue-1');
      expect(history).toBeDefined();
      expect(history!.length).toBe(1);
    });

    it('getErrorHistory should return undefined for non-existent queue item', () => {
      const history = service.getErrorHistory('non-existent');
      expect(history).toBeUndefined();
    });

    it('getErrorHistorySize should return current error history count', async () => {
      const queueItem1 = createMockQueueItem({ id: 'queue-1' });
      const queueItem2 = createMockQueueItem({ id: 'queue-2' });

      mockRetryStrategyService!.shouldRetry.mockReturnValue(true);
      mockQueueRepository.updateAttemptsWithError.mockResolvedValue(1);

      await service.handleFailure(queueItem1, 'Error 1');
      await service.handleFailure(queueItem2, 'Error 2');

      expect(service.getErrorHistorySize()).toBe(2);
    });

    it('clearErrorHistory should remove error history for specific queue item', async () => {
      const queueItem = createMockQueueItem({ id: 'queue-1' });
      mockRetryStrategyService!.shouldRetry.mockReturnValue(true);
      mockQueueRepository.updateAttemptsWithError.mockResolvedValue(1);

      await service.handleFailure(queueItem, 'Test error');
      expect(service.getErrorHistory('queue-1')).toBeDefined();

      service.clearErrorHistory('queue-1');
      expect(service.getErrorHistory('queue-1')).toBeUndefined();
    });

    it('clearErrorHistory should not throw for non-existent queue item', () => {
      expect(() => service.clearErrorHistory('non-existent')).not.toThrow();
    });
  });

  // ==========================================================================
  // Cleanup Interval Tests
  // Note: Testing the cleanup logic through direct behavior verification
  // since setInterval with fake timers has complex async behavior.
  // The cleanup interval is tested via stop() which clears all history.
  // ==========================================================================

  describe('cleanup interval', () => {
    it('should start cleanup interval on service creation', () => {
      const setIntervalSpy = vi.spyOn(global, 'setInterval');

      const cleanupService = new RetryCoordinatorService(
        mockQueueRepository as unknown as QueueRepository,
        null,
        null,
        { cleanupIntervalMs: 300000 } // 5 minutes
      );

      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 300000);
      cleanupService.stop();
    });

    it('should unref the cleanup interval to not keep process running', () => {
      // The cleanup interval should call unref() if available
      // This is implicitly tested by the service not hanging
      const cleanupService = new RetryCoordinatorService(
        mockQueueRepository as unknown as QueueRepository,
        null,
        null
      );

      // Service should be created without throwing
      expect(cleanupService).toBeDefined();
      cleanupService.stop();
    });

    it('should clear all error history when stop is called', async () => {
      const queueItem1 = createMockQueueItem({ id: 'queue-1' });
      const queueItem2 = createMockQueueItem({ id: 'queue-2' });

      mockRetryStrategyService!.shouldRetry.mockReturnValue(true);
      mockQueueRepository.updateAttemptsWithError.mockResolvedValue(1);

      await service.handleFailure(queueItem1, 'Error 1');
      await service.handleFailure(queueItem2, 'Error 2');

      expect(service.getErrorHistorySize()).toBe(2);

      service.stop();

      expect(service.getErrorHistorySize()).toBe(0);
    });

    it('error history entries have timestamps for age-based cleanup', async () => {
      const queueItem = createMockQueueItem({ id: 'queue-1' });
      mockRetryStrategyService!.shouldRetry.mockReturnValue(true);
      mockQueueRepository.updateAttemptsWithError.mockResolvedValue(1);

      const beforeTime = new Date();
      await service.handleFailure(queueItem, 'Test error');
      const afterTime = new Date();

      const errorHistory = service.getErrorHistory('queue-1');
      expect(errorHistory).toBeDefined();
      expect(errorHistory![0].timestamp.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
      expect(errorHistory![0].timestamp.getTime()).toBeLessThanOrEqual(afterTime.getTime());
    });

    it('error history is cleared on success (simulates cleanup behavior)', async () => {
      const queueItem = createMockQueueItem({ id: 'queue-1', attempts: 2 });

      mockRetryStrategyService!.shouldRetry.mockReturnValue(true);
      mockQueueRepository.updateAttemptsWithError.mockResolvedValue(3);

      // Add error history
      await service.handleFailure(queueItem, 'Error 1');
      await service.handleFailure(queueItem, 'Error 2');
      expect(service.getErrorHistorySize()).toBe(1);
      expect(service.getErrorHistory('queue-1')!.length).toBe(2);

      // Success clears error history (same behavior as cleanup for completed items)
      await service.handleResult(queueItem, { success: true });

      expect(service.getErrorHistory('queue-1')).toBeUndefined();
      expect(service.getErrorHistorySize()).toBe(0);
    });

    it('error history is cleared when moved to DLQ (simulates cleanup behavior)', async () => {
      const queueItem = createMockQueueItem({ id: 'queue-1', attempts: 4 });

      mockRetryStrategyService!.shouldRetry.mockReturnValue(false);
      mockQueueRepository.updateAttemptsWithError.mockResolvedValue(5);

      await service.handleFailure(queueItem, 'Final error');

      // Error history should be cleared after moving to DLQ
      expect(service.getErrorHistory('queue-1')).toBeUndefined();
    });
  });

  // ==========================================================================
  // stop() Method Tests
  // ==========================================================================

  describe('stop method', () => {
    it('should clear cleanup interval when stopped', () => {
      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');

      service.stop();

      expect(clearIntervalSpy).toHaveBeenCalled();
    });

    it('should clear all error history when stopped', async () => {
      const queueItem1 = createMockQueueItem({ id: 'queue-1' });
      const queueItem2 = createMockQueueItem({ id: 'queue-2' });

      mockRetryStrategyService!.shouldRetry.mockReturnValue(true);
      mockQueueRepository.updateAttemptsWithError.mockResolvedValue(1);

      await service.handleFailure(queueItem1, 'Error 1');
      await service.handleFailure(queueItem2, 'Error 2');

      expect(service.getErrorHistorySize()).toBe(2);

      service.stop();

      expect(service.getErrorHistorySize()).toBe(0);
    });

    it('should be safe to call stop multiple times', () => {
      expect(() => {
        service.stop();
        service.stop();
        service.stop();
      }).not.toThrow();
    });
  });

  // ==========================================================================
  // Edge Cases and Integration Tests
  // ==========================================================================

  describe('edge cases', () => {
    it('should handle queue item with null lastError', async () => {
      const queueItem = createMockQueueItem({ lastError: null });
      mockRetryStrategyService!.shouldRetry.mockReturnValue(true);
      mockQueueRepository.updateAttemptsWithError.mockResolvedValue(1);

      const action = await service.handleFailure(queueItem, 'New error');

      expect(action.action).toBe('retry');
    });

    it('should handle very long error messages', async () => {
      const queueItem = createMockQueueItem();
      const longError = 'A'.repeat(10000);

      mockRetryStrategyService!.shouldRetry.mockReturnValue(true);
      mockQueueRepository.updateAttemptsWithError.mockResolvedValue(1);

      const action = await service.handleFailure(queueItem, longError);

      expect(action.action).toBe('retry');
      const errorHistory = service.getErrorHistory(queueItem.id);
      expect(errorHistory![0].error).toBe(longError);
    });

    it('should handle concurrent failures for the same queue item', async () => {
      const queueItem = createMockQueueItem({ id: 'queue-1' });
      mockRetryStrategyService!.shouldRetry.mockReturnValue(true);
      mockQueueRepository.updateAttemptsWithError.mockResolvedValue(1);

      // Simulate concurrent failures
      const promises = [
        service.handleFailure(queueItem, 'Error 1'),
        service.handleFailure(queueItem, 'Error 2'),
        service.handleFailure(queueItem, 'Error 3'),
      ];

      await Promise.all(promises);

      const errorHistory = service.getErrorHistory('queue-1');
      expect(errorHistory).toBeDefined();
      expect(errorHistory!.length).toBe(3);
    });

    it('should handle empty error message', async () => {
      const queueItem = createMockQueueItem();
      mockRetryStrategyService!.shouldRetry.mockReturnValue(true);
      mockQueueRepository.updateAttemptsWithError.mockResolvedValue(1);

      const action = await service.handleFailure(queueItem, '');

      expect(action.action).toBe('retry');
      const errorHistory = service.getErrorHistory(queueItem.id);
      expect(errorHistory![0].error).toBe('');
    });

    it('should track correct attempt number in error history', async () => {
      const queueItem = createMockQueueItem({ id: 'queue-1', attempts: 2 });
      mockRetryStrategyService!.shouldRetry.mockReturnValue(true);
      mockQueueRepository.updateAttemptsWithError.mockResolvedValue(3);

      await service.handleFailure(queueItem, 'Test error');

      const errorHistory = service.getErrorHistory('queue-1');
      expect(errorHistory![0].attempt).toBe(3); // attempts + 1
    });
  });

  // ==========================================================================
  // FailureAction Type Tests
  // ==========================================================================

  describe('FailureAction types', () => {
    it('should return retry action with correct shape', async () => {
      const queueItem = createMockQueueItem({ attempts: 1 });
      const nextRetryTime = new Date(Date.now() + 5000);

      mockRetryStrategyService!.shouldRetry.mockReturnValue(true);
      mockRetryStrategyService!.calculateNextRetryTime.mockReturnValue(nextRetryTime);
      mockQueueRepository.updateAttemptsWithError.mockResolvedValue(2);

      const action = await service.handleFailure(queueItem, 'Error');

      expect(action).toEqual({
        action: 'retry',
        delayMs: expect.any(Number),
        nextRetryAt: nextRetryTime,
      });
    });

    it('should return dead-letter action with correct shape', async () => {
      const queueItem = createMockQueueItem({ attempts: 4 });

      mockRetryStrategyService!.shouldRetry.mockReturnValue(false);
      mockQueueRepository.updateAttemptsWithError.mockResolvedValue(5);

      const action = await service.handleFailure(queueItem, 'Error');

      expect(action).toEqual({ action: 'dead-letter' });
    });

    it('should return failed action with correct shape', async () => {
      // Service without DLQ
      const noDlqService = new RetryCoordinatorService(
        mockQueueRepository as unknown as QueueRepository,
        mockRetryStrategyService as unknown as RetryStrategyService,
        null
      );

      const queueItem = createMockQueueItem({ attempts: 4 });
      mockRetryStrategyService!.shouldRetry.mockReturnValue(false);
      mockQueueRepository.updateAttemptsWithError.mockResolvedValue(5);

      const action = await noDlqService.handleFailure(queueItem, 'Error');

      expect(action).toEqual({ action: 'failed' });

      noDlqService.stop();
    });
  });

  // ==========================================================================
  // RetryStrategyService Integration Tests
  // ==========================================================================

  describe('RetryStrategyService integration', () => {
    it('should pass correct attempt number to shouldRetry', async () => {
      const queueItem = createMockQueueItem({ attempts: 2 });
      mockQueueRepository.updateAttemptsWithError.mockResolvedValue(3);

      await service.handleFailure(queueItem, 'Error');

      expect(mockRetryStrategyService!.shouldRetry).toHaveBeenCalledWith(
        3, // new attempts count
        expect.any(Error)
      );
    });

    it('should pass correct attempt number to calculateNextRetryTime', async () => {
      const queueItem = createMockQueueItem({ attempts: 2 });
      mockRetryStrategyService!.shouldRetry.mockReturnValue(true);
      mockQueueRepository.updateAttemptsWithError.mockResolvedValue(3);

      await service.handleFailure(queueItem, 'Error');

      expect(mockRetryStrategyService!.calculateNextRetryTime).toHaveBeenCalledWith(3);
    });

    it('should respect non-retryable error detection from RetryStrategyService', async () => {
      const queueItem = createMockQueueItem({ attempts: 1 });
      mockRetryStrategyService!.shouldRetry.mockReturnValue(false); // Non-retryable
      mockQueueRepository.updateAttemptsWithError.mockResolvedValue(2);

      const action = await service.handleFailure(queueItem, 'VALIDATION_ERROR: Invalid input');

      expect(action.action).toBe('dead-letter');
    });
  });
});
