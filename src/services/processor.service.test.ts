/**
 * ProcessorService Tests
 *
 * Comprehensive tests for the thin orchestrator that coordinates message processing.
 *
 * Run: npm test src/services/processor.service.test.ts
 * or: npx vitest src/services/processor.service.test.ts
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ProcessorService } from './processor.service.js';
import type { Message, Chat, Sender, QueueItem, ProcessingResult } from '../types/index.js';
import { QueueRepository } from '../repositories/queue.repository.js';
import { MessageRepository } from '../repositories/message.repository.js';
import { LLMService } from './llm.service.js';
import { ResponseRouterService } from './responseRouter.service.js';
import { TelegramService } from './telegram.service.js';
import { MessageLengthService } from './messageLength.service.js';
import { MetricsService } from './metrics.service.js';
import {
  ExtractionCoordinatorService,
  RetryCoordinatorService,
  TranscriptionCoordinatorService,
} from './processing/index.js';

// Mock all dependencies
vi.mock('../repositories/queue.repository.js');
vi.mock('../repositories/message.repository.js');
vi.mock('./llm.service.js');
vi.mock('./responseRouter.service.js');
vi.mock('./telegram.service.js');
vi.mock('./messageLength.service.js');
vi.mock('./metrics.service.js');
vi.mock('./processing/index.js');
vi.mock('./languagePreference.service.js', () => ({
  languagePreferenceService: {
    detectLanguageSwitch: vi.fn(() => null),
    autoDetectLanguage: vi.fn(() => 'unknown'),
  },
}));
vi.mock('../repositories/chat.repository.js', () => ({
  chatRepository: {
    updatePreferredLanguage: vi.fn(),
  },
}));
vi.mock('../config/feature-flags.js', () => ({
  featureFlags: { isEnabled: vi.fn(() => false) },
  FeatureFlagNames: { THERAPIST_ENABLED: 'therapist.enabled' },
}));

// Mock logger to avoid noise in test output
vi.mock('../utils/logger.js', () => ({
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

// Mock config
vi.mock('../config/index.js', () => ({
  appConfig: {
    memory: {
      enabled: true,
    },
    response: {
      enabled: true,
      contextWindowSize: 10,
      readReceipts: true,
      typingIndicator: true,
    },
    llm: {
      skipOnUnhealthy: false,
    },
  },
}));

// Mock nanoid
vi.mock('nanoid', () => ({
  nanoid: vi.fn(() => 'test-id-123'),
}));

describe('ProcessorService', () => {
  let service: ProcessorService;
  let mockQueueRepository: QueueRepository;
  let mockMessageRepository: MessageRepository;
  let mockLLMService: LLMService;
  let mockResponseRouter: ResponseRouterService;
  let mockTelegramService: TelegramService;
  let mockMessageLengthService: MessageLengthService;
  let mockMetricsService: MetricsService;
  let mockExtractionCoordinator: ExtractionCoordinatorService;
  let mockRetryCoordinator: RetryCoordinatorService;
  let mockTranscriptionCoordinator: TranscriptionCoordinatorService;

  // Test fixtures
  const createMockMessage = (overrides: Partial<Message> = {}): Message => ({
    id: 'msg-1',
    telegramMessageId: 12345,
    chatId: 'chat-1',
    senderId: 'sender-1',
    text: 'Hello, how are you?',
    isBot: false,
    mediaType: null,
    mediaPath: null,
    mediaFileId: null,
    replyToMessageId: null,
    forwardFromChatId: null,
    forwardFromMessageId: null,
    rawJson: '{}',
    createdAt: new Date(),
    updatedAt: new Date(),
    transcript: null,
    transcriptStatus: null,
    transcriptLanguage: null,
    transcriptDurationMs: null,
    transcriptError: null,
    ...overrides,
  });

  const createMockChat = (overrides: Partial<Chat> = {}): Chat => ({
    id: 'chat-1',
    telegramId: '123456789',
    type: 'private',
    title: 'Test Chat',
    username: 'testuser',
    firstName: 'Test',
    lastName: 'User',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  const createMockSender = (overrides: Partial<Sender> = {}): Sender => ({
    id: 'sender-1',
    telegramId: '987654321',
    username: 'testuser',
    firstName: 'Test',
    lastName: 'User',
    isBot: false,
    isPremium: false,
    languageCode: 'en',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  const createMockQueueItem = (overrides: Partial<QueueItem> = {}): QueueItem => ({
    id: 'queue-1',
    messageId: 'msg-1',
    priority: 1,
    status: 'pending',
    attempts: 0,
    maxRetries: 3,
    nextRetryAt: null,
    claimedAt: null,
    claimedBy: null,
    completedAt: null,
    errorMessage: null,
    errorHistory: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock instances with typed methods
    mockQueueRepository = {
      findById: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    } as unknown as QueueRepository;

    mockMessageRepository = {
      findById: vi.fn(),
      findRecentByChatId: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      hasBotResponseForMessage: vi.fn().mockResolvedValue(false),
    } as unknown as MessageRepository;

    mockLLMService = {
      analyzeMessage: vi.fn(),
      generateResponse: vi.fn(),
      getHealthStatus: vi.fn(),
    } as unknown as LLMService;

    mockResponseRouter = {
      generateResponse: vi.fn(),
    } as unknown as ResponseRouterService;

    mockTelegramService = {
      sendMessage: vi.fn(),
      markAsRead: vi.fn(),
      setTyping: vi.fn(),
    } as unknown as TelegramService;

    mockMessageLengthService = {
      ensureFitsLimit: vi.fn(),
      getLength: vi.fn(),
      isOverLimit: vi.fn(),
    } as unknown as MessageLengthService;

    mockMetricsService = {
      increment: vi.fn(),
      histogram: vi.fn(),
      gauge: vi.fn(),
    } as unknown as MetricsService;

    mockExtractionCoordinator = {
      extractAll: vi.fn(),
    } as unknown as ExtractionCoordinatorService;

    mockRetryCoordinator = {
      handleResult: vi.fn(),
      stop: vi.fn(),
      getErrorHistorySize: vi.fn(),
    } as unknown as RetryCoordinatorService;

    mockTranscriptionCoordinator = {
      processVoiceMessage: vi.fn(),
    } as unknown as TranscriptionCoordinatorService;

    // Create service instance
    service = new ProcessorService(
      mockQueueRepository,
      mockLLMService,
      mockResponseRouter,
      mockMessageRepository,
      mockTelegramService,
      mockExtractionCoordinator,
      mockRetryCoordinator,
      mockTranscriptionCoordinator
    );

    // Set optional dependencies
    service.setMessageLengthService(mockMessageLengthService);
    service.setMetricsService(mockMetricsService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('processMessage()', () => {
    describe('happy path with private chat', () => {
      it('should process message successfully in private chat', async () => {
        const message = createMockMessage();
        const chat = createMockChat({ type: 'private' });
        const sender = createMockSender();

        // Mock dependencies
        vi.mocked(mockExtractionCoordinator.extractAll).mockResolvedValue(undefined);
        vi.mocked(mockTranscriptionCoordinator.processVoiceMessage).mockResolvedValue(undefined);
        vi.mocked(mockTelegramService.markAsRead).mockResolvedValue(undefined);
        vi.mocked(mockTelegramService.setTyping).mockResolvedValue(undefined);
        vi.mocked(mockMessageRepository.findRecentByChatId).mockResolvedValue([message]);
        vi.mocked(mockResponseRouter.generateResponse).mockResolvedValue({
          success: true,
          content: 'Hello! I am doing well, thank you.',
          skipped: false,
        });
        vi.mocked(mockMessageLengthService.ensureFitsLimit).mockResolvedValue({
          text: 'Hello! I am doing well, thank you.',
          originalLength: 35,
          finalLength: 35,
          wasSummarized: false,
          wasTruncated: false,
          processingTimeMs: 5,
        });
        vi.mocked(mockTelegramService.sendMessage).mockResolvedValue({
          id: 67890,
          text: 'Hello! I am doing well, thank you.',
        } as any);
        vi.mocked(mockMessageRepository.create).mockResolvedValue({
          id: 'msg-2',
          telegramMessageId: 67890,
        } as any);

        const result = await service.processMessage(message, chat, sender);

        // Assertions
        expect(result.success).toBe(true);
        expect(result.response).toBe('Response generated via router');

        // Verify extraction coordinator was called (no identityOptions when not provided)
        expect(mockExtractionCoordinator.extractAll).toHaveBeenCalledWith(message, sender, undefined);

        // Verify transcription coordinator was called
        expect(mockTranscriptionCoordinator.processVoiceMessage).toHaveBeenCalledWith(
          message,
          chat,
          true
        );

        // Verify read receipt was sent
        expect(mockTelegramService.markAsRead).toHaveBeenCalledWith(
          chat.telegramId,
          message.telegramMessageId
        );

        // Verify typing indicator was sent
        expect(mockTelegramService.setTyping).toHaveBeenCalledWith(chat.telegramId);

        // Verify context was loaded
        expect(mockMessageRepository.findRecentByChatId).toHaveBeenCalledWith(chat.id, 10);

        // Verify response was generated (with identityOptions)
        expect(mockResponseRouter.generateResponse).toHaveBeenCalledWith(
          message,
          chat,
          sender,
          [message],
          undefined
        );

        // Verify message length was ensured
        expect(mockMessageLengthService.ensureFitsLimit).toHaveBeenCalledWith(
          'Hello! I am doing well, thank you.'
        );

        // Verify message was sent
        expect(mockTelegramService.sendMessage).toHaveBeenCalledWith(
          chat.telegramId,
          'Hello! I am doing well, thank you.',
          message.telegramMessageId
        );

        // Verify bot message was stored
        expect(mockMessageRepository.create).toHaveBeenCalledWith({
          telegramMessageId: 67890,
          chatId: chat.id,
          senderId: null,
          text: 'Hello! I am doing well, thank you.',
          isBot: true,
          replyToMessageId: message.telegramMessageId,
          rawJson: expect.stringContaining('67890'),
        });
      });

      it('should record metrics when message length is adjusted', async () => {
        const message = createMockMessage();
        const chat = createMockChat({ type: 'private' });
        const sender = createMockSender();

        vi.mocked(mockTranscriptionCoordinator.processVoiceMessage).mockResolvedValue(undefined);
        vi.mocked(mockTelegramService.markAsRead).mockResolvedValue(undefined);
        vi.mocked(mockTelegramService.setTyping).mockResolvedValue(undefined);
        vi.mocked(mockMessageRepository.findRecentByChatId).mockResolvedValue([]);
        vi.mocked(mockResponseRouter.generateResponse).mockResolvedValue({
          success: true,
          content: 'Long response'.repeat(500),
          skipped: false,
        });

        // Mock message length service to simulate truncation
        vi.mocked(mockMessageLengthService.ensureFitsLimit).mockResolvedValue({
          text: 'Truncated response...',
          originalLength: 6500,
          finalLength: 21,
          wasSummarized: false,
          wasTruncated: true,
          processingTimeMs: 10,
        });

        vi.mocked(mockTelegramService.sendMessage).mockResolvedValue({
          id: 67890,
          text: 'Truncated response...',
        } as any);
        vi.mocked(mockMessageRepository.create).mockResolvedValue({} as any);

        await service.processMessage(message, chat, sender);

        // Verify metrics were recorded
        expect(mockMetricsService.histogram).toHaveBeenCalledWith('message_length_original', 6500);
        expect(mockMetricsService.histogram).toHaveBeenCalledWith('message_length_final', 21);
        expect(mockMetricsService.increment).toHaveBeenCalledWith('message_truncation_count');
      });

      it('should record summarization metrics when message is summarized', async () => {
        const message = createMockMessage();
        const chat = createMockChat({ type: 'private' });
        const sender = createMockSender();

        vi.mocked(mockTranscriptionCoordinator.processVoiceMessage).mockResolvedValue(undefined);
        vi.mocked(mockTelegramService.markAsRead).mockResolvedValue(undefined);
        vi.mocked(mockTelegramService.setTyping).mockResolvedValue(undefined);
        vi.mocked(mockMessageRepository.findRecentByChatId).mockResolvedValue([]);
        vi.mocked(mockResponseRouter.generateResponse).mockResolvedValue({
          success: true,
          content: 'Very long response'.repeat(500),
          skipped: false,
        });

        // Mock message length service to simulate summarization
        vi.mocked(mockMessageLengthService.ensureFitsLimit).mockResolvedValue({
          text: 'Summarized response',
          originalLength: 9500,
          finalLength: 19,
          wasSummarized: true,
          wasTruncated: false,
          processingTimeMs: 150,
        });

        vi.mocked(mockTelegramService.sendMessage).mockResolvedValue({
          id: 67890,
        } as any);
        vi.mocked(mockMessageRepository.create).mockResolvedValue({} as any);

        await service.processMessage(message, chat, sender);

        // Verify summarization metrics were recorded
        expect(mockMetricsService.increment).toHaveBeenCalledWith('message_summarization_count');
        expect(mockMetricsService.histogram).toHaveBeenCalledWith(
          'message_summarization_duration_ms',
          150
        );
      });

      it('should use fallback truncation when MessageLengthService is not set', async () => {
        const message = createMockMessage();
        const chat = createMockChat({ type: 'private' });
        const sender = createMockSender();

        // Create service without MessageLengthService
        const serviceWithoutLengthService = new ProcessorService(
          mockQueueRepository,
          mockLLMService,
          mockResponseRouter,
          mockMessageRepository,
          mockTelegramService,
          mockExtractionCoordinator,
          mockRetryCoordinator,
          mockTranscriptionCoordinator
        );

        vi.mocked(mockTranscriptionCoordinator.processVoiceMessage).mockResolvedValue(undefined);
        vi.mocked(mockTelegramService.markAsRead).mockResolvedValue(undefined);
        vi.mocked(mockTelegramService.setTyping).mockResolvedValue(undefined);
        vi.mocked(mockMessageRepository.findRecentByChatId).mockResolvedValue([]);

        // Generate a response longer than 4096 characters
        const longResponse = 'x'.repeat(5000);
        vi.mocked(mockResponseRouter.generateResponse).mockResolvedValue({
          success: true,
          content: longResponse,
          skipped: false,
        });

        vi.mocked(mockTelegramService.sendMessage).mockResolvedValue({
          id: 67890,
        } as any);
        vi.mocked(mockMessageRepository.create).mockResolvedValue({} as any);

        await serviceWithoutLengthService.processMessage(message, chat, sender);

        // Verify message was sent with fallback truncation (4000 chars + '...')
        expect(mockTelegramService.sendMessage).toHaveBeenCalledWith(
          chat.telegramId,
          'x'.repeat(4000) + '...',
          message.telegramMessageId
        );
      });

      it('should handle MessageLengthService errors with fallback', async () => {
        const message = createMockMessage();
        const chat = createMockChat({ type: 'private' });
        const sender = createMockSender();

        vi.mocked(mockTranscriptionCoordinator.processVoiceMessage).mockResolvedValue(undefined);
        vi.mocked(mockTelegramService.markAsRead).mockResolvedValue(undefined);
        vi.mocked(mockTelegramService.setTyping).mockResolvedValue(undefined);
        vi.mocked(mockMessageRepository.findRecentByChatId).mockResolvedValue([]);

        const longResponse = 'y'.repeat(5000);
        vi.mocked(mockResponseRouter.generateResponse).mockResolvedValue({
          success: true,
          content: longResponse,
          skipped: false,
        });

        // Mock ensureFitsLimit to throw error
        vi.mocked(mockMessageLengthService.ensureFitsLimit).mockRejectedValue(
          new Error('LLM service unavailable')
        );

        vi.mocked(mockTelegramService.sendMessage).mockResolvedValue({
          id: 67890,
        } as any);
        vi.mocked(mockMessageRepository.create).mockResolvedValue({} as any);

        await service.processMessage(message, chat, sender);

        // Verify fallback truncation was used (4000 chars + '...')
        expect(mockTelegramService.sendMessage).toHaveBeenCalledWith(
          chat.telegramId,
          'y'.repeat(4000) + '...',
          message.telegramMessageId
        );
      });
    });

    describe('skips response for non-private chats', () => {
      it('should not generate response for group chat', async () => {
        const message = createMockMessage();
        const chat = createMockChat({ type: 'group' });
        const sender = createMockSender();

        vi.mocked(mockTranscriptionCoordinator.processVoiceMessage).mockResolvedValue(undefined);
        vi.mocked(mockLLMService.analyzeMessage).mockResolvedValue({
          success: true,
          content: 'Analysis result',
          responseId: 'llm-response-1',
        });

        const result = await service.processMessage(message, chat, sender);

        // Should analyze but not send response
        expect(result.success).toBe(true);
        expect(result.response).toBe('Analysis result');
        expect(result.llmResponseId).toBe('llm-response-1');

        // Should NOT call response router or telegram service
        expect(mockResponseRouter.generateResponse).not.toHaveBeenCalled();
        expect(mockTelegramService.sendMessage).not.toHaveBeenCalled();

        // Should still call LLM for analysis
        expect(mockLLMService.analyzeMessage).toHaveBeenCalledWith(
          message,
          chat,
          sender,
          'analysis'
        );
      });

      it('should not generate response for supergroup chat', async () => {
        const message = createMockMessage();
        const chat = createMockChat({ type: 'supergroup' });
        const sender = createMockSender();

        vi.mocked(mockTranscriptionCoordinator.processVoiceMessage).mockResolvedValue(undefined);
        vi.mocked(mockLLMService.analyzeMessage).mockResolvedValue({
          success: true,
          content: 'Analysis result',
        });

        await service.processMessage(message, chat, sender);

        // Should NOT send response to supergroup
        expect(mockResponseRouter.generateResponse).not.toHaveBeenCalled();
        expect(mockTelegramService.sendMessage).not.toHaveBeenCalled();
      });

      it('should not generate response for channel', async () => {
        const message = createMockMessage();
        const chat = createMockChat({ type: 'channel' });
        const sender = createMockSender();

        vi.mocked(mockTranscriptionCoordinator.processVoiceMessage).mockResolvedValue(undefined);
        vi.mocked(mockLLMService.analyzeMessage).mockResolvedValue({
          success: true,
          content: 'Analysis result',
        });

        await service.processMessage(message, chat, sender);

        // Should NOT send response to channel
        expect(mockResponseRouter.generateResponse).not.toHaveBeenCalled();
        expect(mockTelegramService.sendMessage).not.toHaveBeenCalled();
      });
    });

    describe('skips response for bot messages', () => {
      it('should not generate response for bot messages in private chat', async () => {
        const message = createMockMessage({ isBot: true });
        const chat = createMockChat({ type: 'private' });
        const sender = createMockSender({ isBot: true });

        vi.mocked(mockTranscriptionCoordinator.processVoiceMessage).mockResolvedValue(undefined);
        vi.mocked(mockLLMService.analyzeMessage).mockResolvedValue({
          success: true,
          content: 'Analysis result',
        });

        await service.processMessage(message, chat, sender);

        // Should NOT generate response for bot messages
        expect(mockResponseRouter.generateResponse).not.toHaveBeenCalled();
        expect(mockTelegramService.sendMessage).not.toHaveBeenCalled();

        // Should still analyze the message
        expect(mockLLMService.analyzeMessage).toHaveBeenCalled();
      });
    });

    describe('skips response for empty messages', () => {
      it('should not generate response when text is empty', async () => {
        const message = createMockMessage({ text: '' });
        const chat = createMockChat({ type: 'private' });
        const sender = createMockSender();

        vi.mocked(mockTranscriptionCoordinator.processVoiceMessage).mockResolvedValue(undefined);
        vi.mocked(mockLLMService.analyzeMessage).mockResolvedValue({
          success: true,
          content: 'Analysis result',
        });

        await service.processMessage(message, chat, sender);

        // Should NOT generate response for empty text
        expect(mockResponseRouter.generateResponse).not.toHaveBeenCalled();
        expect(mockTelegramService.sendMessage).not.toHaveBeenCalled();
      });

      it('should not generate response when text is only whitespace', async () => {
        const message = createMockMessage({ text: '   \n\t  ' });
        const chat = createMockChat({ type: 'private' });
        const sender = createMockSender();

        vi.mocked(mockTranscriptionCoordinator.processVoiceMessage).mockResolvedValue(undefined);
        vi.mocked(mockLLMService.analyzeMessage).mockResolvedValue({
          success: true,
          content: 'Analysis result',
        });

        await service.processMessage(message, chat, sender);

        // Should NOT generate response for whitespace-only text
        expect(mockResponseRouter.generateResponse).not.toHaveBeenCalled();
        expect(mockTelegramService.sendMessage).not.toHaveBeenCalled();
      });

      it('should not generate response when text is null', async () => {
        const message = createMockMessage({ text: null as any });
        const chat = createMockChat({ type: 'private' });
        const sender = createMockSender();

        vi.mocked(mockTranscriptionCoordinator.processVoiceMessage).mockResolvedValue(undefined);
        vi.mocked(mockLLMService.analyzeMessage).mockResolvedValue({
          success: true,
          content: 'Analysis result',
        });

        await service.processMessage(message, chat, sender);

        // Should NOT generate response for null text
        expect(mockResponseRouter.generateResponse).not.toHaveBeenCalled();
        expect(mockTelegramService.sendMessage).not.toHaveBeenCalled();
      });
    });

    describe('handles LLM failures with skipOnUnhealthy', () => {
      it('should return success when LLM fails and skipOnUnhealthy is true', async () => {
        // Mock config with skipOnUnhealthy enabled
        const { appConfig } = await import('../config/index.js');
        (appConfig.llm as any).skipOnUnhealthy = true;

        const message = createMockMessage();
        const chat = createMockChat({ type: 'group' }); // Non-private to trigger analysis path
        const sender = createMockSender();

        vi.mocked(mockTranscriptionCoordinator.processVoiceMessage).mockResolvedValue(undefined);
        vi.mocked(mockLLMService.analyzeMessage).mockResolvedValue({
          success: false,
          error: 'LLM service is unhealthy',
        });

        const result = await service.processMessage(message, chat, sender);

        // Should return success despite LLM failure
        expect(result.success).toBe(true);
        expect(result.response).toBe('Processed without LLM (service unavailable)');

        // Reset config
        (appConfig.llm as any).skipOnUnhealthy = false;
      });

      it('should return failure when LLM fails and skipOnUnhealthy is false', async () => {
        const message = createMockMessage();
        const chat = createMockChat({ type: 'group' }); // Non-private to trigger analysis path
        const sender = createMockSender();

        vi.mocked(mockTranscriptionCoordinator.processVoiceMessage).mockResolvedValue(undefined);
        vi.mocked(mockLLMService.analyzeMessage).mockResolvedValue({
          success: false,
          error: 'LLM timeout occurred',
        });

        const result = await service.processMessage(message, chat, sender);

        // Should return failure when skipOnUnhealthy is false
        expect(result.success).toBe(false);
        expect(result.error).toBe('LLM timeout occurred');
      });
    });

    describe('handles response router failures', () => {
      it('should log warning when response router returns skipped', async () => {
        const message = createMockMessage();
        const chat = createMockChat({ type: 'private' });
        const sender = createMockSender();

        vi.mocked(mockTranscriptionCoordinator.processVoiceMessage).mockResolvedValue(undefined);
        vi.mocked(mockTelegramService.markAsRead).mockResolvedValue(undefined);
        vi.mocked(mockTelegramService.setTyping).mockResolvedValue(undefined);
        vi.mocked(mockMessageRepository.findRecentByChatId).mockResolvedValue([]);
        vi.mocked(mockResponseRouter.generateResponse).mockResolvedValue({
          success: true,
          skipped: true,
          content: null,
        });

        const result = await service.processMessage(message, chat, sender);

        // Should return success overall (response generation path was attempted)
        expect(result.success).toBe(true);

        // Should NOT send message
        expect(mockTelegramService.sendMessage).not.toHaveBeenCalled();
      });

      it('should log warning when response router returns failure', async () => {
        const message = createMockMessage();
        const chat = createMockChat({ type: 'private' });
        const sender = createMockSender();

        vi.mocked(mockTranscriptionCoordinator.processVoiceMessage).mockResolvedValue(undefined);
        vi.mocked(mockTelegramService.markAsRead).mockResolvedValue(undefined);
        vi.mocked(mockTelegramService.setTyping).mockResolvedValue(undefined);
        vi.mocked(mockMessageRepository.findRecentByChatId).mockResolvedValue([]);
        vi.mocked(mockResponseRouter.generateResponse).mockResolvedValue({
          success: false,
          error: 'Response generation failed',
        });

        const result = await service.processMessage(message, chat, sender);

        // Should return success overall (we don't fail the whole processing on response error)
        expect(result.success).toBe(true);

        // Should NOT send message
        expect(mockTelegramService.sendMessage).not.toHaveBeenCalled();
      });

      it('should handle telegram send message failure gracefully', async () => {
        const message = createMockMessage();
        const chat = createMockChat({ type: 'private' });
        const sender = createMockSender();

        vi.mocked(mockTranscriptionCoordinator.processVoiceMessage).mockResolvedValue(undefined);
        vi.mocked(mockTelegramService.markAsRead).mockResolvedValue(undefined);
        vi.mocked(mockTelegramService.setTyping).mockResolvedValue(undefined);
        vi.mocked(mockMessageRepository.findRecentByChatId).mockResolvedValue([]);
        vi.mocked(mockResponseRouter.generateResponse).mockResolvedValue({
          success: true,
          content: 'Test response',
          skipped: false,
        });
        vi.mocked(mockMessageLengthService.ensureFitsLimit).mockResolvedValue({
          text: 'Test response',
          originalLength: 13,
          finalLength: 13,
          wasSummarized: false,
          wasTruncated: false,
          processingTimeMs: 5,
        });

        // Mock telegram service to throw error
        vi.mocked(mockTelegramService.sendMessage).mockRejectedValue(
          new Error('Network error')
        );

        const result = await service.processMessage(message, chat, sender);

        // Should still return success (error is logged but not propagated)
        expect(result.success).toBe(true);
        expect(result.response).toBe('Response generated via router');

        // Should NOT create bot message in database
        expect(mockMessageRepository.create).not.toHaveBeenCalled();
      });
    });

    describe('handles general errors', () => {
      it('should return failure when unexpected error occurs', async () => {
        const message = createMockMessage();
        const chat = createMockChat({ type: 'private' });
        const sender = createMockSender();

        // Mock transcription coordinator to throw error
        vi.mocked(mockTranscriptionCoordinator.processVoiceMessage).mockRejectedValue(
          new Error('Unexpected processing error')
        );

        const result = await service.processMessage(message, chat, sender);

        expect(result.success).toBe(false);
        expect(result.error).toBe('Unexpected processing error');
      });

      it('should handle non-Error exceptions', async () => {
        const message = createMockMessage();
        const chat = createMockChat({ type: 'private' });
        const sender = createMockSender();

        // Mock to throw non-Error object
        vi.mocked(mockTranscriptionCoordinator.processVoiceMessage).mockRejectedValue(
          'String error'
        );

        const result = await service.processMessage(message, chat, sender);

        expect(result.success).toBe(false);
        expect(result.error).toBe('Unknown error');
      });
    });

    describe('extraction and transcription coordination', () => {
      it('should call extraction coordinator when memory is enabled', async () => {
        const message = createMockMessage();
        const chat = createMockChat({ type: 'group' });
        const sender = createMockSender();

        vi.mocked(mockTranscriptionCoordinator.processVoiceMessage).mockResolvedValue(undefined);
        vi.mocked(mockLLMService.analyzeMessage).mockResolvedValue({
          success: true,
          content: 'Analysis result',
        });

        await service.processMessage(message, chat, sender);

        expect(mockExtractionCoordinator.extractAll).toHaveBeenCalledWith(message, sender, undefined);
      });

      it('should not call extraction coordinator when sender is null', async () => {
        const message = createMockMessage();
        const chat = createMockChat({ type: 'group' });

        vi.mocked(mockTranscriptionCoordinator.processVoiceMessage).mockResolvedValue(undefined);
        vi.mocked(mockLLMService.analyzeMessage).mockResolvedValue({
          success: true,
          content: 'Analysis result',
        });

        await service.processMessage(message, chat, null);

        expect(mockExtractionCoordinator.extractAll).not.toHaveBeenCalled();
      });

      it('should pass identityOptions to extraction coordinator', async () => {
        const message = createMockMessage();
        const chat = createMockChat({ type: 'group' });
        const sender = createMockSender();
        const identityOptions = { userId: 'uid-1', conversationId: 'cid-1' };

        vi.mocked(mockTranscriptionCoordinator.processVoiceMessage).mockResolvedValue(undefined);
        vi.mocked(mockLLMService.analyzeMessage).mockResolvedValue({
          success: true,
          content: 'Analysis result',
        });

        await service.processMessage(message, chat, sender, identityOptions);

        expect(mockExtractionCoordinator.extractAll).toHaveBeenCalledWith(
          message,
          sender,
          identityOptions
        );
      });

      it('should pass identityOptions to response router for private chats', async () => {
        const message = createMockMessage();
        const chat = createMockChat({ type: 'private' });
        const sender = createMockSender();
        const identityOptions = { userId: 'uid-1', conversationId: 'cid-1' };

        vi.mocked(mockTranscriptionCoordinator.processVoiceMessage).mockResolvedValue(undefined);
        vi.mocked(mockTelegramService.markAsRead).mockResolvedValue(undefined);
        vi.mocked(mockTelegramService.setTyping).mockResolvedValue(undefined);
        vi.mocked(mockMessageRepository.findRecentByChatId).mockResolvedValue([]);
        vi.mocked(mockResponseRouter.generateResponse).mockResolvedValue({
          success: true,
          content: 'Response',
          skipped: false,
        });
        vi.mocked(mockMessageLengthService.ensureFitsLimit).mockResolvedValue({
          text: 'Response',
          originalLength: 8,
          finalLength: 8,
          wasSummarized: false,
          wasTruncated: false,
          processingTimeMs: 5,
        });
        vi.mocked(mockTelegramService.sendMessage).mockResolvedValue({ id: 123 } as any);
        vi.mocked(mockMessageRepository.create).mockResolvedValue({} as any);

        await service.processMessage(message, chat, sender, identityOptions);

        expect(mockResponseRouter.generateResponse).toHaveBeenCalledWith(
          message,
          chat,
          sender,
          [],
          identityOptions
        );
      });

      it('should always call transcription coordinator', async () => {
        const message = createMockMessage();
        const chat = createMockChat({ type: 'private' });
        const sender = createMockSender();

        vi.mocked(mockTranscriptionCoordinator.processVoiceMessage).mockResolvedValue(undefined);
        vi.mocked(mockTelegramService.markAsRead).mockResolvedValue(undefined);
        vi.mocked(mockTelegramService.setTyping).mockResolvedValue(undefined);
        vi.mocked(mockMessageRepository.findRecentByChatId).mockResolvedValue([]);
        vi.mocked(mockResponseRouter.generateResponse).mockResolvedValue({
          success: true,
          content: 'Response',
          skipped: false,
        });
        vi.mocked(mockMessageLengthService.ensureFitsLimit).mockResolvedValue({
          text: 'Response',
          originalLength: 8,
          finalLength: 8,
          wasSummarized: false,
          wasTruncated: false,
          processingTimeMs: 5,
        });
        vi.mocked(mockTelegramService.sendMessage).mockResolvedValue({ id: 123 } as any);
        vi.mocked(mockMessageRepository.create).mockResolvedValue({} as any);

        await service.processMessage(message, chat, sender);

        expect(mockTranscriptionCoordinator.processVoiceMessage).toHaveBeenCalledWith(
          message,
          chat,
          true
        );
      });
    });
  });

  describe('handleProcessingResult()', () => {
    it('should delegate to RetryCoordinatorService', async () => {
      const queueItem = createMockQueueItem();
      const result: ProcessingResult = {
        success: true,
        response: 'Processed successfully',
      };

      vi.mocked(mockRetryCoordinator.handleResult).mockResolvedValue(undefined);

      await service.handleProcessingResult(queueItem, result);

      expect(mockRetryCoordinator.handleResult).toHaveBeenCalledWith(queueItem, result);
    });

    it('should pass failure results to retry coordinator', async () => {
      const queueItem = createMockQueueItem();
      const result: ProcessingResult = {
        success: false,
        error: 'Processing failed',
      };

      vi.mocked(mockRetryCoordinator.handleResult).mockResolvedValue(undefined);

      await service.handleProcessingResult(queueItem, result);

      expect(mockRetryCoordinator.handleResult).toHaveBeenCalledWith(queueItem, result);
    });
  });

  describe('utility methods', () => {
    it('getErrorHistorySize() should delegate to retry coordinator', () => {
      vi.mocked(mockRetryCoordinator.getErrorHistorySize).mockReturnValue(100);

      const size = service.getErrorHistorySize();

      expect(size).toBe(100);
      expect(mockRetryCoordinator.getErrorHistorySize).toHaveBeenCalled();
    });

    it('stop() should delegate to retry coordinator', () => {
      vi.mocked(mockRetryCoordinator.stop).mockReturnValue(undefined);

      service.stop();

      expect(mockRetryCoordinator.stop).toHaveBeenCalled();
    });
  });

  describe('message truncation for long responses', () => {
    it('should truncate messages longer than 4096 characters', async () => {
      const message = createMockMessage();
      const chat = createMockChat({ type: 'private' });
      const sender = createMockSender();

      const longResponse = 'x'.repeat(5000);

      vi.mocked(mockTranscriptionCoordinator.processVoiceMessage).mockResolvedValue(undefined);
      vi.mocked(mockTelegramService.markAsRead).mockResolvedValue(undefined);
      vi.mocked(mockTelegramService.setTyping).mockResolvedValue(undefined);
      vi.mocked(mockMessageRepository.findRecentByChatId).mockResolvedValue([]);
      vi.mocked(mockResponseRouter.generateResponse).mockResolvedValue({
        success: true,
        content: longResponse,
        skipped: false,
      });
      vi.mocked(mockMessageLengthService.ensureFitsLimit).mockResolvedValue({
        text: 'x'.repeat(4000) + '...',
        originalLength: 5000,
        finalLength: 4003,
        wasSummarized: false,
        wasTruncated: true,
        processingTimeMs: 8,
      });
      vi.mocked(mockTelegramService.sendMessage).mockResolvedValue({ id: 123 } as any);
      vi.mocked(mockMessageRepository.create).mockResolvedValue({} as any);

      await service.processMessage(message, chat, sender);

      // Verify truncation occurred
      expect(mockMessageLengthService.ensureFitsLimit).toHaveBeenCalledWith(longResponse);
      expect(mockTelegramService.sendMessage).toHaveBeenCalledWith(
        chat.telegramId,
        'x'.repeat(4000) + '...',
        message.telegramMessageId
      );
    });

    it('should preserve messages shorter than limit', async () => {
      const message = createMockMessage();
      const chat = createMockChat({ type: 'private' });
      const sender = createMockSender();

      const shortResponse = 'Short response';

      vi.mocked(mockTranscriptionCoordinator.processVoiceMessage).mockResolvedValue(undefined);
      vi.mocked(mockTelegramService.markAsRead).mockResolvedValue(undefined);
      vi.mocked(mockTelegramService.setTyping).mockResolvedValue(undefined);
      vi.mocked(mockMessageRepository.findRecentByChatId).mockResolvedValue([]);
      vi.mocked(mockResponseRouter.generateResponse).mockResolvedValue({
        success: true,
        content: shortResponse,
        skipped: false,
      });
      vi.mocked(mockMessageLengthService.ensureFitsLimit).mockResolvedValue({
        text: shortResponse,
        originalLength: 14,
        finalLength: 14,
        wasSummarized: false,
        wasTruncated: false,
        processingTimeMs: 2,
      });
      vi.mocked(mockTelegramService.sendMessage).mockResolvedValue({ id: 123 } as any);
      vi.mocked(mockMessageRepository.create).mockResolvedValue({} as any);

      await service.processMessage(message, chat, sender);

      // Verify no truncation occurred
      expect(mockTelegramService.sendMessage).toHaveBeenCalledWith(
        chat.telegramId,
        shortResponse,
        message.telegramMessageId
      );
    });

    it('should handle exactly 4096 character responses', async () => {
      const message = createMockMessage();
      const chat = createMockChat({ type: 'private' });
      const sender = createMockSender();

      const exactLimitResponse = 'x'.repeat(4096);

      vi.mocked(mockTranscriptionCoordinator.processVoiceMessage).mockResolvedValue(undefined);
      vi.mocked(mockTelegramService.markAsRead).mockResolvedValue(undefined);
      vi.mocked(mockTelegramService.setTyping).mockResolvedValue(undefined);
      vi.mocked(mockMessageRepository.findRecentByChatId).mockResolvedValue([]);
      vi.mocked(mockResponseRouter.generateResponse).mockResolvedValue({
        success: true,
        content: exactLimitResponse,
        skipped: false,
      });
      vi.mocked(mockMessageLengthService.ensureFitsLimit).mockResolvedValue({
        text: exactLimitResponse,
        originalLength: 4096,
        finalLength: 4096,
        wasSummarized: false,
        wasTruncated: false,
        processingTimeMs: 5,
      });
      vi.mocked(mockTelegramService.sendMessage).mockResolvedValue({ id: 123 } as any);
      vi.mocked(mockMessageRepository.create).mockResolvedValue({} as any);

      await service.processMessage(message, chat, sender);

      // Verify no truncation for exactly 4096 characters
      expect(mockTelegramService.sendMessage).toHaveBeenCalledWith(
        chat.telegramId,
        exactLimitResponse,
        message.telegramMessageId
      );
    });
  });

  describe('therapist mode integration', () => {
    const mockTherapistService = {
      isEnabledForChat: vi.fn(),
      shouldIntervene: vi.fn(),
      processAndGenerateResponse: vi.fn(),
    };

    beforeEach(() => {
      vi.clearAllMocks();
      mockTherapistService.processAndGenerateResponse.mockReset();
    });

    it('should route to therapist service for group chat with conversationId', async () => {
      const message = createMockMessage();
      const chat = createMockChat({ type: 'group' });
      const sender = createMockSender();
      const identityOptions = { userId: 'uid-1', conversationId: 'conv-1' };

      service.setTherapistService(mockTherapistService);

      vi.mocked(mockTranscriptionCoordinator.processVoiceMessage).mockResolvedValue(undefined);
      mockTherapistService.processAndGenerateResponse.mockResolvedValue({
        content: 'I hear you both...',
        interventionType: 'emotional_support',
      });

      const result = await service.processMessage(message, chat, sender, identityOptions);

      expect(result.success).toBe(true);
      expect(result.response).toBe('Response generated via therapist mode');
      expect(mockTherapistService.processAndGenerateResponse).toHaveBeenCalledWith(
        'conv-1',
        message,
        null,
        identityOptions
      );
      // Should NOT fall through to LLM analysis
      expect(mockLLMService.analyzeMessage).not.toHaveBeenCalled();
    });

    it('should fall through to analysis when therapist returns null', async () => {
      const message = createMockMessage();
      const chat = createMockChat({ type: 'group' });
      const sender = createMockSender();
      const identityOptions = { userId: 'uid-1', conversationId: 'conv-1' };

      service.setTherapistService(mockTherapistService);

      vi.mocked(mockTranscriptionCoordinator.processVoiceMessage).mockResolvedValue(undefined);
      mockTherapistService.processAndGenerateResponse.mockResolvedValue(null);
      vi.mocked(mockLLMService.analyzeMessage).mockResolvedValue({
        success: true,
        content: 'Analysis result',
      });

      const result = await service.processMessage(message, chat, sender, identityOptions);

      expect(result.success).toBe(true);
      expect(result.response).toBe('Analysis result');
      expect(mockLLMService.analyzeMessage).toHaveBeenCalled();
    });

    it('should skip therapist for group chat without conversationId', async () => {
      const message = createMockMessage();
      const chat = createMockChat({ type: 'group' });
      const sender = createMockSender();

      service.setTherapistService(mockTherapistService);

      vi.mocked(mockTranscriptionCoordinator.processVoiceMessage).mockResolvedValue(undefined);
      vi.mocked(mockLLMService.analyzeMessage).mockResolvedValue({
        success: true,
        content: 'Analysis result',
      });

      await service.processMessage(message, chat, sender);

      expect(mockTherapistService.processAndGenerateResponse).not.toHaveBeenCalled();
      expect(mockLLMService.analyzeMessage).toHaveBeenCalled();
    });

    it('should skip therapist for private chats', async () => {
      const message = createMockMessage();
      const chat = createMockChat({ type: 'private' });
      const sender = createMockSender();
      const identityOptions = { userId: 'uid-1', conversationId: 'conv-1' };

      service.setTherapistService(mockTherapistService);

      vi.mocked(mockTranscriptionCoordinator.processVoiceMessage).mockResolvedValue(undefined);
      vi.mocked(mockTelegramService.markAsRead).mockResolvedValue(undefined);
      vi.mocked(mockTelegramService.setTyping).mockResolvedValue(undefined);
      vi.mocked(mockMessageRepository.findRecentByChatId).mockResolvedValue([]);
      vi.mocked(mockResponseRouter.generateResponse).mockResolvedValue({
        success: true,
        content: 'Response',
        skipped: false,
      });
      vi.mocked(mockMessageLengthService.ensureFitsLimit).mockResolvedValue({
        text: 'Response',
        originalLength: 8,
        finalLength: 8,
        wasSummarized: false,
        wasTruncated: false,
        processingTimeMs: 5,
      });
      vi.mocked(mockTelegramService.sendMessage).mockResolvedValue({ id: 123 } as any);
      vi.mocked(mockMessageRepository.create).mockResolvedValue({} as any);

      await service.processMessage(message, chat, sender, identityOptions);

      // Should NOT call therapist service for private chats
      expect(mockTherapistService.processAndGenerateResponse).not.toHaveBeenCalled();
      // Should use normal response router
      expect(mockResponseRouter.generateResponse).toHaveBeenCalled();
    });

    it('should skip therapist when service is not set', async () => {
      const message = createMockMessage();
      const chat = createMockChat({ type: 'group' });
      const sender = createMockSender();
      const identityOptions = { userId: 'uid-1', conversationId: 'conv-1' };

      // Don't set therapist service
      vi.mocked(mockTranscriptionCoordinator.processVoiceMessage).mockResolvedValue(undefined);
      vi.mocked(mockLLMService.analyzeMessage).mockResolvedValue({
        success: true,
        content: 'Analysis result',
      });

      const result = await service.processMessage(message, chat, sender, identityOptions);

      expect(result.success).toBe(true);
      expect(result.response).toBe('Analysis result');
    });
  });
});
