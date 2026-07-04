import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContextManagerService } from './contextManager.service.js';
import type { EmbeddingClient } from '../clients/embedding.client.js';
import type { EmbeddingRepository } from '../repositories/embedding.repository.js';
import type { MemoryRepository, Memory } from '../repositories/memory.repository.js';
import type { MessageRepository } from '../repositories/message.repository.js';
import type { ConversationSummaryRepository } from '../repositories/conversationSummary.repository.js';
import type { UserPreferenceService } from './userPreference.service.js';

// ============================================================================
// Mock Config
// ============================================================================

vi.mock('../config/index.js', () => ({
  appConfig: {
    rag: {
      enabled: true,
      maxContextTokens: 2000,
      recentMessagesCount: 10,
      similarityThreshold: 0.5,
      topK: 5,
      recencyDecayHours: 168,
    },
    memory: { enabled: true },
    embedding: { enabled: true },
  },
}));

vi.mock('../utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ============================================================================
// Helpers
// ============================================================================

const createMemory = (overrides?: Partial<Memory>): Memory => ({
  id: 'mem-1',
  senderId: null,
  chatId: null,
  userId: null,
  conversationId: null,
  memoryType: 'fact',
  content: 'Test memory content',
  confidence: 80,
  sourceMessageIds: '[]',
  lastAccessedAt: new Date(),
  accessCount: 0,
  isArchived: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

// ============================================================================
// Tests
// ============================================================================

describe('ContextManagerService', () => {
  let service: ContextManagerService;
  let mockEmbeddingClient: { embed: ReturnType<typeof vi.fn> };
  let mockEmbeddingRepo: { findSimilar: ReturnType<typeof vi.fn> };
  let mockMemoryRepo: {
    findById: ReturnType<typeof vi.fn>;
    findBySenderId: ReturnType<typeof vi.fn>;
    findByUserId: ReturnType<typeof vi.fn>;
    findActiveForUser: ReturnType<typeof vi.fn>;
    findByConversationId: ReturnType<typeof vi.fn>;
    findByUserAndConversation: ReturnType<typeof vi.fn>;
  };
  let mockMessageRepo: { findRecentByChatId: ReturnType<typeof vi.fn> };
  let mockSummaryRepo: { findByChatId: ReturnType<typeof vi.fn> };
  let mockUserPrefService: { buildContextString: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockEmbeddingClient = {
      embed: vi.fn().mockResolvedValue({ embedding: [0.1, 0.2, 0.3] }),
    };
    mockEmbeddingRepo = {
      findSimilar: vi.fn().mockResolvedValue([]),
    };
    mockMemoryRepo = {
      findById: vi.fn().mockResolvedValue(null),
      findBySenderId: vi.fn().mockResolvedValue([]),
      findByUserId: vi.fn().mockResolvedValue([]),
      findActiveForUser: vi.fn().mockResolvedValue([]),
      findByConversationId: vi.fn().mockResolvedValue([]),
      findByUserAndConversation: vi.fn().mockResolvedValue([]),
    };
    mockMessageRepo = {
      findRecentByChatId: vi.fn().mockResolvedValue([]),
    };
    mockSummaryRepo = {
      findByChatId: vi.fn().mockResolvedValue([]),
    };
    mockUserPrefService = {
      buildContextString: vi.fn().mockResolvedValue(''),
    };

    service = new ContextManagerService(
      mockEmbeddingClient as unknown as EmbeddingClient,
      mockEmbeddingRepo as unknown as EmbeddingRepository,
      mockMemoryRepo as unknown as MemoryRepository,
      mockMessageRepo as unknown as MessageRepository,
      mockSummaryRepo as unknown as ConversationSummaryRepository,
      mockUserPrefService as unknown as UserPreferenceService,
    );
  });

  // ==========================================================================
  // buildContext with userId
  // ==========================================================================

  describe('buildContext with userId', () => {
    it('should retrieve user-specific memories when userId is provided', async () => {
      const userMemory = createMemory({ id: 'mem-user-1', userId: 'user-1', content: 'User fact' });
      const otherMemory = createMemory({ id: 'mem-other', userId: 'user-2', content: 'Other fact' });

      mockEmbeddingRepo.findSimilar.mockResolvedValue([
        { sourceId: 'mem-user-1', similarity: 0.9 },
        { sourceId: 'mem-other', similarity: 0.8 },
      ]);
      mockMemoryRepo.findById.mockImplementation((id: string) => {
        if (id === 'mem-user-1') return Promise.resolve(userMemory);
        if (id === 'mem-other') return Promise.resolve(otherMemory);
        return Promise.resolve(null);
      });

      const result = await service.buildContext('test query', { userId: 'user-1' });

      expect(result.context).toContain('User fact');
      expect(result.context).not.toContain('Other fact');
      expect(result.debug.sources.memories).toBe(1);
    });

    it('should include memories without userId when userId filter is active', async () => {
      const userMemory = createMemory({ id: 'mem-1', userId: 'user-1', content: 'User memory' });
      const globalMemory = createMemory({ id: 'mem-2', userId: null, content: 'Global memory' });

      mockEmbeddingRepo.findSimilar.mockResolvedValue([
        { sourceId: 'mem-1', similarity: 0.9 },
        { sourceId: 'mem-2', similarity: 0.8 },
      ]);
      mockMemoryRepo.findById.mockImplementation((id: string) => {
        if (id === 'mem-1') return Promise.resolve(userMemory);
        if (id === 'mem-2') return Promise.resolve(globalMemory);
        return Promise.resolve(null);
      });

      const result = await service.buildContext('test', { userId: 'user-1' });

      // Global memories (no userId) should still be included
      expect(result.context).toContain('User memory');
      expect(result.context).toContain('Global memory');
    });

    it('should retrieve conversation-scoped items with conversationId', async () => {
      // conversationId is accepted but messages/summaries still use chatId
      // (messages table not yet migrated)
      const result = await service.buildContext('test', {
        conversationId: 'conv-1',
        chatId: 'chat-1',
      });

      // Should work without errors
      expect(result).toBeDefined();
      expect(result.debug).toBeDefined();
    });

    it('should combine userId and conversationId correctly', async () => {
      const memory = createMemory({ id: 'mem-1', userId: 'user-1', content: 'Relevant memory' });

      mockEmbeddingRepo.findSimilar.mockResolvedValue([
        { sourceId: 'mem-1', similarity: 0.9 },
      ]);
      mockMemoryRepo.findById.mockResolvedValue(memory);

      const result = await service.buildContext('test', {
        userId: 'user-1',
        conversationId: 'conv-1',
      });

      expect(result.context).toContain('Relevant memory');
    });

    it('should return unscoped results without userId or senderId', async () => {
      const memory = createMemory({ id: 'mem-1', content: 'Any memory' });

      mockEmbeddingRepo.findSimilar.mockResolvedValue([
        { sourceId: 'mem-1', similarity: 0.9 },
      ]);
      mockMemoryRepo.findById.mockResolvedValue(memory);

      const result = await service.buildContext('test', {});

      expect(result.context).toContain('Any memory');
    });
  });

  // ==========================================================================
  // Memory filtering with userId
  // ==========================================================================

  describe('memory filtering', () => {
    it('should filter memories by userId', async () => {
      const userMemory = createMemory({ id: 'mem-1', userId: 'user-1', content: 'User memory' });
      const otherMemory = createMemory({ id: 'mem-2', userId: 'user-2', content: 'Other memory' });

      mockEmbeddingRepo.findSimilar.mockResolvedValue([
        { sourceId: 'mem-1', similarity: 0.9 },
        { sourceId: 'mem-2', similarity: 0.8 },
      ]);
      mockMemoryRepo.findById.mockImplementation((id: string) => {
        if (id === 'mem-1') return Promise.resolve(userMemory);
        if (id === 'mem-2') return Promise.resolve(otherMemory);
        return Promise.resolve(null);
      });

      const result = await service.buildContext('test', { userId: 'user-1' });

      expect(result.context).toContain('User memory');
      expect(result.context).not.toContain('Other memory');
    });

    it('should still work with chatId for messages and summaries', async () => {
      mockMessageRepo.findRecentByChatId.mockResolvedValue([
        { id: 'msg-1', text: 'Recent message', isBot: false, createdAt: new Date() },
      ]);

      const result = await service.buildContext('test', { chatId: 'chat-1' });

      expect(mockMessageRepo.findRecentByChatId).toHaveBeenCalledWith('chat-1', 10);
      expect(result.context).toContain('Recent message');
    });

    it('should still include preferences when senderId is provided', async () => {
      mockUserPrefService.buildContextString.mockResolvedValue('Language: English');

      const result = await service.buildContext('test', { senderId: 'sender-1' });

      expect(mockUserPrefService.buildContextString).toHaveBeenCalledWith('sender-1');
      expect(result.context).toContain('Language: English');
    });
  });

  // ==========================================================================
  // Slack scenario: userId set, no chatId
  // ==========================================================================

  describe('Slack scenario', () => {
    it('should return memories only when userId is set but no chatId', async () => {
      const memory = createMemory({ id: 'mem-1', userId: 'user-1', content: 'Slack user memory' });

      mockEmbeddingRepo.findSimilar.mockResolvedValue([
        { sourceId: 'mem-1', similarity: 0.9 },
      ]);
      mockMemoryRepo.findById.mockResolvedValue(memory);

      const result = await service.buildContext('test', { userId: 'user-1' });

      // Should have memories but no messages or summaries (no chatId)
      expect(result.context).toContain('Slack user memory');
      expect(result.debug.sources.memories).toBe(1);
      expect(result.debug.sources.messages).toBe(0);
      expect(result.debug.sources.summaries).toBe(0);
      expect(result.debug.sources.preferences).toBe(0);
    });
  });

  // ==========================================================================
  // Telegram scenario: both userId and chatId
  // ==========================================================================

  describe('Telegram scenario', () => {
    it('should return full pipeline when both userId and chatId are set', async () => {
      const memory = createMemory({ id: 'mem-1', userId: 'user-1', content: 'TG memory' });

      mockEmbeddingRepo.findSimilar.mockResolvedValue([
        { sourceId: 'mem-1', similarity: 0.9 },
      ]);
      mockMemoryRepo.findById.mockResolvedValue(memory);
      mockMessageRepo.findRecentByChatId.mockResolvedValue([
        { id: 'msg-1', text: 'Hello', isBot: false, createdAt: new Date() },
      ]);
      mockSummaryRepo.findByChatId.mockResolvedValue([
        { id: 'sum-1', summary: 'Previous conversation', keyTopics: '["greetings"]', createdAt: new Date() },
      ]);
      mockUserPrefService.buildContextString.mockResolvedValue('Pref: dark mode');

      const result = await service.buildContext('test', {
        userId: 'user-1',
        senderId: 'sender-1',
        chatId: 'chat-1',
      });

      expect(result.debug.sources.memories).toBe(1);
      expect(result.debug.sources.messages).toBe(1);
      expect(result.debug.sources.summaries).toBe(1);
      expect(result.debug.sources.preferences).toBe(1);
      expect(result.context).toContain('TG memory');
      expect(result.context).toContain('Hello');
      expect(result.context).toContain('Previous conversation');
      expect(result.context).toContain('Pref: dark mode');
    });
  });

  // ==========================================================================
  // userId takes precedence over senderId for memory filtering
  // ==========================================================================

  describe('userId precedence over senderId', () => {
    it('should prefer userId over senderId for memory filtering', async () => {
      const userMemory = createMemory({ id: 'mem-1', userId: 'user-1', senderId: 'sender-1', content: 'Matched by userId' });
      const senderOnlyMemory = createMemory({ id: 'mem-2', userId: 'user-2', senderId: 'sender-1', content: 'Same sender different user' });

      mockEmbeddingRepo.findSimilar.mockResolvedValue([
        { sourceId: 'mem-1', similarity: 0.9 },
        { sourceId: 'mem-2', similarity: 0.8 },
      ]);
      mockMemoryRepo.findById.mockImplementation((id: string) => {
        if (id === 'mem-1') return Promise.resolve(userMemory);
        if (id === 'mem-2') return Promise.resolve(senderOnlyMemory);
        return Promise.resolve(null);
      });

      // When both userId and senderId are provided, userId takes precedence
      const result = await service.buildContext('test', {
        userId: 'user-1',
        senderId: 'sender-1',
      });

      expect(result.context).toContain('Matched by userId');
      expect(result.context).not.toContain('Same sender different user');
    });
  });

  // ==========================================================================
  // Token budget respected
  // ==========================================================================

  describe('token budget', () => {
    it('should respect token budget regardless of context sources', async () => {
      // Create a memory with very long content
      const longContent = 'A'.repeat(10000);
      const memory = createMemory({ id: 'mem-1', content: longContent });

      mockEmbeddingRepo.findSimilar.mockResolvedValue([
        { sourceId: 'mem-1', similarity: 0.9 },
      ]);
      mockMemoryRepo.findById.mockResolvedValue(memory);

      const result = await service.buildContext('test', {
        userId: 'user-1',
        maxTokens: 100,
      });

      // Token budget should be respected
      expect(result.debug.tokensUsed).toBeLessThanOrEqual(100);
    });
  });

  // ==========================================================================
  // Empty context sources
  // ==========================================================================

  describe('empty context', () => {
    it('should not produce empty sections when no sources active', async () => {
      const result = await service.buildContext('test', {
        userId: 'user-1',
        includePreferences: false,
        includeMemories: false,
        includeSummaries: false,
        includeRecentMessages: false,
        includeContacts: false,
      });

      expect(result.context).toBe('');
      expect(result.items).toHaveLength(0);
    });
  });

  // ==========================================================================
  // getContextStats with userId
  // ==========================================================================

  describe('getContextStats', () => {
    it('should use findActiveForUser when userId is provided', async () => {
      const memories = [
        createMemory({ id: 'mem-1', userId: 'user-1', createdAt: new Date('2026-01-01') }),
        createMemory({ id: 'mem-2', userId: 'user-1', createdAt: new Date('2026-02-01') }),
      ];
      mockMemoryRepo.findActiveForUser.mockResolvedValue(memories);

      const stats = await service.getContextStats(undefined, undefined, 'user-1');

      expect(mockMemoryRepo.findActiveForUser).toHaveBeenCalledWith('user-1', 1000);
      expect(stats.totalMemories).toBe(2);
      expect(stats.oldestContext).toEqual(new Date('2026-01-01'));
      expect(stats.newestContext).toEqual(new Date('2026-02-01'));
    });

    it('should not query memories when only senderId is provided (userId required)', async () => {
      // After Phase 10 cleanup, senderId fallback is removed for memories
      // Only userId is used for memory retrieval
      mockUserPrefService.buildContextString.mockResolvedValue('Some pref');

      const stats = await service.getContextStats(undefined, 'sender-1');

      // No memory queries when userId is not provided
      expect(mockMemoryRepo.findActiveForUser).not.toHaveBeenCalled();
      expect(stats.totalMemories).toBe(0);
      expect(stats.hasPreferences).toBe(true); // preferences still work with senderId
    });

    it('should still count messages and summaries via chatId', async () => {
      mockMessageRepo.findRecentByChatId.mockResolvedValue([
        { id: 'msg-1', createdAt: new Date() },
      ]);
      mockSummaryRepo.findByChatId.mockResolvedValue([
        { id: 'sum-1' },
      ]);

      const stats = await service.getContextStats('chat-1');

      expect(stats.totalMessages).toBe(1);
      expect(stats.totalSummaries).toBe(1);
    });
  });
});
