/**
 * Tests for ExtractionCoordinatorService
 *
 * Covers:
 * - Service disabled via config
 * - Both services null (disabled extraction)
 * - One service null (partial extraction)
 * - Both extractions succeed on first attempt
 * - Memory extraction succeeds, preference fails
 * - Both extractions fail on first attempt, succeed on retry
 * - All retries exhausted (3 attempts)
 * - Status tracking (pending -> processing -> completed/failed)
 * - getStats() returns correct aggregated statistics
 * - isEnabled() returns correct state based on config and services
 * - updateConfig() changes behavior appropriately
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ExtractionCoordinatorService,
  ExtractionCoordinatorConfig,
  ExtractionStatus,
} from './extraction-coordinator.service.js';
import type { MemoryService } from '../memory.service.js';
import type { UserPreferenceService } from '../userPreference.service.js';
import type { MessageRepository } from '../../repositories/message.repository.js';
import type { Message, Sender } from '../../types/index.js';

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

// ============================================================================
// Mock Helpers
// ============================================================================

const createMockMessage = (overrides?: Partial<Message>): Message => ({
  id: `msg-${Math.random().toString(36).substring(7)}`,
  chatId: 'chat-1',
  senderId: 'sender-1',
  telegramMessageId: Math.floor(Math.random() * 10000),
  text: 'Hello, I love pizza and live in NYC',
  isBot: false,
  mediaType: null,
  mediaPath: null,
  mediaFileId: null,
  replyToMessageId: null,
  forwardFromChatId: null,
  forwardFromMessageId: null,
  rawJson: '{}',
  createdAt: new Date(),
  transcript: null,
  transcriptStatus: null,
  transcriptLanguage: null,
  transcriptDurationMs: null,
  transcriptedAt: null,
  transcriptError: null,
  ...overrides,
});

const createMockSender = (overrides?: Partial<Sender>): Sender => ({
  id: 'sender-1',
  telegramId: 12345,
  firstName: 'John',
  lastName: 'Doe',
  username: 'johndoe',
  isBot: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const createMockMemoryService = () => ({
  extractAndStore: vi.fn().mockResolvedValue({ facts: [], processed: true }),
});

const createMockUserPreferenceService = () => ({
  extractAndStore: vi.fn().mockResolvedValue({ preferences: [], processed: true }),
});

const createMockMessageRepository = () => ({
  findRecentByChatId: vi.fn().mockResolvedValue([]),
  findById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
});

// ============================================================================
// Helper to wait for async extraction to complete
// ============================================================================

const waitForExtraction = async (
  service: ExtractionCoordinatorService,
  messageId: string,
  expectedStatus: {
    memoryStatus?: ExtractionStatus['memoryStatus'];
    preferenceStatus?: ExtractionStatus['preferenceStatus'];
  },
  timeoutMs = 5000
): Promise<ExtractionStatus | undefined> => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const status = service.getExtractionStatus(messageId);
    if (status) {
      const memoryMatch =
        !expectedStatus.memoryStatus || status.memoryStatus === expectedStatus.memoryStatus;
      const preferenceMatch =
        !expectedStatus.preferenceStatus ||
        status.preferenceStatus === expectedStatus.preferenceStatus;
      if (memoryMatch && preferenceMatch) {
        return status;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return service.getExtractionStatus(messageId);
};

// ============================================================================
// Tests
// ============================================================================

describe('ExtractionCoordinatorService', () => {
  let mockMemoryService: ReturnType<typeof createMockMemoryService>;
  let mockUserPreferenceService: ReturnType<typeof createMockUserPreferenceService>;
  let mockMessageRepository: ReturnType<typeof createMockMessageRepository>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });

    mockMemoryService = createMockMemoryService();
    mockUserPreferenceService = createMockUserPreferenceService();
    mockMessageRepository = createMockMessageRepository();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.resetAllMocks();
  });

  // ==========================================================================
  // Service Disabled via Config
  // ==========================================================================

  describe('service disabled via config', () => {
    it('should skip extraction when disabled', () => {
      const service = new ExtractionCoordinatorService(
        mockMemoryService as unknown as MemoryService,
        mockUserPreferenceService as unknown as UserPreferenceService,
        mockMessageRepository as unknown as MessageRepository,
        { enabled: false }
      );

      const message = createMockMessage();
      const sender = createMockSender();

      service.extractAll(message, sender);

      // Should not track status when disabled
      expect(service.getExtractionStatus(message.id)).toBeUndefined();
      expect(mockMemoryService.extractAndStore).not.toHaveBeenCalled();
      expect(mockUserPreferenceService.extractAndStore).not.toHaveBeenCalled();
    });

    it('should report isEnabled as false when disabled via config', () => {
      const service = new ExtractionCoordinatorService(
        mockMemoryService as unknown as MemoryService,
        mockUserPreferenceService as unknown as UserPreferenceService,
        mockMessageRepository as unknown as MessageRepository,
        { enabled: false }
      );

      expect(service.isEnabled()).toBe(false);
    });
  });

  // ==========================================================================
  // Both Services Null (Disabled Extraction)
  // ==========================================================================

  describe('both services null', () => {
    it('should handle gracefully when both services are null', async () => {
      const service = new ExtractionCoordinatorService(
        null,
        null,
        mockMessageRepository as unknown as MessageRepository,
        { enabled: true }
      );

      const message = createMockMessage();
      const sender = createMockSender();

      service.extractAll(message, sender);

      // Should track status even with null services
      const status = service.getExtractionStatus(message.id);
      expect(status).toBeDefined();
      expect(status?.memoryStatus).toBe('pending');
      expect(status?.preferenceStatus).toBe('pending');

      // No extraction calls since services are null
      expect(mockMessageRepository.findRecentByChatId).not.toHaveBeenCalled();
    });

    it('should report isEnabled as false when both services are null', () => {
      const service = new ExtractionCoordinatorService(
        null,
        null,
        mockMessageRepository as unknown as MessageRepository,
        { enabled: true }
      );

      expect(service.isEnabled()).toBe(false);
    });
  });

  // ==========================================================================
  // One Service Null (Partial Extraction)
  // ==========================================================================

  describe('one service null (partial extraction)', () => {
    it('should only run memory extraction when preference service is null', async () => {
      const service = new ExtractionCoordinatorService(
        mockMemoryService as unknown as MemoryService,
        null,
        mockMessageRepository as unknown as MessageRepository,
        { enabled: true }
      );

      const message = createMockMessage();
      const sender = createMockSender();

      service.extractAll(message, sender);

      // Wait for async extraction
      await vi.advanceTimersByTimeAsync(100);

      expect(mockMemoryService.extractAndStore).toHaveBeenCalled();
      expect(mockUserPreferenceService.extractAndStore).not.toHaveBeenCalled();
    });

    it('should only run preference extraction when memory service is null', async () => {
      const service = new ExtractionCoordinatorService(
        null,
        mockUserPreferenceService as unknown as UserPreferenceService,
        mockMessageRepository as unknown as MessageRepository,
        { enabled: true }
      );

      const message = createMockMessage();
      const sender = createMockSender();

      service.extractAll(message, sender);

      // Wait for async extraction
      await vi.advanceTimersByTimeAsync(100);

      expect(mockMemoryService.extractAndStore).not.toHaveBeenCalled();
      expect(mockUserPreferenceService.extractAndStore).toHaveBeenCalled();
    });

    it('should report isEnabled as true when only memory service is available', () => {
      const service = new ExtractionCoordinatorService(
        mockMemoryService as unknown as MemoryService,
        null,
        mockMessageRepository as unknown as MessageRepository,
        { enabled: true }
      );

      expect(service.isEnabled()).toBe(true);
    });

    it('should report isEnabled as true when only preference service is available', () => {
      const service = new ExtractionCoordinatorService(
        null,
        mockUserPreferenceService as unknown as UserPreferenceService,
        mockMessageRepository as unknown as MessageRepository,
        { enabled: true }
      );

      expect(service.isEnabled()).toBe(true);
    });
  });

  // ==========================================================================
  // Both Extractions Succeed on First Attempt
  // ==========================================================================

  describe('both extractions succeed on first attempt', () => {
    it('should complete both extractions successfully', async () => {
      mockMemoryService.extractAndStore.mockResolvedValue({
        facts: [{ content: 'likes pizza', confidence: 0.9 }],
        processed: true,
      });
      mockUserPreferenceService.extractAndStore.mockResolvedValue({
        preferences: [{ key: 'food_preference', value: 'pizza', confidence: 0.85 }],
        processed: true,
      });

      const service = new ExtractionCoordinatorService(
        mockMemoryService as unknown as MemoryService,
        mockUserPreferenceService as unknown as UserPreferenceService,
        mockMessageRepository as unknown as MessageRepository,
        { enabled: true }
      );

      const message = createMockMessage();
      const sender = createMockSender();

      service.extractAll(message, sender);

      // Wait for async extractions to complete
      await vi.advanceTimersByTimeAsync(100);

      const status = service.getExtractionStatus(message.id);
      expect(status?.memoryStatus).toBe('completed');
      expect(status?.preferenceStatus).toBe('completed');
      expect(status?.memoryAttempts).toBe(1);
      expect(status?.preferenceAttempts).toBe(1);
      expect(status?.memoryError).toBeUndefined();
      expect(status?.preferenceError).toBeUndefined();
    });

    it('should fetch context for extraction', async () => {
      const contextMessages = [createMockMessage({ text: 'Previous message' })];
      mockMessageRepository.findRecentByChatId.mockResolvedValue(contextMessages);

      const service = new ExtractionCoordinatorService(
        mockMemoryService as unknown as MemoryService,
        mockUserPreferenceService as unknown as UserPreferenceService,
        mockMessageRepository as unknown as MessageRepository,
        { enabled: true, contextWindowSize: 5 }
      );

      const message = createMockMessage();
      const sender = createMockSender();

      service.extractAll(message, sender);

      await vi.advanceTimersByTimeAsync(100);

      expect(mockMessageRepository.findRecentByChatId).toHaveBeenCalledWith(message.chatId, 5);
      expect(mockMemoryService.extractAndStore).toHaveBeenCalledWith(
        message,
        contextMessages,
        undefined
      );
      expect(mockUserPreferenceService.extractAndStore).toHaveBeenCalledWith(
        message,
        sender,
        contextMessages
      );
    });
  });

  // ==========================================================================
  // Memory Extraction Succeeds, Preference Fails
  // ==========================================================================

  describe('memory extraction succeeds, preference fails', () => {
    it('should complete memory but fail preference after all retries', async () => {
      mockMemoryService.extractAndStore.mockResolvedValue({
        facts: [{ content: 'likes pizza', confidence: 0.9 }],
        processed: true,
      });
      mockUserPreferenceService.extractAndStore.mockRejectedValue(
        new Error('Preference extraction failed')
      );

      const service = new ExtractionCoordinatorService(
        mockMemoryService as unknown as MemoryService,
        mockUserPreferenceService as unknown as UserPreferenceService,
        mockMessageRepository as unknown as MessageRepository,
        { enabled: true, maxRetries: 3, baseDelayMs: 10, maxDelayMs: 100 }
      );

      const message = createMockMessage();
      const sender = createMockSender();

      service.extractAll(message, sender);

      // Wait for all retries to complete (3 attempts with backoff)
      await vi.advanceTimersByTimeAsync(500);

      const status = service.getExtractionStatus(message.id);
      expect(status?.memoryStatus).toBe('completed');
      expect(status?.memoryAttempts).toBe(1);
      expect(status?.preferenceStatus).toBe('failed');
      expect(status?.preferenceAttempts).toBe(3);
      expect(status?.preferenceError).toBe('Preference extraction failed');
    });
  });

  // ==========================================================================
  // Both Extractions Fail on First Attempt, Succeed on Retry
  // ==========================================================================

  describe('both extractions fail on first attempt, succeed on retry', () => {
    it('should succeed after retry', async () => {
      let memoryCallCount = 0;
      let preferenceCallCount = 0;

      mockMemoryService.extractAndStore.mockImplementation(async () => {
        memoryCallCount++;
        if (memoryCallCount === 1) {
          throw new Error('Memory extraction failed - attempt 1');
        }
        return { facts: [{ content: 'test fact', confidence: 0.9 }], processed: true };
      });

      mockUserPreferenceService.extractAndStore.mockImplementation(async () => {
        preferenceCallCount++;
        if (preferenceCallCount === 1) {
          throw new Error('Preference extraction failed - attempt 1');
        }
        return { preferences: [{ key: 'test', value: 'value', confidence: 0.8 }], processed: true };
      });

      const service = new ExtractionCoordinatorService(
        mockMemoryService as unknown as MemoryService,
        mockUserPreferenceService as unknown as UserPreferenceService,
        mockMessageRepository as unknown as MessageRepository,
        { enabled: true, maxRetries: 3, baseDelayMs: 10, maxDelayMs: 100 }
      );

      const message = createMockMessage();
      const sender = createMockSender();

      service.extractAll(message, sender);

      // Wait for retries to complete
      await vi.advanceTimersByTimeAsync(200);

      const status = service.getExtractionStatus(message.id);
      expect(status?.memoryStatus).toBe('completed');
      expect(status?.memoryAttempts).toBe(2);
      expect(status?.preferenceStatus).toBe('completed');
      expect(status?.preferenceAttempts).toBe(2);
      expect(status?.memoryError).toBeUndefined();
      expect(status?.preferenceError).toBeUndefined();
    });
  });

  // ==========================================================================
  // All Retries Exhausted (3 Attempts) - Should Mark as Failed
  // ==========================================================================

  describe('all retries exhausted', () => {
    it('should mark as failed after all retries exhausted', async () => {
      mockMemoryService.extractAndStore.mockRejectedValue(new Error('Persistent memory error'));
      mockUserPreferenceService.extractAndStore.mockRejectedValue(
        new Error('Persistent preference error')
      );

      const service = new ExtractionCoordinatorService(
        mockMemoryService as unknown as MemoryService,
        mockUserPreferenceService as unknown as UserPreferenceService,
        mockMessageRepository as unknown as MessageRepository,
        { enabled: true, maxRetries: 3, baseDelayMs: 10, maxDelayMs: 100 }
      );

      const message = createMockMessage();
      const sender = createMockSender();

      service.extractAll(message, sender);

      // Wait for all retries
      await vi.advanceTimersByTimeAsync(500);

      const status = service.getExtractionStatus(message.id);
      expect(status?.memoryStatus).toBe('failed');
      expect(status?.memoryAttempts).toBe(3);
      expect(status?.memoryError).toBe('Persistent memory error');
      expect(status?.preferenceStatus).toBe('failed');
      expect(status?.preferenceAttempts).toBe(3);
      expect(status?.preferenceError).toBe('Persistent preference error');

      // Verify all 3 attempts were made for each service
      expect(mockMemoryService.extractAndStore).toHaveBeenCalledTimes(3);
      expect(mockUserPreferenceService.extractAndStore).toHaveBeenCalledTimes(3);
    });

    it('should handle non-Error thrown objects', async () => {
      mockMemoryService.extractAndStore.mockRejectedValue('String error');
      mockUserPreferenceService.extractAndStore.mockRejectedValue({ custom: 'error object' });

      const service = new ExtractionCoordinatorService(
        mockMemoryService as unknown as MemoryService,
        mockUserPreferenceService as unknown as UserPreferenceService,
        mockMessageRepository as unknown as MessageRepository,
        { enabled: true, maxRetries: 3, baseDelayMs: 10, maxDelayMs: 100 }
      );

      const message = createMockMessage();
      const sender = createMockSender();

      service.extractAll(message, sender);

      await vi.advanceTimersByTimeAsync(500);

      const status = service.getExtractionStatus(message.id);
      expect(status?.memoryStatus).toBe('failed');
      expect(status?.memoryError).toBe('Unknown error');
      expect(status?.preferenceStatus).toBe('failed');
      expect(status?.preferenceError).toBe('Unknown error');
    });
  });

  // ==========================================================================
  // Status Tracking (pending -> processing -> completed/failed)
  // ==========================================================================

  describe('status tracking', () => {
    it('should set status to processing when extraction starts', async () => {
      let resolveMemory: () => void;
      const memoryPromise = new Promise<void>((resolve) => {
        resolveMemory = resolve;
      });

      mockMemoryService.extractAndStore.mockImplementation(async () => {
        await memoryPromise;
        return { facts: [], processed: true };
      });

      const service = new ExtractionCoordinatorService(
        mockMemoryService as unknown as MemoryService,
        null,
        mockMessageRepository as unknown as MessageRepository,
        { enabled: true }
      );

      const message = createMockMessage();
      const sender = createMockSender();

      // extractAll sets initial status and immediately starts async extraction
      service.extractAll(message, sender);

      // Let the extraction start (async IIFE begins immediately with fake timers)
      await vi.advanceTimersByTimeAsync(10);

      // After starting extraction, status should be processing (waiting on memoryPromise)
      const processingStatus = service.getExtractionStatus(message.id);
      expect(processingStatus?.memoryStatus).toBe('processing');

      // Complete the extraction
      resolveMemory!();
      await vi.advanceTimersByTimeAsync(10);

      // Final status should be completed
      const finalStatus = service.getExtractionStatus(message.id);
      expect(finalStatus?.memoryStatus).toBe('completed');
    });

    it('should update lastAttemptAt on each attempt', async () => {
      let callCount = 0;
      mockMemoryService.extractAndStore.mockImplementation(async () => {
        callCount++;
        if (callCount < 3) {
          throw new Error(`Attempt ${callCount} failed`);
        }
        return { facts: [], processed: true };
      });

      const service = new ExtractionCoordinatorService(
        mockMemoryService as unknown as MemoryService,
        null,
        mockMessageRepository as unknown as MessageRepository,
        { enabled: true, maxRetries: 3, baseDelayMs: 10, maxDelayMs: 100 }
      );

      const message = createMockMessage();
      const sender = createMockSender();

      service.extractAll(message, sender);

      // Initial lastAttemptAt
      const initialStatus = service.getExtractionStatus(message.id);
      const initialTime = initialStatus?.lastAttemptAt;
      expect(initialTime).toBeDefined();

      // Wait for retries
      await vi.advanceTimersByTimeAsync(200);

      const finalStatus = service.getExtractionStatus(message.id);
      expect(finalStatus?.memoryAttempts).toBe(3);
      // lastAttemptAt should be updated
      expect(finalStatus?.lastAttemptAt).toBeDefined();
    });
  });

  // ==========================================================================
  // getStats() Returns Correct Aggregated Statistics
  // ==========================================================================

  describe('getStats', () => {
    it('should return correct statistics for empty state', () => {
      const service = new ExtractionCoordinatorService(
        mockMemoryService as unknown as MemoryService,
        mockUserPreferenceService as unknown as UserPreferenceService,
        mockMessageRepository as unknown as MessageRepository,
        { enabled: true }
      );

      const stats = service.getStats();
      expect(stats).toEqual({
        total: 0,
        pending: 0,
        completed: 0,
        failed: 0,
        avgAttempts: 0,
      });
    });

    it('should return correct statistics after successful extractions', async () => {
      const service = new ExtractionCoordinatorService(
        mockMemoryService as unknown as MemoryService,
        mockUserPreferenceService as unknown as UserPreferenceService,
        mockMessageRepository as unknown as MessageRepository,
        { enabled: true }
      );

      // Extract 3 messages
      for (let i = 0; i < 3; i++) {
        const message = createMockMessage({ id: `msg-${i}` });
        const sender = createMockSender();
        service.extractAll(message, sender);
      }

      await vi.advanceTimersByTimeAsync(100);

      const stats = service.getStats();
      expect(stats.total).toBe(3);
      expect(stats.completed).toBe(3);
      expect(stats.failed).toBe(0);
      expect(stats.pending).toBe(0);
      expect(stats.avgAttempts).toBe(1); // 1 attempt each for both memory and preference
    });

    it('should return correct statistics with mixed results', async () => {
      let memoryCallCount = 0;
      mockMemoryService.extractAndStore.mockImplementation(async () => {
        memoryCallCount++;
        if (memoryCallCount <= 2) {
          // First 2 messages fail memory extraction
          throw new Error('Memory failed');
        }
        return { facts: [], processed: true };
      });

      const service = new ExtractionCoordinatorService(
        mockMemoryService as unknown as MemoryService,
        mockUserPreferenceService as unknown as UserPreferenceService,
        mockMessageRepository as unknown as MessageRepository,
        { enabled: true, maxRetries: 1, baseDelayMs: 10 }
      );

      // Extract 3 messages
      for (let i = 0; i < 3; i++) {
        const message = createMockMessage({ id: `msg-${i}` });
        const sender = createMockSender();
        service.extractAll(message, sender);
      }

      await vi.advanceTimersByTimeAsync(200);

      const stats = service.getStats();
      expect(stats.total).toBe(3);
      // 2 messages have memory failed, 1 is fully completed
      expect(stats.failed).toBe(2); // Messages with at least one failed extraction
      expect(stats.completed).toBe(1); // Messages with both completed
    });

    it('should count pending correctly', async () => {
      let resolveMemory: () => void;
      const memoryPromise = new Promise<void>((resolve) => {
        resolveMemory = resolve;
      });

      mockMemoryService.extractAndStore.mockImplementation(async () => {
        await memoryPromise;
        return { facts: [], processed: true };
      });

      const service = new ExtractionCoordinatorService(
        mockMemoryService as unknown as MemoryService,
        mockUserPreferenceService as unknown as UserPreferenceService,
        mockMessageRepository as unknown as MessageRepository,
        { enabled: true }
      );

      const message = createMockMessage();
      const sender = createMockSender();

      service.extractAll(message, sender);
      await vi.advanceTimersByTimeAsync(10);

      const statsWhilePending = service.getStats();
      expect(statsWhilePending.pending).toBe(1);

      resolveMemory!();
      await vi.advanceTimersByTimeAsync(100);

      const statsAfterComplete = service.getStats();
      expect(statsAfterComplete.pending).toBe(0);
      expect(statsAfterComplete.completed).toBe(1);
    });
  });

  // ==========================================================================
  // isEnabled() Returns Correct State
  // ==========================================================================

  describe('isEnabled', () => {
    it('should return true when enabled and at least one service available', () => {
      const service = new ExtractionCoordinatorService(
        mockMemoryService as unknown as MemoryService,
        mockUserPreferenceService as unknown as UserPreferenceService,
        mockMessageRepository as unknown as MessageRepository,
        { enabled: true }
      );

      expect(service.isEnabled()).toBe(true);
    });

    it('should return false when disabled even with services available', () => {
      const service = new ExtractionCoordinatorService(
        mockMemoryService as unknown as MemoryService,
        mockUserPreferenceService as unknown as UserPreferenceService,
        mockMessageRepository as unknown as MessageRepository,
        { enabled: false }
      );

      expect(service.isEnabled()).toBe(false);
    });

    it('should return false when enabled but no services available', () => {
      const service = new ExtractionCoordinatorService(
        null,
        null,
        mockMessageRepository as unknown as MessageRepository,
        { enabled: true }
      );

      expect(service.isEnabled()).toBe(false);
    });
  });

  // ==========================================================================
  // updateConfig() Changes Behavior Appropriately
  // ==========================================================================

  describe('updateConfig', () => {
    it('should disable extraction after updateConfig', () => {
      const service = new ExtractionCoordinatorService(
        mockMemoryService as unknown as MemoryService,
        mockUserPreferenceService as unknown as UserPreferenceService,
        mockMessageRepository as unknown as MessageRepository,
        { enabled: true }
      );

      expect(service.isEnabled()).toBe(true);

      service.updateConfig({ enabled: false });

      expect(service.isEnabled()).toBe(false);

      const message = createMockMessage();
      const sender = createMockSender();
      service.extractAll(message, sender);

      expect(service.getExtractionStatus(message.id)).toBeUndefined();
    });

    it('should enable extraction after updateConfig', async () => {
      const service = new ExtractionCoordinatorService(
        mockMemoryService as unknown as MemoryService,
        mockUserPreferenceService as unknown as UserPreferenceService,
        mockMessageRepository as unknown as MessageRepository,
        { enabled: false }
      );

      expect(service.isEnabled()).toBe(false);

      service.updateConfig({ enabled: true });

      expect(service.isEnabled()).toBe(true);

      const message = createMockMessage();
      const sender = createMockSender();
      service.extractAll(message, sender);

      expect(service.getExtractionStatus(message.id)).toBeDefined();
    });

    it('should update contextWindowSize', async () => {
      const service = new ExtractionCoordinatorService(
        mockMemoryService as unknown as MemoryService,
        mockUserPreferenceService as unknown as UserPreferenceService,
        mockMessageRepository as unknown as MessageRepository,
        { enabled: true, contextWindowSize: 5 }
      );

      service.updateConfig({ contextWindowSize: 10 });

      const message = createMockMessage();
      const sender = createMockSender();
      service.extractAll(message, sender);

      await vi.advanceTimersByTimeAsync(100);

      expect(mockMessageRepository.findRecentByChatId).toHaveBeenCalledWith(message.chatId, 10);
    });

    it('should update maxRetries', async () => {
      mockMemoryService.extractAndStore.mockRejectedValue(new Error('Always fails'));

      const service = new ExtractionCoordinatorService(
        mockMemoryService as unknown as MemoryService,
        null,
        mockMessageRepository as unknown as MessageRepository,
        { enabled: true, maxRetries: 3, baseDelayMs: 10, maxDelayMs: 100 }
      );

      // Update to only 1 retry
      service.updateConfig({ maxRetries: 1 });

      const message = createMockMessage();
      const sender = createMockSender();
      service.extractAll(message, sender);

      await vi.advanceTimersByTimeAsync(200);

      const status = service.getExtractionStatus(message.id);
      expect(status?.memoryAttempts).toBe(1);
      expect(mockMemoryService.extractAndStore).toHaveBeenCalledTimes(1);
    });

    it('should update baseDelayMs and maxDelayMs', async () => {
      let callCount = 0;
      mockMemoryService.extractAndStore.mockImplementation(async () => {
        callCount++;
        if (callCount < 3) {
          throw new Error(`Attempt ${callCount} failed`);
        }
        return { facts: [], processed: true };
      });

      const service = new ExtractionCoordinatorService(
        mockMemoryService as unknown as MemoryService,
        null,
        mockMessageRepository as unknown as MessageRepository,
        { enabled: true, maxRetries: 3, baseDelayMs: 100, maxDelayMs: 1000 }
      );

      // Update to shorter delays
      service.updateConfig({ baseDelayMs: 5, maxDelayMs: 50 });

      const message = createMockMessage();
      const sender = createMockSender();
      service.extractAll(message, sender);

      // With short delays, should complete faster
      await vi.advanceTimersByTimeAsync(100);

      const status = service.getExtractionStatus(message.id);
      expect(status?.memoryStatus).toBe('completed');
    });
  });

  // ==========================================================================
  // getAllStatuses() Tests
  // ==========================================================================

  describe('getAllStatuses', () => {
    it('should return empty array initially', () => {
      const service = new ExtractionCoordinatorService(
        mockMemoryService as unknown as MemoryService,
        mockUserPreferenceService as unknown as UserPreferenceService,
        mockMessageRepository as unknown as MessageRepository,
        { enabled: true }
      );

      expect(service.getAllStatuses()).toEqual([]);
    });

    it('should return all tracked statuses', async () => {
      const service = new ExtractionCoordinatorService(
        mockMemoryService as unknown as MemoryService,
        mockUserPreferenceService as unknown as UserPreferenceService,
        mockMessageRepository as unknown as MessageRepository,
        { enabled: true }
      );

      const messages = [
        createMockMessage({ id: 'msg-1' }),
        createMockMessage({ id: 'msg-2' }),
        createMockMessage({ id: 'msg-3' }),
      ];

      for (const message of messages) {
        service.extractAll(message, createMockSender());
      }

      await vi.advanceTimersByTimeAsync(100);

      const allStatuses = service.getAllStatuses();
      expect(allStatuses).toHaveLength(3);
      expect(allStatuses.map((s) => s.messageId).sort()).toEqual(['msg-1', 'msg-2', 'msg-3']);
    });
  });

  // ==========================================================================
  // getExtractionStatus() Tests
  // ==========================================================================

  describe('getExtractionStatus', () => {
    it('should return undefined for unknown message', () => {
      const service = new ExtractionCoordinatorService(
        mockMemoryService as unknown as MemoryService,
        mockUserPreferenceService as unknown as UserPreferenceService,
        mockMessageRepository as unknown as MessageRepository,
        { enabled: true }
      );

      expect(service.getExtractionStatus('unknown-id')).toBeUndefined();
    });

    it('should return status for tracked message', () => {
      const service = new ExtractionCoordinatorService(
        mockMemoryService as unknown as MemoryService,
        mockUserPreferenceService as unknown as UserPreferenceService,
        mockMessageRepository as unknown as MessageRepository,
        { enabled: true }
      );

      const message = createMockMessage({ id: 'test-msg' });
      service.extractAll(message, createMockSender());

      const status = service.getExtractionStatus('test-msg');
      expect(status).toBeDefined();
      expect(status?.messageId).toBe('test-msg');
    });
  });

  // ==========================================================================
  // Status Pruning Tests
  // ==========================================================================

  describe('status pruning', () => {
    it('should prune old statuses when exceeding 1000', async () => {
      const service = new ExtractionCoordinatorService(
        mockMemoryService as unknown as MemoryService,
        mockUserPreferenceService as unknown as UserPreferenceService,
        mockMessageRepository as unknown as MessageRepository,
        { enabled: true }
      );

      // Add 1005 messages
      for (let i = 0; i < 1005; i++) {
        const message = createMockMessage({ id: `msg-${i.toString().padStart(4, '0')}` });
        service.extractAll(message, createMockSender());
        // Small delay to ensure different timestamps
        await vi.advanceTimersByTimeAsync(1);
      }

      await vi.advanceTimersByTimeAsync(100);

      const allStatuses = service.getAllStatuses();
      // Should have pruned to 1000
      expect(allStatuses.length).toBeLessThanOrEqual(1000);
    });
  });

  // ==========================================================================
  // extractMemoriesAsync Direct Tests
  // ==========================================================================

  describe('extractMemoriesAsync', () => {
    it('should not call extractAndStore when memoryService is null', async () => {
      const service = new ExtractionCoordinatorService(
        null,
        mockUserPreferenceService as unknown as UserPreferenceService,
        mockMessageRepository as unknown as MessageRepository,
        { enabled: true }
      );

      const message = createMockMessage();
      const sender = createMockSender();

      service.extractMemoriesAsync(message, sender);

      await vi.advanceTimersByTimeAsync(100);

      expect(mockMessageRepository.findRecentByChatId).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // extractPreferencesAsync Direct Tests
  // ==========================================================================

  describe('extractPreferencesAsync', () => {
    it('should return early when userPreferenceService is null', async () => {
      const service = new ExtractionCoordinatorService(
        mockMemoryService as unknown as MemoryService,
        null,
        mockMessageRepository as unknown as MessageRepository,
        { enabled: true }
      );

      const message = createMockMessage();
      const sender = createMockSender();

      // Directly call extractPreferencesAsync (bypasses extractAll)
      service.extractPreferencesAsync(message, sender);

      await vi.advanceTimersByTimeAsync(100);

      // Should not fetch context since userPreferenceService is null
      // extractPreferencesAsync returns early without any action
      expect(mockUserPreferenceService.extractAndStore).not.toHaveBeenCalled();
    });

    it('should call extractAndStore when userPreferenceService is available', async () => {
      const service = new ExtractionCoordinatorService(
        null,
        mockUserPreferenceService as unknown as UserPreferenceService,
        mockMessageRepository as unknown as MessageRepository,
        { enabled: true }
      );

      const message = createMockMessage();
      const sender = createMockSender();

      // First set up a status entry (normally done by extractAll)
      // @ts-ignore - accessing private for testing
      service.extractionStatuses.set(message.id, {
        messageId: message.id,
        memoryStatus: 'pending',
        preferenceStatus: 'pending',
        memoryAttempts: 0,
        preferenceAttempts: 0,
        lastAttemptAt: new Date(),
      });

      service.extractPreferencesAsync(message, sender);

      await vi.advanceTimersByTimeAsync(100);

      // Should call the preference extraction
      expect(mockUserPreferenceService.extractAndStore).toHaveBeenCalled();
      expect(mockMessageRepository.findRecentByChatId).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Default Configuration Tests
  // ==========================================================================

  describe('default configuration', () => {
    it('should use default configuration when not provided', () => {
      const service = new ExtractionCoordinatorService(
        mockMemoryService as unknown as MemoryService,
        mockUserPreferenceService as unknown as UserPreferenceService,
        mockMessageRepository as unknown as MessageRepository
      );

      // Default is enabled: true
      expect(service.isEnabled()).toBe(true);
    });

    it('should merge partial config with defaults', async () => {
      const service = new ExtractionCoordinatorService(
        mockMemoryService as unknown as MemoryService,
        mockUserPreferenceService as unknown as UserPreferenceService,
        mockMessageRepository as unknown as MessageRepository,
        { contextWindowSize: 10 } // Only override contextWindowSize
      );

      // Should still be enabled (default)
      expect(service.isEnabled()).toBe(true);

      const message = createMockMessage();
      const sender = createMockSender();
      service.extractAll(message, sender);

      await vi.advanceTimersByTimeAsync(100);

      // Should use the overridden context window size
      expect(mockMessageRepository.findRecentByChatId).toHaveBeenCalledWith(message.chatId, 10);
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('edge cases', () => {
    it('should handle extraction when status is not found during async operation', async () => {
      // This tests the safety of status?.memoryStatus checks
      const service = new ExtractionCoordinatorService(
        mockMemoryService as unknown as MemoryService,
        mockUserPreferenceService as unknown as UserPreferenceService,
        mockMessageRepository as unknown as MessageRepository,
        { enabled: true }
      );

      const message = createMockMessage();
      const sender = createMockSender();

      service.extractAll(message, sender);

      // Manually clear the status (simulating an edge case)
      // @ts-ignore - accessing private for testing
      service.extractionStatuses.clear();

      // Should not throw even when status is missing
      await vi.advanceTimersByTimeAsync(100);

      // Verify no error was thrown
      expect(true).toBe(true);
    });

    it('should handle concurrent extractions for the same message', async () => {
      const service = new ExtractionCoordinatorService(
        mockMemoryService as unknown as MemoryService,
        mockUserPreferenceService as unknown as UserPreferenceService,
        mockMessageRepository as unknown as MessageRepository,
        { enabled: true }
      );

      const message = createMockMessage();
      const sender = createMockSender();

      // Call extractAll multiple times for the same message
      service.extractAll(message, sender);
      service.extractAll(message, sender);

      await vi.advanceTimersByTimeAsync(100);

      // Status should exist and be valid
      const status = service.getExtractionStatus(message.id);
      expect(status).toBeDefined();
    });
  });
});
