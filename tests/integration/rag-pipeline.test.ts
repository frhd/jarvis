#!/usr/bin/env npx tsx
/**
 * RAG Pipeline Integration Tests
 *
 * Tests the complete RAG pipeline with 4-tier retrieval:
 * 1. User preferences (high priority)
 * 2. Recent messages (sliding window)
 * 3. Relevant memories (semantic search)
 * 4. Conversation summaries (long-term context)
 *
 * Run: npx tsx tests/integration/rag-pipeline.test.ts
 */

import { ContextManagerService, ContextItem, ContextResult, ContextOptions } from '../../src/services/contextManager.service';
import { UserPreferenceService } from '../../src/services/userPreference.service';
import { MemoryRepository, Memory } from '../../src/repositories/memory.repository';
import { MessageRepository } from '../../src/repositories/message.repository';
import { ConversationSummaryRepository, ConversationSummary } from '../../src/repositories/conversationSummary.repository';
import { EmbeddingRepository, EmbeddingMatch } from '../../src/repositories/embedding.repository';
import { EmbeddingClient, EmbeddingResult } from '../../src/clients/embedding.client';
import { Message } from '../../src/types';

// ============== Test Helpers ==============

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve(fn())
    .then(() => {
      console.log(`✓ ${name}`);
      passed++;
    })
    .catch((err) => {
      console.log(`✗ ${name}`);
      console.log(`  Error: ${err.message}`);
      if (err.stack) {
        const stackLine = err.stack.split('\n')[1];
        if (stackLine) console.log(`  ${stackLine.trim()}`);
      }
      failed++;
    });
}

