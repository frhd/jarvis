import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IngestionService } from './ingestion.service';
import { SenderRepository } from '../repositories/sender.repository';
import { ChatRepository } from '../repositories/chat.repository';
import { MessageRepository } from '../repositories/message.repository';
import { QueueRepository } from '../repositories/queue.repository';
import { FilterService } from './filter.service';
import { MediaService } from './media.service';
import { ProcessorService } from './processor.service';
import { DeduplicationService } from './deduplication.service';
import { Message, Sender, Chat, QueueItem, MediaType, ChatType } from '../types';
import { TelegramClient } from 'telegram';
import { NewMessageEvent } from 'telegram/events/index.js';
import { Api } from 'telegram';

// ============================================================================
// Mocks
// ============================================================================

// Mock logger
vi.mock('../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock identity service lazy getter
const mockIdentityService = {
  resolveUser: vi.fn(),
  resolveConversation: vi.fn(),
};
vi.mock('./instances/core', () => ({
  getIdentityService: vi.fn(() => mockIdentityService),
}));

// ============================================================================
// Test Fixtures
// ============================================================================

function createMockSender(overrides: Partial<Sender> = {}): Sender {
  return {
    id: 'sender-123',
    telegramId: '12345',
    firstName: 'John',
    lastName: 'Doe',
    username: 'johndoe',
    phone: '+1234567890',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function createMockChat(overrides: Partial<Chat> = {}): Chat {
  return {
    id: 'chat-456',
    telegramId: '67890',
    type: 'private' as ChatType,
    title: 'Test Chat',
    username: 'testchat',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function createMockMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'msg-789',
    telegramMessageId: 1001,
    chatId: 'chat-456',
    senderId: 'sender-123',
    text: 'Hello, world!',
    mediaType: null,
    mediaPath: null,
    mediaFileId: null,
    replyToMessageId: null,
    forwardFromChatId: null,
    forwardFromMessageId: null,
    isBot: false,
    rawJson: '{}',
    createdAt: new Date(),
    transcript: null,
    transcriptStatus: null,
    transcriptLanguage: null,
    transcriptDurationMs: null,
    transcriptError: null,
    ...overrides,
  };
}

function createMockQueueItem(overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    id: 'queue-001',
    messageId: 'msg-789',
    status: 'pending',
    priority: 0,
    attempts: 0,
    lastError: null,
    processedAt: null,
    nextRetryAt: null,
    priorityBoostApplied: false,
    originalPriority: null,
    version: 1,
    processingStartedAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function createMockTelegramMessage(overrides: any = {}) {
  return {
    id: 1001,
    chatId: BigInt(67890),
    senderId: BigInt(12345),
    text: 'Hello, world!',
    media: null,
    replyTo: null,
    getSender: vi.fn().mockResolvedValue({
      firstName: 'John',
      lastName: 'Doe',
      username: 'johndoe',
      phone: '+1234567890',
    }),
    getChat: vi.fn().mockResolvedValue({
      broadcast: false,
      megagroup: false,
      title: 'Test Chat',
      username: 'testchat',
    }),
    ...overrides,
  };
}

function createMockEvent(messageOverrides: any = {}): NewMessageEvent {
  return {
    message: createMockTelegramMessage(messageOverrides),
  } as any;
}

function createMockTelegramClient(): TelegramClient {
  return {} as any;
}

// ============================================================================
// Tests
// ============================================================================

describe('IngestionService', () => {
  let ingestionService: IngestionService;
  let mockSenderRepo: SenderRepository;
  let mockChatRepo: ChatRepository;
  let mockMessageRepo: MessageRepository;
  let mockQueueRepo: QueueRepository;
  let mockFilterService: FilterService;
  let mockMediaService: MediaService;
  let mockProcessorService: ProcessorService;
  let mockDeduplicationService: DeduplicationService;

  beforeEach(() => {
    // Create mock repositories and services
    mockSenderRepo = {
      upsert: vi.fn(),
      findById: vi.fn(),
    } as any;

    mockChatRepo = {
      upsert: vi.fn(),
      findById: vi.fn(),
    } as any;

    mockMessageRepo = {
      createIfNotExists: vi.fn(),
      findById: vi.fn(),
    } as any;

    mockQueueRepo = {
      enqueue: vi.fn(),
      markProcessing: vi.fn(),
    } as any;

    mockFilterService = {
      checkMessage: vi.fn(),
    } as any;

    mockMediaService = {
      downloadMedia: vi.fn(),
    } as any;

    mockProcessorService = {
      processMessage: vi.fn(),
      handleProcessingResult: vi.fn(),
    } as any;

    mockDeduplicationService = {
      isDuplicate: vi.fn().mockReturnValue({ isDuplicate: false }),
      getStats: vi.fn(),
      clear: vi.fn(),
      updateConfig: vi.fn(),
    } as any;

    // Set up identity service defaults
    mockIdentityService.resolveUser.mockResolvedValue({ id: 'unified-user-1' });
    mockIdentityService.resolveConversation.mockResolvedValue({ id: 'unified-conv-1' });

    // Create service instance
    ingestionService = new IngestionService(
      mockSenderRepo,
      mockChatRepo,
      mockMessageRepo,
      mockQueueRepo,
      mockFilterService,
      mockMediaService,
      mockProcessorService,
      mockDeduplicationService
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('ingestMessage', () => {
    it('should successfully ingest message with all data present', async () => {
      // Arrange
      const mockClient = createMockTelegramClient();
      const mockEvent = createMockEvent();
      const mockSender = createMockSender();
      const mockChat = createMockChat();
      const mockMessage = createMockMessage();
      const mockQueueItem = createMockQueueItem();

      vi.mocked(mockFilterService.checkMessage).mockResolvedValue({
        allowed: true,
        priority: 5,
        reason: 'Allowed chat',
      });

      vi.mocked(mockSenderRepo.upsert).mockResolvedValue(mockSender);
      vi.mocked(mockChatRepo.upsert).mockResolvedValue(mockChat);
      vi.mocked(mockMessageRepo.createIfNotExists).mockResolvedValue({
        message: mockMessage,
        created: true,
      });
      vi.mocked(mockQueueRepo.enqueue).mockResolvedValue(mockQueueItem);
      vi.mocked(mockQueueRepo.markProcessing).mockResolvedValue(true);
      vi.mocked(mockMessageRepo.findById).mockResolvedValue(mockMessage);
      vi.mocked(mockChatRepo.findById).mockResolvedValue(mockChat);
      vi.mocked(mockSenderRepo.findById).mockResolvedValue(mockSender);
      vi.mocked(mockProcessorService.processMessage).mockResolvedValue({
        success: true,
      });

      // Act
      await ingestionService.ingestMessage(mockClient, mockEvent);

      // Assert
      expect(mockFilterService.checkMessage).toHaveBeenCalledWith('67890');
      expect(mockSenderRepo.upsert).toHaveBeenCalledWith({
        telegramId: '12345',
        firstName: 'John',
        lastName: 'Doe',
        username: 'johndoe',
        phone: '+1234567890',
      });
      expect(mockChatRepo.upsert).toHaveBeenCalledWith({
        telegramId: '67890',
        type: 'group',
        title: 'Test Chat',
        username: 'testchat',
      });
      expect(mockMessageRepo.createIfNotExists).toHaveBeenCalled();
      expect(mockQueueRepo.enqueue).toHaveBeenCalledWith(mockMessage.id, 5);
      expect(mockQueueRepo.markProcessing).toHaveBeenCalledWith(
        mockQueueItem.id,
        mockQueueItem.version
      );
      expect(mockProcessorService.processMessage).toHaveBeenCalledWith(
        mockMessage,
        mockChat,
        mockSender,
        { userId: 'unified-user-1', conversationId: 'unified-conv-1' }
      );
      expect(mockProcessorService.handleProcessingResult).toHaveBeenCalledWith(
        mockQueueItem,
        { success: true }
      );
    });

    it('should skip messages without chat ID', async () => {
      // Arrange
      const mockClient = createMockTelegramClient();
      const mockEvent = createMockEvent({ chatId: null });

      // Act
      await ingestionService.ingestMessage(mockClient, mockEvent);

      // Assert
      expect(mockFilterService.checkMessage).not.toHaveBeenCalled();
      expect(mockSenderRepo.upsert).not.toHaveBeenCalled();
      expect(mockMessageRepo.createIfNotExists).not.toHaveBeenCalled();
    });

    it('should handle duplicate messages (created: false)', async () => {
      // Arrange
      const mockClient = createMockTelegramClient();
      const mockEvent = createMockEvent();
      const mockSender = createMockSender();
      const mockChat = createMockChat();
      const mockMessage = createMockMessage();

      vi.mocked(mockFilterService.checkMessage).mockResolvedValue({
        allowed: true,
        priority: 5,
        reason: 'Allowed chat',
      });

      vi.mocked(mockSenderRepo.upsert).mockResolvedValue(mockSender);
      vi.mocked(mockChatRepo.upsert).mockResolvedValue(mockChat);
      // Simulate duplicate message - created: false
      vi.mocked(mockMessageRepo.createIfNotExists).mockResolvedValue({
        message: mockMessage,
        created: false,
      });

      // Act
      await ingestionService.ingestMessage(mockClient, mockEvent);

      // Assert
      expect(mockMessageRepo.createIfNotExists).toHaveBeenCalled();
      // Should not enqueue or process duplicate messages
      expect(mockQueueRepo.enqueue).not.toHaveBeenCalled();
      expect(mockQueueRepo.markProcessing).not.toHaveBeenCalled();
      expect(mockProcessorService.processMessage).not.toHaveBeenCalled();
    });

    it('should respect filter blocking', async () => {
      // Arrange
      const mockClient = createMockTelegramClient();
      const mockEvent = createMockEvent();

      vi.mocked(mockFilterService.checkMessage).mockResolvedValue({
        allowed: false,
        priority: 0,
        reason: 'Blocked chat',
      });

      // Act
      await ingestionService.ingestMessage(mockClient, mockEvent);

      // Assert
      expect(mockFilterService.checkMessage).toHaveBeenCalledWith('67890');
      // Should not proceed with ingestion
      expect(mockSenderRepo.upsert).not.toHaveBeenCalled();
      expect(mockChatRepo.upsert).not.toHaveBeenCalled();
      expect(mockMessageRepo.createIfNotExists).not.toHaveBeenCalled();
    });

    it('should handle missing sender', async () => {
      // Arrange
      const mockClient = createMockTelegramClient();
      const mockEvent = createMockEvent({
        senderId: null,
        getSender: vi.fn().mockResolvedValue(null),
      });
      const mockChat = createMockChat();
      const mockMessage = createMockMessage({ senderId: null });
      const mockQueueItem = createMockQueueItem();

      vi.mocked(mockFilterService.checkMessage).mockResolvedValue({
        allowed: true,
        priority: 5,
        reason: 'Allowed chat',
      });

      vi.mocked(mockChatRepo.upsert).mockResolvedValue(mockChat);
      vi.mocked(mockMessageRepo.createIfNotExists).mockResolvedValue({
        message: mockMessage,
        created: true,
      });
      vi.mocked(mockQueueRepo.enqueue).mockResolvedValue(mockQueueItem);
      vi.mocked(mockQueueRepo.markProcessing).mockResolvedValue(true);
      vi.mocked(mockMessageRepo.findById).mockResolvedValue(mockMessage);
      vi.mocked(mockChatRepo.findById).mockResolvedValue(mockChat);
      vi.mocked(mockProcessorService.processMessage).mockResolvedValue({
        success: true,
      });

      // Act
      await ingestionService.ingestMessage(mockClient, mockEvent);

      // Assert
      // Should not attempt to upsert sender
      expect(mockSenderRepo.upsert).not.toHaveBeenCalled();
      // Should still proceed with chat and message
      expect(mockChatRepo.upsert).toHaveBeenCalled();
      expect(mockMessageRepo.createIfNotExists).toHaveBeenCalled();
      // Should process with null sender; userId is undefined (no sender), conversationId resolved
      expect(mockProcessorService.processMessage).toHaveBeenCalledWith(
        mockMessage,
        mockChat,
        null,
        { userId: undefined, conversationId: 'unified-conv-1' }
      );
    });

    it('should download and store media when present', async () => {
      // Arrange
      const mockClient = createMockTelegramClient();
      const mockEvent = createMockEvent({
        media: { _: 'messageMediaDocument' },
      });
      const mockSender = createMockSender();
      const mockChat = createMockChat();
      const mockMessage = createMockMessage({
        mediaType: 'document',
        mediaPath: '/path/to/media.pdf',
        mediaFileId: 'file-123',
      });
      const mockQueueItem = createMockQueueItem();

      vi.mocked(mockFilterService.checkMessage).mockResolvedValue({
        allowed: true,
        priority: 5,
        reason: 'Allowed chat',
      });

      vi.mocked(mockSenderRepo.upsert).mockResolvedValue(mockSender);
      vi.mocked(mockChatRepo.upsert).mockResolvedValue(mockChat);
      vi.mocked(mockMediaService.downloadMedia).mockResolvedValue({
        mediaType: 'document',
        mediaPath: '/path/to/media.pdf',
        mediaFileId: 'file-123',
      });
      vi.mocked(mockMessageRepo.createIfNotExists).mockResolvedValue({
        message: mockMessage,
        created: true,
      });
      vi.mocked(mockQueueRepo.enqueue).mockResolvedValue(mockQueueItem);
      vi.mocked(mockQueueRepo.markProcessing).mockResolvedValue(true);
      vi.mocked(mockMessageRepo.findById).mockResolvedValue(mockMessage);
      vi.mocked(mockChatRepo.findById).mockResolvedValue(mockChat);
      vi.mocked(mockSenderRepo.findById).mockResolvedValue(mockSender);
      vi.mocked(mockProcessorService.processMessage).mockResolvedValue({
        success: true,
      });

      // Act
      await ingestionService.ingestMessage(mockClient, mockEvent);

      // Assert
      expect(mockMediaService.downloadMedia).toHaveBeenCalledWith(
        mockClient,
        mockEvent.message
      );
      expect(mockMessageRepo.createIfNotExists).toHaveBeenCalledWith(
        expect.objectContaining({
          mediaType: 'document',
          mediaPath: '/path/to/media.pdf',
          mediaFileId: 'file-123',
        })
      );
    });

    it('should handle errors gracefully', async () => {
      // Arrange
      const mockClient = createMockTelegramClient();
      const mockEvent = createMockEvent();

      vi.mocked(mockFilterService.checkMessage).mockRejectedValue(
        new Error('Filter service error')
      );

      // Act
      await ingestionService.ingestMessage(mockClient, mockEvent);

      // Assert - should not throw, error is logged internally
      expect(mockFilterService.checkMessage).toHaveBeenCalled();
      expect(mockSenderRepo.upsert).not.toHaveBeenCalled();
    });

    it('should skip message when message object is null', async () => {
      // Arrange
      const mockClient = createMockTelegramClient();
      const mockEvent = { message: null } as any;

      // Act
      await ingestionService.ingestMessage(mockClient, mockEvent);

      // Assert
      expect(mockFilterService.checkMessage).not.toHaveBeenCalled();
      expect(mockSenderRepo.upsert).not.toHaveBeenCalled();
    });

    it('should detect chat type as channel for broadcast chats', async () => {
      // Arrange
      const mockClient = createMockTelegramClient();
      const mockEvent = createMockEvent();
      const mockSender = createMockSender();
      const mockChat = createMockChat({ type: 'channel' });
      const mockMessage = createMockMessage();
      const mockQueueItem = createMockQueueItem();

      mockEvent.message.getChat = vi.fn().mockResolvedValue({
        broadcast: true,
        title: 'Test Channel',
        username: 'testchannel',
      });

      vi.mocked(mockFilterService.checkMessage).mockResolvedValue({
        allowed: true,
        priority: 5,
        reason: 'Allowed chat',
      });

      vi.mocked(mockSenderRepo.upsert).mockResolvedValue(mockSender);
      vi.mocked(mockChatRepo.upsert).mockResolvedValue(mockChat);
      vi.mocked(mockMessageRepo.createIfNotExists).mockResolvedValue({
        message: mockMessage,
        created: true,
      });
      vi.mocked(mockQueueRepo.enqueue).mockResolvedValue(mockQueueItem);
      vi.mocked(mockQueueRepo.markProcessing).mockResolvedValue(true);
      vi.mocked(mockMessageRepo.findById).mockResolvedValue(mockMessage);
      vi.mocked(mockChatRepo.findById).mockResolvedValue(mockChat);
      vi.mocked(mockSenderRepo.findById).mockResolvedValue(mockSender);
      vi.mocked(mockProcessorService.processMessage).mockResolvedValue({
        success: true,
      });

      // Act
      await ingestionService.ingestMessage(mockClient, mockEvent);

      // Assert
      expect(mockChatRepo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'channel',
        })
      );
    });

    it('should call identityService.resolveUser with telegram sender metadata', async () => {
      // Arrange
      const mockClient = createMockTelegramClient();
      const mockEvent = createMockEvent();
      const mockSender = createMockSender();
      const mockChat = createMockChat();
      const mockMessage = createMockMessage();
      const mockQueueItem = createMockQueueItem();

      vi.mocked(mockFilterService.checkMessage).mockResolvedValue({ allowed: true, priority: 0, reason: 'ok' });
      vi.mocked(mockSenderRepo.upsert).mockResolvedValue(mockSender);
      vi.mocked(mockChatRepo.upsert).mockResolvedValue(mockChat);
      vi.mocked(mockMessageRepo.createIfNotExists).mockResolvedValue({ message: mockMessage, created: true });
      vi.mocked(mockQueueRepo.enqueue).mockResolvedValue(mockQueueItem);
      vi.mocked(mockQueueRepo.markProcessing).mockResolvedValue(true);
      vi.mocked(mockMessageRepo.findById).mockResolvedValue(mockMessage);
      vi.mocked(mockChatRepo.findById).mockResolvedValue(mockChat);
      vi.mocked(mockSenderRepo.findById).mockResolvedValue(mockSender);
      vi.mocked(mockProcessorService.processMessage).mockResolvedValue({ success: true });

      // Act
      await ingestionService.ingestMessage(mockClient, mockEvent);

      // Assert
      expect(mockIdentityService.resolveUser).toHaveBeenCalledWith(
        'telegram',
        '12345',
        expect.objectContaining({
          firstName: 'John',
          lastName: 'Doe',
          username: 'johndoe',
        })
      );
    });

    it('should call identityService.resolveConversation with mapped chat type', async () => {
      // Arrange
      const mockClient = createMockTelegramClient();
      const mockEvent = createMockEvent();
      const mockSender = createMockSender();
      const mockChat = createMockChat();
      const mockMessage = createMockMessage();
      const mockQueueItem = createMockQueueItem();

      vi.mocked(mockFilterService.checkMessage).mockResolvedValue({ allowed: true, priority: 0, reason: 'ok' });
      vi.mocked(mockSenderRepo.upsert).mockResolvedValue(mockSender);
      vi.mocked(mockChatRepo.upsert).mockResolvedValue(mockChat);
      vi.mocked(mockMessageRepo.createIfNotExists).mockResolvedValue({ message: mockMessage, created: true });
      vi.mocked(mockQueueRepo.enqueue).mockResolvedValue(mockQueueItem);
      vi.mocked(mockQueueRepo.markProcessing).mockResolvedValue(true);
      vi.mocked(mockMessageRepo.findById).mockResolvedValue(mockMessage);
      vi.mocked(mockChatRepo.findById).mockResolvedValue(mockChat);
      vi.mocked(mockSenderRepo.findById).mockResolvedValue(mockSender);
      vi.mocked(mockProcessorService.processMessage).mockResolvedValue({ success: true });

      // Act
      await ingestionService.ingestMessage(mockClient, mockEvent);

      // Assert — Telegram 'group' type (from broadcast:false, megagroup:false) maps to 'group' ConversationType
      expect(mockIdentityService.resolveConversation).toHaveBeenCalledWith(
        'telegram',
        '67890',
        'group',
        { title: 'Test Chat' }
      );
    });

    it('should map supergroup chat type to group ConversationType', async () => {
      // Arrange
      const mockClient = createMockTelegramClient();
      const mockEvent = createMockEvent();
      const mockSender = createMockSender();
      const mockChat = createMockChat({ type: 'supergroup' });
      const mockMessage = createMockMessage();
      const mockQueueItem = createMockQueueItem();

      mockEvent.message.getChat = vi.fn().mockResolvedValue({
        broadcast: false,
        megagroup: true,
        title: 'Test Supergroup',
        username: 'testsupergroup',
      });

      vi.mocked(mockFilterService.checkMessage).mockResolvedValue({ allowed: true, priority: 0, reason: 'ok' });
      vi.mocked(mockSenderRepo.upsert).mockResolvedValue(mockSender);
      vi.mocked(mockChatRepo.upsert).mockResolvedValue(mockChat);
      vi.mocked(mockMessageRepo.createIfNotExists).mockResolvedValue({ message: mockMessage, created: true });
      vi.mocked(mockQueueRepo.enqueue).mockResolvedValue(mockQueueItem);
      vi.mocked(mockQueueRepo.markProcessing).mockResolvedValue(true);
      vi.mocked(mockMessageRepo.findById).mockResolvedValue(mockMessage);
      vi.mocked(mockChatRepo.findById).mockResolvedValue(mockChat);
      vi.mocked(mockSenderRepo.findById).mockResolvedValue(mockSender);
      vi.mocked(mockProcessorService.processMessage).mockResolvedValue({ success: true });

      // Act
      await ingestionService.ingestMessage(mockClient, mockEvent);

      // Assert — 'supergroup' maps to 'group' in unified model
      expect(mockIdentityService.resolveConversation).toHaveBeenCalledWith(
        'telegram',
        '67890',
        'group',
        { title: 'Test Supergroup' }
      );
    });

    it('should map channel chat type to channel ConversationType', async () => {
      // Arrange
      const mockClient = createMockTelegramClient();
      const mockEvent = createMockEvent();
      const mockSender = createMockSender();
      const mockChat = createMockChat({ type: 'channel' });
      const mockMessage = createMockMessage();
      const mockQueueItem = createMockQueueItem();

      mockEvent.message.getChat = vi.fn().mockResolvedValue({
        broadcast: true,
        title: 'Test Channel',
        username: 'testchannel',
      });

      vi.mocked(mockFilterService.checkMessage).mockResolvedValue({ allowed: true, priority: 0, reason: 'ok' });
      vi.mocked(mockSenderRepo.upsert).mockResolvedValue(mockSender);
      vi.mocked(mockChatRepo.upsert).mockResolvedValue(mockChat);
      vi.mocked(mockMessageRepo.createIfNotExists).mockResolvedValue({ message: mockMessage, created: true });
      vi.mocked(mockQueueRepo.enqueue).mockResolvedValue(mockQueueItem);
      vi.mocked(mockQueueRepo.markProcessing).mockResolvedValue(true);
      vi.mocked(mockMessageRepo.findById).mockResolvedValue(mockMessage);
      vi.mocked(mockChatRepo.findById).mockResolvedValue(mockChat);
      vi.mocked(mockSenderRepo.findById).mockResolvedValue(mockSender);
      vi.mocked(mockProcessorService.processMessage).mockResolvedValue({ success: true });

      // Act
      await ingestionService.ingestMessage(mockClient, mockEvent);

      // Assert
      expect(mockIdentityService.resolveConversation).toHaveBeenCalledWith(
        'telegram',
        '67890',
        'channel',
        { title: 'Test Channel' }
      );
    });

    it('should pass resolved userId and conversationId to processImmediately', async () => {
      // Arrange
      const mockClient = createMockTelegramClient();
      const mockEvent = createMockEvent();
      const mockSender = createMockSender();
      const mockChat = createMockChat();
      const mockMessage = createMockMessage();
      const mockQueueItem = createMockQueueItem();

      mockIdentityService.resolveUser.mockResolvedValue({ id: 'uid-abc' });
      mockIdentityService.resolveConversation.mockResolvedValue({ id: 'cid-xyz' });

      vi.mocked(mockFilterService.checkMessage).mockResolvedValue({ allowed: true, priority: 0, reason: 'ok' });
      vi.mocked(mockSenderRepo.upsert).mockResolvedValue(mockSender);
      vi.mocked(mockChatRepo.upsert).mockResolvedValue(mockChat);
      vi.mocked(mockMessageRepo.createIfNotExists).mockResolvedValue({ message: mockMessage, created: true });
      vi.mocked(mockQueueRepo.enqueue).mockResolvedValue(mockQueueItem);
      vi.mocked(mockQueueRepo.markProcessing).mockResolvedValue(true);
      vi.mocked(mockMessageRepo.findById).mockResolvedValue(mockMessage);
      vi.mocked(mockChatRepo.findById).mockResolvedValue(mockChat);
      vi.mocked(mockSenderRepo.findById).mockResolvedValue(mockSender);
      vi.mocked(mockProcessorService.processMessage).mockResolvedValue({ success: true });

      // Act
      await ingestionService.ingestMessage(mockClient, mockEvent);

      // Assert — unified IDs passed through to processor
      expect(mockProcessorService.processMessage).toHaveBeenCalledWith(
        mockMessage,
        mockChat,
        mockSender,
        { userId: 'uid-abc', conversationId: 'cid-xyz' }
      );
    });

    it('should continue processing when identity resolution fails (graceful degradation)', async () => {
      // Arrange
      const mockClient = createMockTelegramClient();
      const mockEvent = createMockEvent();
      const mockSender = createMockSender();
      const mockChat = createMockChat();
      const mockMessage = createMockMessage();
      const mockQueueItem = createMockQueueItem();

      // Identity resolution throws
      mockIdentityService.resolveUser.mockRejectedValue(new Error('DB connection failed'));

      vi.mocked(mockFilterService.checkMessage).mockResolvedValue({ allowed: true, priority: 0, reason: 'ok' });
      vi.mocked(mockSenderRepo.upsert).mockResolvedValue(mockSender);
      vi.mocked(mockChatRepo.upsert).mockResolvedValue(mockChat);
      vi.mocked(mockMessageRepo.createIfNotExists).mockResolvedValue({ message: mockMessage, created: true });
      vi.mocked(mockQueueRepo.enqueue).mockResolvedValue(mockQueueItem);
      vi.mocked(mockQueueRepo.markProcessing).mockResolvedValue(true);
      vi.mocked(mockMessageRepo.findById).mockResolvedValue(mockMessage);
      vi.mocked(mockChatRepo.findById).mockResolvedValue(mockChat);
      vi.mocked(mockSenderRepo.findById).mockResolvedValue(mockSender);
      vi.mocked(mockProcessorService.processMessage).mockResolvedValue({ success: true });

      // Act
      await ingestionService.ingestMessage(mockClient, mockEvent);

      // Assert — message still processed despite identity resolution failure
      expect(mockMessageRepo.createIfNotExists).toHaveBeenCalled();
      expect(mockQueueRepo.enqueue).toHaveBeenCalled();
      expect(mockProcessorService.processMessage).toHaveBeenCalledWith(
        mockMessage,
        mockChat,
        mockSender,
        { userId: undefined, conversationId: undefined }
      );
    });

    it('should still perform legacy sender/chat upserts (dual-write)', async () => {
      // Arrange
      const mockClient = createMockTelegramClient();
      const mockEvent = createMockEvent();
      const mockSender = createMockSender();
      const mockChat = createMockChat();
      const mockMessage = createMockMessage();
      const mockQueueItem = createMockQueueItem();

      vi.mocked(mockFilterService.checkMessage).mockResolvedValue({ allowed: true, priority: 0, reason: 'ok' });
      vi.mocked(mockSenderRepo.upsert).mockResolvedValue(mockSender);
      vi.mocked(mockChatRepo.upsert).mockResolvedValue(mockChat);
      vi.mocked(mockMessageRepo.createIfNotExists).mockResolvedValue({ message: mockMessage, created: true });
      vi.mocked(mockQueueRepo.enqueue).mockResolvedValue(mockQueueItem);
      vi.mocked(mockQueueRepo.markProcessing).mockResolvedValue(true);
      vi.mocked(mockMessageRepo.findById).mockResolvedValue(mockMessage);
      vi.mocked(mockChatRepo.findById).mockResolvedValue(mockChat);
      vi.mocked(mockSenderRepo.findById).mockResolvedValue(mockSender);
      vi.mocked(mockProcessorService.processMessage).mockResolvedValue({ success: true });

      // Act
      await ingestionService.ingestMessage(mockClient, mockEvent);

      // Assert — legacy upserts still happen alongside identity resolution
      expect(mockSenderRepo.upsert).toHaveBeenCalled();
      expect(mockChatRepo.upsert).toHaveBeenCalled();
      expect(mockIdentityService.resolveUser).toHaveBeenCalled();
      expect(mockIdentityService.resolveConversation).toHaveBeenCalled();
    });

    it('should detect chat type as supergroup for megagroups', async () => {
      // Arrange
      const mockClient = createMockTelegramClient();
      const mockEvent = createMockEvent();
      const mockSender = createMockSender();
      const mockChat = createMockChat({ type: 'supergroup' });
      const mockMessage = createMockMessage();
      const mockQueueItem = createMockQueueItem();

      mockEvent.message.getChat = vi.fn().mockResolvedValue({
        broadcast: false,
        megagroup: true,
        title: 'Test Supergroup',
        username: 'testsupergroup',
      });

      vi.mocked(mockFilterService.checkMessage).mockResolvedValue({
        allowed: true,
        priority: 5,
        reason: 'Allowed chat',
      });

      vi.mocked(mockSenderRepo.upsert).mockResolvedValue(mockSender);
      vi.mocked(mockChatRepo.upsert).mockResolvedValue(mockChat);
      vi.mocked(mockMessageRepo.createIfNotExists).mockResolvedValue({
        message: mockMessage,
        created: true,
      });
      vi.mocked(mockQueueRepo.enqueue).mockResolvedValue(mockQueueItem);
      vi.mocked(mockQueueRepo.markProcessing).mockResolvedValue(true);
      vi.mocked(mockMessageRepo.findById).mockResolvedValue(mockMessage);
      vi.mocked(mockChatRepo.findById).mockResolvedValue(mockChat);
      vi.mocked(mockSenderRepo.findById).mockResolvedValue(mockSender);
      vi.mocked(mockProcessorService.processMessage).mockResolvedValue({
        success: true,
      });

      // Act
      await ingestionService.ingestMessage(mockClient, mockEvent);

      // Assert
      expect(mockChatRepo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'supergroup',
        })
      );
    });
  });

  describe('processImmediately', () => {
    it('should process message successfully', async () => {
      // Arrange
      const mockQueueItem = createMockQueueItem();
      const mockMessage = createMockMessage();
      const mockChat = createMockChat();
      const mockSender = createMockSender();

      vi.mocked(mockQueueRepo.markProcessing).mockResolvedValue(true);
      vi.mocked(mockMessageRepo.findById).mockResolvedValue(mockMessage);
      vi.mocked(mockChatRepo.findById).mockResolvedValue(mockChat);
      vi.mocked(mockSenderRepo.findById).mockResolvedValue(mockSender);
      vi.mocked(mockProcessorService.processMessage).mockResolvedValue({
        success: true,
      });

      // Act
      await ingestionService.processImmediately(mockQueueItem);

      // Assert
      expect(mockQueueRepo.markProcessing).toHaveBeenCalledWith(
        mockQueueItem.id,
        mockQueueItem.version
      );
      expect(mockMessageRepo.findById).toHaveBeenCalledWith(mockQueueItem.messageId);
      expect(mockChatRepo.findById).toHaveBeenCalledWith(mockMessage.chatId);
      expect(mockSenderRepo.findById).toHaveBeenCalledWith(mockMessage.senderId);
      expect(mockProcessorService.processMessage).toHaveBeenCalledWith(
        mockMessage,
        mockChat,
        mockSender,
        { userId: undefined, conversationId: undefined }
      );
      expect(mockProcessorService.handleProcessingResult).toHaveBeenCalledWith(
        mockQueueItem,
        { success: true }
      );
    });

    it('should handle race condition (markProcessing returns false)', async () => {
      // Arrange
      const mockQueueItem = createMockQueueItem();

      vi.mocked(mockQueueRepo.markProcessing).mockResolvedValue(false);

      // Act
      await ingestionService.processImmediately(mockQueueItem);

      // Assert
      expect(mockQueueRepo.markProcessing).toHaveBeenCalledWith(
        mockQueueItem.id,
        mockQueueItem.version
      );
      // Should not proceed with processing
      expect(mockMessageRepo.findById).not.toHaveBeenCalled();
      expect(mockProcessorService.processMessage).not.toHaveBeenCalled();
      expect(mockProcessorService.handleProcessingResult).not.toHaveBeenCalled();
    });

    it('should handle missing message', async () => {
      // Arrange
      const mockQueueItem = createMockQueueItem();

      vi.mocked(mockQueueRepo.markProcessing).mockResolvedValue(true);
      vi.mocked(mockMessageRepo.findById).mockResolvedValue(null);

      // Act
      await ingestionService.processImmediately(mockQueueItem);

      // Assert
      expect(mockMessageRepo.findById).toHaveBeenCalledWith(mockQueueItem.messageId);
      expect(mockProcessorService.handleProcessingResult).toHaveBeenCalledWith(
        mockQueueItem,
        expect.objectContaining({
          success: false,
          error: expect.stringContaining('Message not found'),
        })
      );
    });

    it('should handle missing chat', async () => {
      // Arrange
      const mockQueueItem = createMockQueueItem();
      const mockMessage = createMockMessage();

      vi.mocked(mockQueueRepo.markProcessing).mockResolvedValue(true);
      vi.mocked(mockMessageRepo.findById).mockResolvedValue(mockMessage);
      vi.mocked(mockChatRepo.findById).mockResolvedValue(null);

      // Act
      await ingestionService.processImmediately(mockQueueItem);

      // Assert
      expect(mockChatRepo.findById).toHaveBeenCalledWith(mockMessage.chatId);
      expect(mockProcessorService.handleProcessingResult).toHaveBeenCalledWith(
        mockQueueItem,
        expect.objectContaining({
          success: false,
          error: expect.stringContaining('Chat not found'),
        })
      );
    });

    it('should process message with null sender', async () => {
      // Arrange
      const mockQueueItem = createMockQueueItem();
      const mockMessage = createMockMessage({ senderId: null });
      const mockChat = createMockChat();

      vi.mocked(mockQueueRepo.markProcessing).mockResolvedValue(true);
      vi.mocked(mockMessageRepo.findById).mockResolvedValue(mockMessage);
      vi.mocked(mockChatRepo.findById).mockResolvedValue(mockChat);
      vi.mocked(mockProcessorService.processMessage).mockResolvedValue({
        success: true,
      });

      // Act
      await ingestionService.processImmediately(mockQueueItem);

      // Assert
      expect(mockSenderRepo.findById).not.toHaveBeenCalled();
      expect(mockProcessorService.processMessage).toHaveBeenCalledWith(
        mockMessage,
        mockChat,
        null,
        { userId: undefined, conversationId: undefined }
      );
    });

    it('should handle processor service errors', async () => {
      // Arrange
      const mockQueueItem = createMockQueueItem();
      const mockMessage = createMockMessage();
      const mockChat = createMockChat();
      const mockSender = createMockSender();
      const processorError = new Error('Processor failed');

      vi.mocked(mockQueueRepo.markProcessing).mockResolvedValue(true);
      vi.mocked(mockMessageRepo.findById).mockResolvedValue(mockMessage);
      vi.mocked(mockChatRepo.findById).mockResolvedValue(mockChat);
      vi.mocked(mockSenderRepo.findById).mockResolvedValue(mockSender);
      vi.mocked(mockProcessorService.processMessage).mockRejectedValue(processorError);

      // Act
      await ingestionService.processImmediately(mockQueueItem);

      // Assert
      expect(mockProcessorService.processMessage).toHaveBeenCalled();
      expect(mockProcessorService.handleProcessingResult).toHaveBeenCalledWith(
        mockQueueItem,
        expect.objectContaining({
          success: false,
          error: 'Processor failed',
        })
      );
    });

    it('should handle non-Error exceptions', async () => {
      // Arrange
      const mockQueueItem = createMockQueueItem();
      const mockMessage = createMockMessage();
      const mockChat = createMockChat();
      const mockSender = createMockSender();

      vi.mocked(mockQueueRepo.markProcessing).mockResolvedValue(true);
      vi.mocked(mockMessageRepo.findById).mockResolvedValue(mockMessage);
      vi.mocked(mockChatRepo.findById).mockResolvedValue(mockChat);
      vi.mocked(mockSenderRepo.findById).mockResolvedValue(mockSender);
      vi.mocked(mockProcessorService.processMessage).mockRejectedValue('String error');

      // Act
      await ingestionService.processImmediately(mockQueueItem);

      // Assert
      expect(mockProcessorService.handleProcessingResult).toHaveBeenCalledWith(
        mockQueueItem,
        expect.objectContaining({
          success: false,
          error: 'Unknown error',
        })
      );
    });

    it('should handle processor returning failure result', async () => {
      // Arrange
      const mockQueueItem = createMockQueueItem();
      const mockMessage = createMockMessage();
      const mockChat = createMockChat();
      const mockSender = createMockSender();

      vi.mocked(mockQueueRepo.markProcessing).mockResolvedValue(true);
      vi.mocked(mockMessageRepo.findById).mockResolvedValue(mockMessage);
      vi.mocked(mockChatRepo.findById).mockResolvedValue(mockChat);
      vi.mocked(mockSenderRepo.findById).mockResolvedValue(mockSender);
      vi.mocked(mockProcessorService.processMessage).mockResolvedValue({
        success: false,
        error: 'Processing failed',
        shouldRetry: true,
      });

      // Act
      await ingestionService.processImmediately(mockQueueItem);

      // Assert
      expect(mockProcessorService.handleProcessingResult).toHaveBeenCalledWith(
        mockQueueItem,
        expect.objectContaining({
          success: false,
          error: 'Processing failed',
          shouldRetry: true,
        })
      );
    });
  });
});
