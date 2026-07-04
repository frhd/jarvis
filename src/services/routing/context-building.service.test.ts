import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContextBuildingService } from './context-building.service.js';
import type { Message, Sender } from '../../types/index.js';
import type { ContextManagerService } from '../contextManager.service.js';
import type { UserPreferenceService } from '../userPreference.service.js';

// ============================================================================
// Helpers
// ============================================================================

const createMockMessage = (overrides?: Partial<Message>): Message => ({
  id: 'msg-1',
  chatId: 'chat-1',
  senderId: 'sender-1',
  telegramMessageId: 1,
  text: 'Hello',
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

// ============================================================================
// Tests
// ============================================================================

describe('ContextBuildingService', () => {
  let service: ContextBuildingService;
  let mockContextManager: Partial<ContextManagerService>;
  let mockUserPreferenceService: Partial<UserPreferenceService>;

  beforeEach(() => {
    mockContextManager = {
      buildContext: vi.fn().mockResolvedValue({
        context: 'RAG context',
        items: [],
        debug: {
          query: 'test',
          totalCandidates: 0,
          selectedItems: 0,
          tokenBudget: 1000,
          tokensUsed: 100,
          sources: {
            messages: 0,
            memories: 0,
            summaries: 0,
            preferences: 0,
          },
          timings: {
            embeddingMs: 10,
            retrievalMs: 20,
            scoringMs: 5,
            totalMs: 35,
          },
        },
      }),
    };

    mockUserPreferenceService = {
      buildContextString: vi.fn().mockResolvedValue('User preferences'),
    };

    service = new ContextBuildingService(
      mockContextManager as ContextManagerService,
      mockUserPreferenceService as UserPreferenceService
    );
  });

  describe('buildClassificationContext', () => {
    it('should build context from recent messages', () => {
      const history: Message[] = [
        createMockMessage({ text: 'Message 3', isBot: false }),
        createMockMessage({ text: 'Message 2', isBot: true }),
        createMockMessage({ text: 'Message 1', isBot: false }),
      ];

      const context = service.buildClassificationContext(history);

      expect(context).toBe(
        'User: Message 1\nAssistant: Message 2\nUser: Message 3'
      );
    });

    it('should handle empty history', () => {
      const context = service.buildClassificationContext([]);
      expect(context).toBe('');
    });

    it('should limit to 5 messages', () => {
      const history: Message[] = Array.from({ length: 10 }, (_, i) =>
        createMockMessage({ text: `Message ${i + 1}` })
      );

      const context = service.buildClassificationContext(history);
      const lines = context.split('\n');

      expect(lines).toHaveLength(5);
    });

    it('should handle messages without text', () => {
      const history: Message[] = [
        createMockMessage({ text: null }),
        createMockMessage({ text: 'Message with text' }),
      ];

      const context = service.buildClassificationContext(history);

      expect(context).toContain('[no text]');
      expect(context).toContain('Message with text');
    });
  });

  describe('buildConversationContext', () => {
    it('should build context with user preferences', async () => {
      const history: Message[] = [
        createMockMessage({ text: 'Hello' }),
      ];
      const sender = createMockSender();

      const context = await service.buildConversationContext(history, sender);

      expect(context).toContain('User preferences');
      expect(context).toContain('User: Hello');
      expect(mockUserPreferenceService.buildContextString).toHaveBeenCalledWith('sender-1');
    });

    it('should work without user preferences', async () => {
      service = new ContextBuildingService(null, null);
      const history: Message[] = [
        createMockMessage({ text: 'Hello' }),
      ];

      const context = await service.buildConversationContext(history, null);

      expect(context).toBe('User: Hello');
    });

    it('should handle preference service errors', async () => {
      mockUserPreferenceService.buildContextString = vi.fn().mockRejectedValue(
        new Error('Preferences error')
      );
      const history: Message[] = [
        createMockMessage({ text: 'Hello' }),
      ];
      const sender = createMockSender();

      const context = await service.buildConversationContext(history, sender);

      expect(context).toBe('User: Hello');
      expect(context).not.toContain('User preferences');
    });

    it('should respect context window size', async () => {
      const history: Message[] = Array.from({ length: 20 }, (_, i) =>
        createMockMessage({ text: `Message ${i + 1}` })
      );

      const context = await service.buildConversationContext(history, null, 5);
      const lines = context.split('\n\n');

      expect(lines).toHaveLength(5);
    });
  });

  describe('buildRAGContext', () => {
    it('should build RAG context when context manager is available', async () => {
      const result = await service.buildRAGContext('test query', {
        senderId: 'sender-1',
        chatId: 'chat-1',
        maxTokens: 1000,
        recentMessageCount: 10,
      });

      expect(result).toBeDefined();
      expect(result?.context).toBe('RAG context');
      expect(mockContextManager.buildContext).toHaveBeenCalledWith('test query', {
        senderId: 'sender-1',
        chatId: 'chat-1',
        maxTokens: 1000,
        recentMessageCount: 10,
      });
    });

    it('should return null when context manager is not available', async () => {
      service = new ContextBuildingService(null, null);

      const result = await service.buildRAGContext('test query', {});

      expect(result).toBeNull();
    });

    it('should return null on RAG errors', async () => {
      mockContextManager.buildContext = vi.fn().mockRejectedValue(
        new Error('RAG error')
      );

      const result = await service.buildRAGContext('test query', {});

      expect(result).toBeNull();
    });
  });

  describe('buildChatMessages', () => {
    it('should build chat messages with system prompt', async () => {
      const history: Message[] = [
        createMockMessage({ text: 'Previous message', isBot: true }),
      ];
      const currentMessage = createMockMessage({ text: 'Current message' });
      const sender = createMockSender();

      const messages = await service.buildChatMessages(
        history,
        currentMessage,
        sender,
        'You are a helpful assistant'
      );

      expect(messages).toHaveLength(3);
      expect(messages[0]).toEqual({
        role: 'system',
        content: expect.stringContaining('You are a helpful assistant'),
      });
      expect(messages[0].content).toContain('User preferences');
      expect(messages[1]).toEqual({
        role: 'assistant',
        content: 'Previous message',
      });
      expect(messages[2]).toEqual({
        role: 'user',
        content: 'Current message',
      });
    });

    it('should work without preferences', async () => {
      service = new ContextBuildingService(null, null);
      const currentMessage = createMockMessage({ text: 'Hello' });

      const messages = await service.buildChatMessages(
        [],
        currentMessage,
        null,
        'System prompt'
      );

      expect(messages).toHaveLength(2);
      expect(messages[0]).toEqual({
        role: 'system',
        content: 'System prompt',
      });
      expect(messages[1]).toEqual({
        role: 'user',
        content: 'Hello',
      });
    });

    it('should reverse history to chronological order', async () => {
      const history: Message[] = [
        createMockMessage({ text: 'Message 3', isBot: false }),
        createMockMessage({ text: 'Message 2', isBot: true }),
        createMockMessage({ text: 'Message 1', isBot: false }),
      ];
      const currentMessage = createMockMessage({ text: 'Current' });

      const messages = await service.buildChatMessages(
        history,
        currentMessage,
        null,
        'System'
      );

      expect(messages[1].content).toBe('Message 1');
      expect(messages[2].content).toBe('Message 2');
      expect(messages[3].content).toBe('Message 3');
      expect(messages[4].content).toBe('Current');
    });

    it('should skip messages without text', async () => {
      const history: Message[] = [
        createMockMessage({ text: null }),
        createMockMessage({ text: 'Valid message' }),
      ];
      const currentMessage = createMockMessage({ text: 'Current' });

      const messages = await service.buildChatMessages(
        history,
        currentMessage,
        null,
        'System'
      );

      expect(messages).toHaveLength(3); // system + 1 history + current
      expect(messages[1].content).toBe('Valid message');
    });

    it('should respect context window size', async () => {
      const history: Message[] = Array.from({ length: 20 }, (_, i) =>
        createMockMessage({ text: `Message ${i + 1}` })
      );
      const currentMessage = createMockMessage({ text: 'Current' });

      const messages = await service.buildChatMessages(
        history,
        currentMessage,
        null,
        'System',
        5
      );

      // system + 5 history + current = 7
      expect(messages).toHaveLength(7);
    });
  });
});