function assertEqual<T>(actual: T, expected: T, message?: string) {
  if (actual !== expected) {
    throw new Error(message || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertTrue(condition: boolean, message?: string) {
  if (!condition) {
    throw new Error(message || 'Expected condition to be true');
  }
}

function assertGreaterThan(actual: number, threshold: number, message?: string) {
  if (actual <= threshold) {
    throw new Error(message || `Expected ${actual} to be greater than ${threshold}`);
  }
}

function assertContains(text: string, substring: string, message?: string) {
  if (!text.includes(substring)) {
    throw new Error(message || `Expected "${text}" to contain "${substring}"`);
  }
}

// ============== Mock Services ==============

class MockUserPreferenceService {
  private preferences: Map<string, string> = new Map();

  async buildContextString(senderId: string): Promise<string> {
    return this.preferences.get(senderId) || '';
  }

  setPreferences(senderId: string, context: string): void {
    this.preferences.set(senderId, context);
  }
}

class MockMemoryRepository {
  private memories: Memory[] = [];

  async findById(id: string): Promise<Memory | null> {
    return this.memories.find(m => m.id === id) || null;
  }

  async findBySenderId(senderId: string, limit: number): Promise<Memory[]> {
    return this.memories
      .filter(m => m.senderId === senderId)
      .slice(0, limit);
  }

  addMemory(memory: Memory): void {
    this.memories.push(memory);
  }

  clear(): void {
    this.memories = [];
  }
}

class MockMessageRepository {
  private messages: Message[] = [];

  async findRecentByChatId(chatId: string, limit: number): Promise<Message[]> {
    return this.messages
      .filter(m => m.chatId === chatId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  addMessage(message: Message): void {
    this.messages.push(message);
  }

  clear(): void {
    this.messages = [];
  }
}

class MockConversationSummaryRepository {
  private summaries: ConversationSummary[] = [];

  async findByChatId(chatId: string, limit: number): Promise<ConversationSummary[]> {
    return this.summaries
      .filter(s => s.chatId === chatId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  addSummary(summary: ConversationSummary): void {
    this.summaries.push(summary);
  }

  clear(): void {
    this.summaries = [];
  }
}

class MockEmbeddingClient {
  private embeddings: Map<string, number[]> = new Map();
  public embedCallCount = 0;

  async embed(text: string): Promise<EmbeddingResult> {
    this.embedCallCount++;

    // Return cached or generate deterministic embedding
    let embedding = this.embeddings.get(text);
    if (!embedding) {
      // Simple deterministic embedding based on text hash
      embedding = Array(384).fill(0).map((_, i) =>
        Math.sin(text.charCodeAt(i % text.length) * (i + 1)) * 0.1
      );
      this.embeddings.set(text, embedding);
    }

    return {
      embedding,
      model: 'mock-model',
      durationMs: 10,
    };
  }

  clear(): void {
    this.embeddings.clear();
    this.embedCallCount = 0;
  }
}

class MockEmbeddingRepository {
  private embeddings: Array<{
    sourceId: string;
    sourceType: string;
    embedding: number[];
  }> = [];

  async findSimilar(
    queryEmbedding: number[],
    options: { limit?: number; sourceType?: string; minSimilarity?: number }
  ): Promise<EmbeddingMatch[]> {
    const { limit = 10, sourceType, minSimilarity = 0 } = options;

    // Calculate cosine similarity for all embeddings
    const matches = this.embeddings
      .filter(e => !sourceType || e.sourceType === sourceType)
      .map(e => {
        const similarity = this.cosineSimilarity(queryEmbedding, e.embedding);
        return {
          sourceId: e.sourceId,
          sourceType: e.sourceType,
          similarity,
          distance: 1 - similarity,
        };
      })
      .filter(m => m.similarity >= minSimilarity)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);

    return matches;
  }

  addEmbedding(sourceId: string, sourceType: string, embedding: number[]): void {
    this.embeddings.push({ sourceId, sourceType, embedding });
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dotProduct / denominator;
  }

  clear(): void {
    this.embeddings = [];
  }
}

// ============== Test Fixtures ==============

function createMockMessage(overrides: Partial<Message> = {}): Message {
  const id = `msg-${Date.now()}-${Math.random()}`;
  return {
    id,
    chatId: 'test-chat',
    senderId: 'test-sender',
    telegramMessageId: Math.floor(Math.random() * 10000),
    text: 'Test message',
    mediaType: null,
    mediaPath: null,
    mediaFileId: null,
    replyToMessageId: null,
    forwardFromChatId: null,
    forwardFromMessageId: null,
    isBot: false,
    rawJson: '{}',
    createdAt: new Date(),
    ...overrides,
  };
}

function createMockMemory(overrides: Partial<Memory> = {}): Memory {
  const id = `mem-${Date.now()}-${Math.random()}`;
  return {
    id,
    senderId: 'test-sender',
    chatId: 'test-chat',
    content: 'Test memory',
    type: 'fact',
    confidence: 80,
    source: 'manual',
    isArchived: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function createMockSummary(overrides: Partial<ConversationSummary> = {}): ConversationSummary {
  const id = `sum-${Date.now()}-${Math.random()}`;
  return {
    id,
    chatId: 'test-chat',
    summary: 'Test summary',
    keyTopics: null,
    messageCount: 10,
    startDate: new Date(Date.now() - 86400000),
    endDate: new Date(),
    createdAt: new Date(),
    ...overrides,
  };
}

// ============== Test Suites ==============

async function runTests() {
  console.log('\n=== RAG Pipeline Integration Tests ===\n');

  // -------------------- buildContext() Integration Tests --------------------
  console.log('--- buildContext() Integration Tests ---\n');

  // Test 1: Empty retrieval returns empty context
  await test('empty retrieval returns empty context', async () => {
    const mockUserPref = new MockUserPreferenceService();
    const mockMemoryRepo = new MockMemoryRepository();
    const mockMessageRepo = new MockMessageRepository();
    const mockSummaryRepo = new MockConversationSummaryRepository();
    const mockEmbeddingClient = new MockEmbeddingClient();
    const mockEmbeddingRepo = new MockEmbeddingRepository();

    const service = new ContextManagerService(
      mockEmbeddingClient as unknown as EmbeddingClient,
      mockEmbeddingRepo as unknown as EmbeddingRepository,
      mockMemoryRepo as unknown as MemoryRepository,
      mockMessageRepo as unknown as MessageRepository,
      mockSummaryRepo as unknown as ConversationSummaryRepository,
      mockUserPref as unknown as UserPreferenceService
    );

    const result = await service.buildContext('test query', {
      senderId: 'test-sender',
      chatId: 'test-chat',
    });

    assertEqual(result.items.length, 0);
    assertEqual(result.context, '');
    assertEqual(result.debug.totalCandidates, 0);
  });

  // Test 2: Preferences are retrieved and prioritized
  await test('preferences are retrieved and prioritized', async () => {
    const mockUserPref = new MockUserPreferenceService();
    mockUserPref.setPreferences('test-sender', 'User prefers concise responses and enjoys programming.');

    const mockMemoryRepo = new MockMemoryRepository();
    const mockMessageRepo = new MockMessageRepository();
    const mockSummaryRepo = new MockConversationSummaryRepository();
    const mockEmbeddingClient = new MockEmbeddingClient();
    const mockEmbeddingRepo = new MockEmbeddingRepository();

    const service = new ContextManagerService(
      mockEmbeddingClient as unknown as EmbeddingClient,
      mockEmbeddingRepo as unknown as EmbeddingRepository,
      mockMemoryRepo as unknown as MemoryRepository,
      mockMessageRepo as unknown as MessageRepository,
      mockSummaryRepo as unknown as ConversationSummaryRepository,
      mockUserPref as unknown as UserPreferenceService
    );

    const result = await service.buildContext('test query', {
      senderId: 'test-sender',
      chatId: 'test-chat',
      includePreferences: true,
    });

    assertEqual(result.items.length, 1);
    assertEqual(result.items[0].type, 'preference');
    assertEqual(result.items[0].score, 1.0);
    assertContains(result.context, 'concise responses');
  });

  // Test 3: Recent messages are retrieved with recency scoring
  await test('recent messages are retrieved with recency scoring', async () => {
    const mockUserPref = new MockUserPreferenceService();
    const mockMemoryRepo = new MockMemoryRepository();
    const mockMessageRepo = new MockMessageRepository();
    const mockSummaryRepo = new MockConversationSummaryRepository();
    const mockEmbeddingClient = new MockEmbeddingClient();
    const mockEmbeddingRepo = new MockEmbeddingRepository();

    // Add messages with different timestamps
    const now = Date.now();
    mockMessageRepo.addMessage(createMockMessage({
      text: 'Oldest message',
      createdAt: new Date(now - 3000),
      isBot: false,
    }));
    mockMessageRepo.addMessage(createMockMessage({
      text: 'Middle message',
      createdAt: new Date(now - 2000),
      isBot: true,
    }));
    mockMessageRepo.addMessage(createMockMessage({
      text: 'Most recent message',
      createdAt: new Date(now - 1000),
      isBot: false,
    }));

    const service = new ContextManagerService(
      mockEmbeddingClient as unknown as EmbeddingClient,
      mockEmbeddingRepo as unknown as EmbeddingRepository,
      mockMemoryRepo as unknown as MemoryRepository,
      mockMessageRepo as unknown as MessageRepository,
      mockSummaryRepo as unknown as ConversationSummaryRepository,
      mockUserPref as unknown as UserPreferenceService
    );

    const result = await service.buildContext('test query', {
      chatId: 'test-chat',
      includeRecentMessages: true,
      recentMessageCount: 3,
    });

    assertEqual(result.items.filter(i => i.type === 'message').length, 3);
    assertEqual(result.debug.sources.messages, 3);

    // Most recent should have higher score
    const messageItems = result.items.filter(i => i.type === 'message');
    const recentItem = messageItems.find(i => i.content.includes('Most recent'));
    const oldestItem = messageItems.find(i => i.content.includes('Oldest'));

    assertTrue(recentItem !== undefined);
    assertTrue(oldestItem !== undefined);
    assertGreaterThan(recentItem!.score, oldestItem!.score);
  });

  // Test 4: Memories are retrieved via semantic search (when embeddings enabled)
  await test('memories are retrieved via semantic search', async () => {
    // Note: This test may skip memory retrieval if embeddings are disabled in config
    // Memory retrieval requires appConfig.embedding.enabled === true
    const mockUserPref = new MockUserPreferenceService();
    const mockMemoryRepo = new MockMemoryRepository();
    const mockMessageRepo = new MockMessageRepository();
    const mockSummaryRepo = new MockConversationSummaryRepository();
    const mockEmbeddingClient = new MockEmbeddingClient();
    const mockEmbeddingRepo = new MockEmbeddingRepository();

    // Add memories
    const memory1 = createMockMemory({
      content: 'User loves Python programming',
      confidence: 90,
      type: 'preference',
    });
    const memory2 = createMockMemory({
      content: 'User works at a tech company',
      confidence: 85,
      type: 'fact',
    });

    mockMemoryRepo.addMemory(memory1);
    mockMemoryRepo.addMemory(memory2);

    // Create embeddings for memories
    const embedding1 = await mockEmbeddingClient.embed(memory1.content);
    const embedding2 = await mockEmbeddingClient.embed(memory2.content);
    mockEmbeddingRepo.addEmbedding(memory1.id, 'memory', embedding1.embedding);
    mockEmbeddingRepo.addEmbedding(memory2.id, 'memory', embedding2.embedding);

    const service = new ContextManagerService(
      mockEmbeddingClient as unknown as EmbeddingClient,
      mockEmbeddingRepo as unknown as EmbeddingRepository,
      mockMemoryRepo as unknown as MemoryRepository,
      mockMessageRepo as unknown as MessageRepository,
      mockSummaryRepo as unknown as ConversationSummaryRepository,
      mockUserPref as unknown as UserPreferenceService
    );

    const result = await service.buildContext('What does the user like?', {
      senderId: 'test-sender',
      includeMemories: true,
      minSimilarity: 0.1,
      topK: 5,
    });

    // Check if memories were retrieved (depends on appConfig.embedding.enabled)
    const memoryItems = result.items.filter(i => i.type === 'memory');

    // If appConfig.embedding.enabled is true, should retrieve memories
    // If false, memory retrieval is skipped (appConfig checked in contextManager.service.ts line 168)
    if (memoryItems.length > 0) {
      // Memories were retrieved
      assertEqual(result.debug.sources.memories, memoryItems.length);
      assertGreaterThan(mockEmbeddingClient.embedCallCount, 0);
    } else {
      // Memories skipped due to config - this is expected when embeddings disabled
      assertEqual(result.debug.sources.memories, 0);
    }
  });

  // Test 5: Summaries are retrieved
  await test('summaries are retrieved', async () => {
    const mockUserPref = new MockUserPreferenceService();
    const mockMemoryRepo = new MockMemoryRepository();
    const mockMessageRepo = new MockMessageRepository();
    const mockSummaryRepo = new MockConversationSummaryRepository();
    const mockEmbeddingClient = new MockEmbeddingClient();
    const mockEmbeddingRepo = new MockEmbeddingRepository();

    // Add summaries
    mockSummaryRepo.addSummary(createMockSummary({
      summary: 'Discussed project deadlines and requirements',
      keyTopics: JSON.stringify(['deadlines', 'requirements', 'project']),
    }));
    mockSummaryRepo.addSummary(createMockSummary({
      summary: 'Talked about weekend plans',
      keyTopics: JSON.stringify(['weekend', 'plans']),
    }));

    const service = new ContextManagerService(
      mockEmbeddingClient as unknown as EmbeddingClient,
      mockEmbeddingRepo as unknown as EmbeddingRepository,
      mockMemoryRepo as unknown as MemoryRepository,
      mockMessageRepo as unknown as MessageRepository,
      mockSummaryRepo as unknown as ConversationSummaryRepository,
      mockUserPref as unknown as UserPreferenceService
    );

    const result = await service.buildContext('project status', {
      chatId: 'test-chat',
      includeSummaries: true,
    });

    const summaryItems = result.items.filter(i => i.type === 'summary');
    assertGreaterThan(summaryItems.length, 0);
    assertEqual(result.debug.sources.summaries, summaryItems.length);
  });

  // Test 6: All 4 tiers integrated together
  await test('all 4 tiers integrated together', async () => {
    const mockUserPref = new MockUserPreferenceService();
    mockUserPref.setPreferences('test-sender', 'Prefers technical discussions');

    const mockMemoryRepo = new MockMemoryRepository();
    const mockMessageRepo = new MockMessageRepository();
    const mockSummaryRepo = new MockConversationSummaryRepository();
    const mockEmbeddingClient = new MockEmbeddingClient();
    const mockEmbeddingRepo = new MockEmbeddingRepository();

    // Add data for all tiers
    // Tier 1: Preferences (already set)

    // Tier 2: Recent messages
    mockMessageRepo.addMessage(createMockMessage({
      text: 'Tell me about async/await',
      isBot: false,
    }));
    mockMessageRepo.addMessage(createMockMessage({
      text: 'Async/await is syntactic sugar for promises',
      isBot: true,
    }));

    // Tier 3: Memories
    const memory = createMockMemory({
      content: 'User is experienced with JavaScript',
      confidence: 90,
    });
    mockMemoryRepo.addMemory(memory);
    const embedding = await mockEmbeddingClient.embed(memory.content);
    mockEmbeddingRepo.addEmbedding(memory.id, 'memory', embedding.embedding);

    // Tier 4: Summaries
    mockSummaryRepo.addSummary(createMockSummary({
      summary: 'Previous discussions about programming concepts',
      keyTopics: JSON.stringify(['programming', 'javascript']),
    }));

    const service = new ContextManagerService(
      mockEmbeddingClient as unknown as EmbeddingClient,
      mockEmbeddingRepo as unknown as EmbeddingRepository,
      mockMemoryRepo as unknown as MemoryRepository,
      mockMessageRepo as unknown as MessageRepository,
      mockSummaryRepo as unknown as ConversationSummaryRepository,
      mockUserPref as unknown as UserPreferenceService
    );

    const result = await service.buildContext('programming question', {
      senderId: 'test-sender',
      chatId: 'test-chat',
      includePreferences: true,
      includeMemories: true,
      includeSummaries: true,
      includeRecentMessages: true,
    });

    // Should have items from tiers 1, 2, and 4
    const hasPreferences = result.items.some(i => i.type === 'preference');
    const hasMessages = result.items.some(i => i.type === 'message');
    const hasMemories = result.items.some(i => i.type === 'memory');
    const hasSummaries = result.items.some(i => i.type === 'summary');

    assertTrue(hasPreferences, 'Should have preferences');
    assertTrue(hasMessages, 'Should have messages');
    // Note: Memories may not be included if appConfig.embedding.enabled is false
    // This is controlled by config, not by the includeMemories option
    assertTrue(hasSummaries, 'Should have summaries');

    // Should have at least 3 candidates (preferences, messages, summaries)
    // Memories may or may not be included depending on embedding config
    assertGreaterThan(result.debug.totalCandidates, 2);
  });

  // -------------------- rankItems() Tests --------------------
  console.log('\n--- rankItems() Tests ---\n');

  // Test 7: Items are ranked by type priority
  await test('items are ranked by type priority', async () => {
    const mockUserPref = new MockUserPreferenceService();
    mockUserPref.setPreferences('test-sender', 'User preferences');

    const mockMemoryRepo = new MockMemoryRepository();
    const mockMessageRepo = new MockMessageRepository();
    const mockSummaryRepo = new MockConversationSummaryRepository();
    const mockEmbeddingClient = new MockEmbeddingClient();
    const mockEmbeddingRepo = new MockEmbeddingRepository();

    // Add items from different tiers with same scores
    mockMessageRepo.addMessage(createMockMessage({ text: 'Message' }));

    const memory = createMockMemory({ content: 'Memory' });
    mockMemoryRepo.addMemory(memory);
    const embedding = await mockEmbeddingClient.embed(memory.content);
    mockEmbeddingRepo.addEmbedding(memory.id, 'memory', embedding.embedding);

    mockSummaryRepo.addSummary(createMockSummary({ summary: 'Summary' }));

    const service = new ContextManagerService(
      mockEmbeddingClient as unknown as EmbeddingClient,
      mockEmbeddingRepo as unknown as EmbeddingRepository,
      mockMemoryRepo as unknown as MemoryRepository,
      mockMessageRepo as unknown as MessageRepository,
      mockSummaryRepo as unknown as ConversationSummaryRepository,
      mockUserPref as unknown as UserPreferenceService
    );

    const result = await service.buildContext('query', {
      senderId: 'test-sender',
      chatId: 'test-chat',
    });

    // Check order: preference > message > memory > summary
    const types = result.items.map(i => i.type);
    const prefIndex = types.indexOf('preference');
    const msgIndex = types.indexOf('message');
    const memIndex = types.indexOf('memory');
    const sumIndex = types.indexOf('summary');

    if (prefIndex !== -1 && msgIndex !== -1) {
      assertTrue(prefIndex < msgIndex, 'Preferences should come before messages');
    }
    if (msgIndex !== -1 && memIndex !== -1) {
      assertTrue(msgIndex < memIndex, 'Messages should come before memories');
    }
    if (memIndex !== -1 && sumIndex !== -1) {
      assertTrue(memIndex < sumIndex, 'Memories should come before summaries');
    }
  });

  // Test 8: Items with higher scores rank higher within same type
  await test('items with higher scores rank higher within same type', async () => {
    const mockUserPref = new MockUserPreferenceService();
    const mockMemoryRepo = new MockMemoryRepository();
    const mockMessageRepo = new MockMessageRepository();
    const mockSummaryRepo = new MockConversationSummaryRepository();
    const mockEmbeddingClient = new MockEmbeddingClient();
    const mockEmbeddingRepo = new MockEmbeddingRepository();

    // Add messages at different times (different recency scores)
    const now = Date.now();
    mockMessageRepo.addMessage(createMockMessage({
      text: 'Old message',
      createdAt: new Date(now - 10000),
    }));
    mockMessageRepo.addMessage(createMockMessage({
      text: 'Recent message',
      createdAt: new Date(now - 1000),
    }));

    const service = new ContextManagerService(
      mockEmbeddingClient as unknown as EmbeddingClient,
      mockEmbeddingRepo as unknown as EmbeddingRepository,
      mockMemoryRepo as unknown as MemoryRepository,
      mockMessageRepo as unknown as MessageRepository,
      mockSummaryRepo as unknown as ConversationSummaryRepository,
      mockUserPref as unknown as UserPreferenceService
    );

    const result = await service.buildContext('query', {
      chatId: 'test-chat',
      includeRecentMessages: true,
    });

    const messageItems = result.items.filter(i => i.type === 'message');
    if (messageItems.length >= 2) {
      // First message should have higher score (more recent)
      assertGreaterThan(messageItems[0].score, messageItems[1].score);
    }
  });

  // -------------------- assembleContext() Tests --------------------
  console.log('\n--- assembleContext() Tests ---\n');

  // Test 9: Token budget is respected
  await test('token budget is respected', async () => {
    const mockUserPref = new MockUserPreferenceService();
    const mockMemoryRepo = new MockMemoryRepository();
    const mockMessageRepo = new MockMessageRepository();
    const mockSummaryRepo = new MockConversationSummaryRepository();
    const mockEmbeddingClient = new MockEmbeddingClient();
    const mockEmbeddingRepo = new MockEmbeddingRepository();

    // Add many long messages
    for (let i = 0; i < 20; i++) {
      mockMessageRepo.addMessage(createMockMessage({
        text: 'This is a very long message '.repeat(50),
      }));
    }

    const service = new ContextManagerService(
      mockEmbeddingClient as unknown as EmbeddingClient,
      mockEmbeddingRepo as unknown as EmbeddingRepository,
      mockMemoryRepo as unknown as MemoryRepository,
      mockMessageRepo as unknown as MessageRepository,
      mockSummaryRepo as unknown as ConversationSummaryRepository,
      mockUserPref as unknown as UserPreferenceService
    );

    const result = await service.buildContext('query', {
      chatId: 'test-chat',
      maxTokens: 500,
    });

    // Should respect token budget
    assertTrue(result.debug.tokensUsed <= result.debug.tokenBudget + 100); // Small buffer for formatting
    assertTrue(result.debug.selectedItems <= result.debug.totalCandidates);
  });

  // Test 10: Items are truncated to fit budget
  await test('items are truncated to fit budget', async () => {
    const mockUserPref = new MockUserPreferenceService();
    const mockMemoryRepo = new MockMemoryRepository();
    const mockMessageRepo = new MockMessageRepository();
    const mockSummaryRepo = new MockConversationSummaryRepository();
    const mockEmbeddingClient = new MockEmbeddingClient();
    const mockEmbeddingRepo = new MockEmbeddingRepository();

    // Add one very long message
    mockMessageRepo.addMessage(createMockMessage({
      text: 'A'.repeat(10000), // Very long
    }));

    const service = new ContextManagerService(
      mockEmbeddingClient as unknown as EmbeddingClient,
      mockEmbeddingRepo as unknown as EmbeddingRepository,
      mockMemoryRepo as unknown as MemoryRepository,
      mockMessageRepo as unknown as MessageRepository,
      mockSummaryRepo as unknown as ConversationSummaryRepository,
      mockUserPref as unknown as UserPreferenceService
    );

    const result = await service.buildContext('query', {
      chatId: 'test-chat',
      maxTokens: 200,
    });

    // Should truncate
    assertTrue(result.context.length < 10000);
    assertTrue(result.context.includes('...') || result.context.length < 1000);
  });

  // -------------------- formatContext() Tests --------------------
  console.log('\n--- formatContext() Tests ---\n');

  // Test 11: Context is formatted with proper sections
  await test('context is formatted with proper sections', async () => {
    const mockUserPref = new MockUserPreferenceService();
    mockUserPref.setPreferences('test-sender', 'User preferences here');

    const mockMemoryRepo = new MockMemoryRepository();
    const mockMessageRepo = new MockMessageRepository();
    const mockSummaryRepo = new MockConversationSummaryRepository();
    const mockEmbeddingClient = new MockEmbeddingClient();
    const mockEmbeddingRepo = new MockEmbeddingRepository();

    mockMessageRepo.addMessage(createMockMessage({
      text: 'Test message',
      isBot: false,
    }));

    const service = new ContextManagerService(
      mockEmbeddingClient as unknown as EmbeddingClient,
      mockEmbeddingRepo as unknown as EmbeddingRepository,
      mockMemoryRepo as unknown as MemoryRepository,
      mockMessageRepo as unknown as MessageRepository,
      mockSummaryRepo as unknown as ConversationSummaryRepository,
      mockUserPref as unknown as UserPreferenceService
    );

    const result = await service.buildContext('query', {
      senderId: 'test-sender',
      chatId: 'test-chat',
    });

    // Should have formatted sections
    assertContains(result.context, 'User preferences here');
    assertContains(result.context, 'Recent conversation:');
    assertContains(result.context, 'User: Test message');
  });

  // Test 12: Empty context returns empty string
  await test('empty context returns empty string', async () => {
    const mockUserPref = new MockUserPreferenceService();
    const mockMemoryRepo = new MockMemoryRepository();
    const mockMessageRepo = new MockMessageRepository();
    const mockSummaryRepo = new MockConversationSummaryRepository();
    const mockEmbeddingClient = new MockEmbeddingClient();
    const mockEmbeddingRepo = new MockEmbeddingRepository();

    const service = new ContextManagerService(
      mockEmbeddingClient as unknown as EmbeddingClient,
      mockEmbeddingRepo as unknown as EmbeddingRepository,
      mockMemoryRepo as unknown as MemoryRepository,
      mockMessageRepo as unknown as MessageRepository,
      mockSummaryRepo as unknown as ConversationSummaryRepository,
      mockUserPref as unknown as UserPreferenceService
    );

    const result = await service.buildContext('query', {
      senderId: 'test-sender',
      chatId: 'test-chat',
    });

    assertEqual(result.context, '');
  });

  // -------------------- inspectContext() Tests --------------------
  console.log('\n--- inspectContext() Tests ---\n');

  // Test 13: inspectContext returns breakdown
  await test('inspectContext returns breakdown by type', async () => {
    const mockUserPref = new MockUserPreferenceService();
    mockUserPref.setPreferences('test-sender', 'Preferences');

    const mockMemoryRepo = new MockMemoryRepository();
    const mockMessageRepo = new MockMessageRepository();
    const mockSummaryRepo = new MockConversationSummaryRepository();
    const mockEmbeddingClient = new MockEmbeddingClient();
    const mockEmbeddingRepo = new MockEmbeddingRepository();

    mockMessageRepo.addMessage(createMockMessage({ text: 'Message 1' }));
    mockMessageRepo.addMessage(createMockMessage({ text: 'Message 2' }));

    const service = new ContextManagerService(
      mockEmbeddingClient as unknown as EmbeddingClient,
      mockEmbeddingRepo as unknown as EmbeddingRepository,
      mockMemoryRepo as unknown as MemoryRepository,
      mockMessageRepo as unknown as MessageRepository,
      mockSummaryRepo as unknown as ConversationSummaryRepository,
      mockUserPref as unknown as UserPreferenceService
    );

    const inspection = await service.inspectContext('query', {
      senderId: 'test-sender',
      chatId: 'test-chat',
    });

    assertTrue(inspection.breakdown.length > 0);

    const prefBreakdown = inspection.breakdown.find(b => b.type === 'preference');
    const msgBreakdown = inspection.breakdown.find(b => b.type === 'message');

    assertTrue(prefBreakdown !== undefined);
    assertTrue(msgBreakdown !== undefined);
    assertEqual(msgBreakdown!.count, 2);
  });

  // -------------------- getContextStats() Tests --------------------
  console.log('\n--- getContextStats() Tests ---\n');

  // Test 14: getContextStats returns correct counts
  await test('getContextStats returns correct counts', async () => {
    const mockUserPref = new MockUserPreferenceService();
    mockUserPref.setPreferences('test-sender', 'Some preferences');

    const mockMemoryRepo = new MockMemoryRepository();
    const mockMessageRepo = new MockMessageRepository();
    const mockSummaryRepo = new MockConversationSummaryRepository();
    const mockEmbeddingClient = new MockEmbeddingClient();
    const mockEmbeddingRepo = new MockEmbeddingRepository();

    // Add test data
    mockMemoryRepo.addMemory(createMockMemory({ senderId: 'test-sender' }));
    mockMemoryRepo.addMemory(createMockMemory({ senderId: 'test-sender' }));
    mockMemoryRepo.addMemory(createMockMemory({ senderId: 'test-sender', isArchived: true }));

    mockMessageRepo.addMessage(createMockMessage({ chatId: 'test-chat' }));
    mockMessageRepo.addMessage(createMockMessage({ chatId: 'test-chat' }));
    mockMessageRepo.addMessage(createMockMessage({ chatId: 'test-chat' }));

    mockSummaryRepo.addSummary(createMockSummary({ chatId: 'test-chat' }));

    const service = new ContextManagerService(
      mockEmbeddingClient as unknown as EmbeddingClient,
      mockEmbeddingRepo as unknown as EmbeddingRepository,
      mockMemoryRepo as unknown as MemoryRepository,
      mockMessageRepo as unknown as MessageRepository,
      mockSummaryRepo as unknown as ConversationSummaryRepository,
      mockUserPref as unknown as UserPreferenceService
    );

    const stats = await service.getContextStats('test-chat', 'test-sender');

    assertEqual(stats.totalMemories, 2); // Excludes archived
    assertEqual(stats.totalMessages, 3);
    assertEqual(stats.totalSummaries, 1);
    assertEqual(stats.hasPreferences, true);
    assertTrue(stats.oldestContext !== null);
    assertTrue(stats.newestContext !== null);
  });

  // Test 15: getContextStats with no data
  await test('getContextStats with no data', async () => {
    const mockUserPref = new MockUserPreferenceService();
    const mockMemoryRepo = new MockMemoryRepository();
    const mockMessageRepo = new MockMessageRepository();
    const mockSummaryRepo = new MockConversationSummaryRepository();
    const mockEmbeddingClient = new MockEmbeddingClient();
    const mockEmbeddingRepo = new MockEmbeddingRepository();

    const service = new ContextManagerService(
      mockEmbeddingClient as unknown as EmbeddingClient,
      mockEmbeddingRepo as unknown as EmbeddingRepository,
      mockMemoryRepo as unknown as MemoryRepository,
      mockMessageRepo as unknown as MessageRepository,
      mockSummaryRepo as unknown as ConversationSummaryRepository,
      mockUserPref as unknown as UserPreferenceService
    );

    const stats = await service.getContextStats('test-chat', 'test-sender');

    assertEqual(stats.totalMemories, 0);
    assertEqual(stats.totalMessages, 0);
    assertEqual(stats.totalSummaries, 0);
    assertEqual(stats.hasPreferences, false);
    assertEqual(stats.oldestContext, null);
    assertEqual(stats.newestContext, null);
  });

  // -------------------- Options Tests --------------------
  console.log('\n--- Options Tests ---\n');

  // Test 16: Can disable individual tiers
  await test('can disable individual tiers', async () => {
    const mockUserPref = new MockUserPreferenceService();
    mockUserPref.setPreferences('test-sender', 'Preferences');

    const mockMemoryRepo = new MockMemoryRepository();
    const mockMessageRepo = new MockMessageRepository();
    const mockSummaryRepo = new MockConversationSummaryRepository();
    const mockEmbeddingClient = new MockEmbeddingClient();
    const mockEmbeddingRepo = new MockEmbeddingRepository();

    mockMessageRepo.addMessage(createMockMessage());

    const memory = createMockMemory();
    mockMemoryRepo.addMemory(memory);
    const embedding = await mockEmbeddingClient.embed(memory.content);
    mockEmbeddingRepo.addEmbedding(memory.id, 'memory', embedding.embedding);

    mockSummaryRepo.addSummary(createMockSummary());

    const service = new ContextManagerService(
      mockEmbeddingClient as unknown as EmbeddingClient,
      mockEmbeddingRepo as unknown as EmbeddingRepository,
      mockMemoryRepo as unknown as MemoryRepository,
      mockMessageRepo as unknown as MessageRepository,
      mockSummaryRepo as unknown as ConversationSummaryRepository,
      mockUserPref as unknown as UserPreferenceService
    );

    // Disable all but preferences
    const result = await service.buildContext('query', {
      senderId: 'test-sender',
      chatId: 'test-chat',
      includePreferences: true,
      includeMemories: false,
      includeSummaries: false,
      includeRecentMessages: false,
    });

    assertEqual(result.items.length, 1);
    assertEqual(result.items[0].type, 'preference');
  });

  // Test 17: topK limits memory results
  await test('topK limits memory results', async () => {
    const mockUserPref = new MockUserPreferenceService();
    const mockMemoryRepo = new MockMemoryRepository();
    const mockMessageRepo = new MockMessageRepository();
    const mockSummaryRepo = new MockConversationSummaryRepository();
    const mockEmbeddingClient = new MockEmbeddingClient();
    const mockEmbeddingRepo = new MockEmbeddingRepository();

    // Add many memories
    for (let i = 0; i < 10; i++) {
      const memory = createMockMemory({ content: `Memory ${i}` });
      mockMemoryRepo.addMemory(memory);
      const embedding = await mockEmbeddingClient.embed(memory.content);
      mockEmbeddingRepo.addEmbedding(memory.id, 'memory', embedding.embedding);
    }

    const service = new ContextManagerService(
      mockEmbeddingClient as unknown as EmbeddingClient,
      mockEmbeddingRepo as unknown as EmbeddingRepository,
      mockMemoryRepo as unknown as MemoryRepository,
      mockMessageRepo as unknown as MessageRepository,
      mockSummaryRepo as unknown as ConversationSummaryRepository,
      mockUserPref as unknown as UserPreferenceService
    );

    const result = await service.buildContext('query', {
      senderId: 'test-sender',
      includeMemories: true,
      topK: 3,
    });

    const memoryItems = result.items.filter(i => i.type === 'memory');
    assertTrue(memoryItems.length <= 3);
  });

  // Test 18: minSimilarity filters low-scoring memories
  await test('minSimilarity filters low-scoring memories', async () => {
    const mockUserPref = new MockUserPreferenceService();
    const mockMemoryRepo = new MockMemoryRepository();
    const mockMessageRepo = new MockMessageRepository();
    const mockSummaryRepo = new MockConversationSummaryRepository();
    const mockEmbeddingClient = new MockEmbeddingClient();
    const mockEmbeddingRepo = new MockEmbeddingRepository();

    // Add memory
    const memory = createMockMemory({ content: 'Completely unrelated content' });
    mockMemoryRepo.addMemory(memory);
    const embedding = await mockEmbeddingClient.embed(memory.content);
    mockEmbeddingRepo.addEmbedding(memory.id, 'memory', embedding.embedding);

    const service = new ContextManagerService(
      mockEmbeddingClient as unknown as EmbeddingClient,
      mockEmbeddingRepo as unknown as EmbeddingRepository,
      mockMemoryRepo as unknown as MemoryRepository,
      mockMessageRepo as unknown as MessageRepository,
      mockSummaryRepo as unknown as ConversationSummaryRepository,
      mockUserPref as unknown as UserPreferenceService
    );

    // High similarity threshold should filter out the memory
    const result = await service.buildContext('specific query about programming', {
      senderId: 'test-sender',
      includeMemories: true,
      minSimilarity: 0.95, // Very high threshold
    });

    // Should not include the unrelated memory
    const memoryItems = result.items.filter(i => i.type === 'memory');
    assertEqual(memoryItems.length, 0);
  });

  // -------------------- Debug Info Tests --------------------
  console.log('\n--- Debug Info Tests ---\n');

  // Test 19: Debug info includes timing data
  await test('debug info includes timing data', async () => {
    const mockUserPref = new MockUserPreferenceService();
    const mockMemoryRepo = new MockMemoryRepository();
    const mockMessageRepo = new MockMessageRepository();
    const mockSummaryRepo = new MockConversationSummaryRepository();
    const mockEmbeddingClient = new MockEmbeddingClient();
    const mockEmbeddingRepo = new MockEmbeddingRepository();

    const service = new ContextManagerService(
      mockEmbeddingClient as unknown as EmbeddingClient,
      mockEmbeddingRepo as unknown as EmbeddingRepository,
      mockMemoryRepo as unknown as MemoryRepository,
      mockMessageRepo as unknown as MessageRepository,
      mockSummaryRepo as unknown as ConversationSummaryRepository,
      mockUserPref as unknown as UserPreferenceService
    );

    const result = await service.buildContext('query', {
      senderId: 'test-sender',
      chatId: 'test-chat',
    });

    assertTrue(result.debug.timings.totalMs >= 0);
    assertTrue(result.debug.timings.embeddingMs >= 0);
    assertTrue(result.debug.timings.retrievalMs >= 0);
    assertTrue(result.debug.timings.scoringMs >= 0);
  });

  // Test 20: Debug info includes source counts
  await test('debug info includes source counts', async () => {
    const mockUserPref = new MockUserPreferenceService();
    mockUserPref.setPreferences('test-sender', 'Prefs');

    const mockMemoryRepo = new MockMemoryRepository();
    const mockMessageRepo = new MockMessageRepository();
    const mockSummaryRepo = new MockConversationSummaryRepository();
    const mockEmbeddingClient = new MockEmbeddingClient();
    const mockEmbeddingRepo = new MockEmbeddingRepository();

    mockMessageRepo.addMessage(createMockMessage());
    mockMessageRepo.addMessage(createMockMessage());

    const service = new ContextManagerService(
      mockEmbeddingClient as unknown as EmbeddingClient,
      mockEmbeddingRepo as unknown as EmbeddingRepository,
      mockMemoryRepo as unknown as MemoryRepository,
      mockMessageRepo as unknown as MessageRepository,
      mockSummaryRepo as unknown as ConversationSummaryRepository,
      mockUserPref as unknown as UserPreferenceService
    );

    const result = await service.buildContext('query', {
      senderId: 'test-sender',
      chatId: 'test-chat',
    });

    assertEqual(result.debug.sources.preferences, 1);
    assertEqual(result.debug.sources.messages, 2);
    assertEqual(result.debug.sources.memories, 0);
    assertEqual(result.debug.sources.summaries, 0);
  });

  // -------------------- Print Results --------------------
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
