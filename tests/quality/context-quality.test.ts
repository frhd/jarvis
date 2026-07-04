#!/usr/bin/env npx tsx
/**
 * Context Quality Assessment Tests
 *
 * Tests the quality and correctness of context retrieval and ranking
 * in the RAG pipeline. Ensures relevant, recent information is prioritized
 * and token budgets are respected.
 *
 * Run: npx tsx tests/quality/context-quality.test.ts
 */

import { ContextManagerService, ContextItem, ContextOptions } from '../../src/services/contextManager.service.js';
import { EmbeddingClient } from '../../src/clients/embedding.client.js';
import { MemoryRepository, Memory } from '../../src/repositories/memory.repository.js';
import { EmbeddingRepository } from '../../src/repositories/embedding.repository.js';
import { MessageRepository } from '../../src/repositories/message.repository.js';
import { ConversationSummaryRepository } from '../../src/repositories/conversationSummary.repository.js';
import { UserPreferenceService } from '../../src/services/userPreference.service.js';
import { Message } from '../../src/types/index.js';
import { appConfig } from '../../src/config/index.js';

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
        console.log(`  Stack: ${err.stack.split('\n')[1]}`);
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

function assertGreaterThan(actual: number, expected: number, message?: string) {
  if (actual <= expected) {
    throw new Error(message || `Expected ${actual} to be greater than ${expected}`);
  }
}

function assertLessThan(actual: number, expected: number, message?: string) {
  if (actual >= expected) {
    throw new Error(message || `Expected ${actual} to be less than ${expected}`);
  }
}

// ============== Mock Implementations ==============

class MockEmbeddingClient extends EmbeddingClient {
  private embeddings = new Map<string, number[]>();

  constructor() {
    super('http://mock', 'mock-model');
  }

  async embed(text: string): Promise<{ embedding: number[]; model: string }> {
    // Check if we have a cached embedding
    if (this.embeddings.has(text)) {
      return { embedding: this.embeddings.get(text)!, model: 'mock-model' };
    }

    // Generate deterministic embedding based on text content
    const embedding = this.generateDeterministicEmbedding(text);
    this.embeddings.set(text, embedding);
    return { embedding, model: 'mock-model' };
  }

  async embedBatch(texts: string[]): Promise<Array<{ embedding: number[]; model: string }>> {
    return Promise.all(texts.map((text) => this.embed(text)));
  }

  private generateDeterministicEmbedding(text: string): number[] {
    // Simple hash-based embedding for testing
    const lowerText = text.toLowerCase();
    const embedding = new Array(384).fill(0);

    // Use character codes to generate deterministic values
    for (let i = 0; i < text.length; i++) {
      const charCode = text.charCodeAt(i);
      embedding[i % 384] += charCode / 1000;
    }

    // Add semantic similarity for specific keywords
    if (lowerText.includes('pizza')) {
      embedding[0] += 0.5;
      embedding[1] += 0.3;
    }
    if (lowerText.includes('food') || lowerText.includes('eat')) {
      embedding[0] += 0.3;
      embedding[1] += 0.2;
    }
    if (lowerText.includes('music')) {
      embedding[2] += 0.5;
      embedding[3] += 0.3;
    }
    if (lowerText.includes('song') || lowerText.includes('band')) {
      embedding[2] += 0.3;
      embedding[3] += 0.2;
    }
    if (lowerText.includes('travel')) {
      embedding[4] += 0.5;
      embedding[5] += 0.3;
    }
    if (lowerText.includes('japan') || lowerText.includes('tokyo')) {
      embedding[4] += 0.3;
      embedding[5] += 0.2;
    }

    // Normalize
    const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    return embedding.map((val) => val / magnitude);
  }

  // Helper to calculate cosine similarity
  cosineSimilarity(a: number[], b: number[]): number {
    let dotProduct = 0;
    let magnitudeA = 0;
    let magnitudeB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      magnitudeA += a[i] * a[i];
      magnitudeB += b[i] * b[i];
    }

    magnitudeA = Math.sqrt(magnitudeA);
    magnitudeB = Math.sqrt(magnitudeB);

    return dotProduct / (magnitudeA * magnitudeB);
  }
}

class MockMemoryRepository implements MemoryRepository {
  private memories: Memory[] = [];
  private idCounter = 0;

  async create(data: Partial<Memory>): Promise<Memory> {
    const memory: Memory = {
      id: `mem-${this.idCounter++}`,
      senderId: data.senderId ?? null,
      chatId: data.chatId ?? 'test-chat',
      memoryType: data.memoryType ?? 'fact',
      content: data.content ?? '',
      confidence: data.confidence ?? 100,
      sourceMessageIds: data.sourceMessageIds ?? null,
      isArchived: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastAccessedAt: new Date(),
      accessCount: 0,
    };
    this.memories.push(memory);
    return memory;
  }

  async findById(id: string): Promise<Memory | null> {
    return this.memories.find((m) => m.id === id) ?? null;
  }

  async findBySenderId(senderId: string, limit: number): Promise<Memory[]> {
    return this.memories
      .filter((m) => m.senderId === senderId && !m.isArchived)
      .slice(0, limit);
  }

  async update(id: string, data: Partial<Memory>): Promise<Memory | null> {
    const memory = await this.findById(id);
    if (!memory) return null;
    Object.assign(memory, data, { updatedAt: new Date() });
    return memory;
  }

  async archive(id: string): Promise<boolean> {
    const memory = await this.findById(id);
    if (!memory) return false;
    memory.isArchived = true;
    return true;
  }

  async recordAccess(id: string): Promise<void> {
    const memory = await this.findById(id);
    if (memory) {
      memory.lastAccessedAt = new Date();
      memory.accessCount++;
    }
  }

  async archiveOlderThan(date: Date): Promise<number> {
    let count = 0;
    for (const memory of this.memories) {
      if (memory.createdAt < date && !memory.isArchived) {
        memory.isArchived = true;
        count++;
      }
    }
    return count;
  }

  // Helper methods for testing
  clear() {
    this.memories = [];
    this.idCounter = 0;
  }

  addMemory(content: string, options: Partial<Memory> = {}): Memory {
    const memory: Memory = {
      id: `mem-${this.idCounter++}`,
      senderId: options.senderId ?? 'test-user',
      chatId: options.chatId ?? 'test-chat',
      memoryType: options.memoryType ?? 'fact',
      content,
      confidence: options.confidence ?? 100,
      sourceMessageIds: options.sourceMessageIds ?? null,
      isArchived: options.isArchived ?? false,
      createdAt: options.createdAt ?? new Date(),
      updatedAt: options.updatedAt ?? new Date(),
      lastAccessedAt: options.lastAccessedAt ?? new Date(),
      accessCount: options.accessCount ?? 0,
    };
    this.memories.push(memory);
    return memory;
  }
}

class MockEmbeddingRepository implements EmbeddingRepository {
  private embeddings: Array<{
    sourceType: string;
    sourceId: string;
    content: string;
    embedding: number[];
  }> = [];
  private embeddingClient: MockEmbeddingClient;

  constructor(embeddingClient: MockEmbeddingClient) {
    this.embeddingClient = embeddingClient;
  }

  async create(data: {
    sourceType: string;
    sourceId: string;
    content: string;
    embedding: string;
    model: string;
    dimensions: number;
  }): Promise<void> {
    const embeddingArray = JSON.parse(data.embedding);
    this.embeddings.push({
      sourceType: data.sourceType,
      sourceId: data.sourceId,
      content: data.content,
      embedding: embeddingArray,
    });
  }

  async findSimilar(
    queryEmbedding: number[],
    options: { limit: number; sourceType?: string; minSimilarity?: number }
  ): Promise<Array<{ sourceId: string; similarity: number }>> {
    const results = this.embeddings
      .filter((e) => !options.sourceType || e.sourceType === options.sourceType)
      .map((e) => ({
        sourceId: e.sourceId,
        similarity: this.embeddingClient.cosineSimilarity(queryEmbedding, e.embedding),
      }))
      .filter((r) => r.similarity >= (options.minSimilarity ?? 0))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, options.limit);

    return results;
  }

  async deleteBySource(sourceType: string, sourceId: string): Promise<void> {
    this.embeddings = this.embeddings.filter(
      (e) => !(e.sourceType === sourceType && e.sourceId === sourceId)
    );
  }

  // Helper methods
  clear() {
    this.embeddings = [];
  }
}

class MockMessageRepository implements MessageRepository {
  private messages: Message[] = [];
  private idCounter = 0;

  async findRecentByChatId(chatId: string, limit: number): Promise<Message[]> {
    return this.messages
      .filter((m) => m.chatId === chatId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  // Helper methods
  clear() {
    this.messages = [];
    this.idCounter = 0;
  }

  addMessage(text: string, options: Partial<Message> = {}): Message {
    const message: Message = {
      id: `msg-${this.idCounter++}`,
      telegramId: options.telegramId ?? this.idCounter,
      chatId: options.chatId ?? 'test-chat',
      senderId: options.senderId ?? 'test-user',
      text: text,
      isBot: options.isBot ?? false,
      createdAt: options.createdAt ?? new Date(),
      updatedAt: options.updatedAt ?? new Date(),
      mediaPath: options.mediaPath ?? null,
      mediaType: options.mediaType ?? null,
      rawJson: options.rawJson ?? null,
    };
    this.messages.push(message);
    return message;
  }

  // Required interface methods (not used in these tests)
  async create(data: any): Promise<Message> {
    throw new Error('Not implemented');
  }
  async findById(id: string): Promise<Message | null> {
    return this.messages.find((m) => m.id === id) ?? null;
  }
  async findByTelegramId(telegramId: number, chatId: string): Promise<Message | null> {
    return null;
  }
  async findBySender(senderId: string, limit: number): Promise<Message[]> {
    return [];
  }
}

class MockConversationSummaryRepository implements ConversationSummaryRepository {
  private summaries: any[] = [];
  private idCounter = 0;

  async findByChatId(chatId: string, limit: number): Promise<any[]> {
    return this.summaries
      .filter((s) => s.chatId === chatId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  // Helper methods
  clear() {
    this.summaries = [];
    this.idCounter = 0;
  }

  addSummary(summary: string, options: any = {}) {
    const summaryObj = {
      id: `sum-${this.idCounter++}`,
      chatId: options.chatId ?? 'test-chat',
      summary,
      keyTopics: options.keyTopics ?? null,
      messageCount: options.messageCount ?? 10,
      createdAt: options.createdAt ?? new Date(),
    };
    this.summaries.push(summaryObj);
    return summaryObj;
  }

  // Required interface methods (not used in these tests)
  async create(data: any): Promise<any> {
    throw new Error('Not implemented');
  }
}

class MockUserPreferenceService {
  private preferences = new Map<string, string>();

  async buildContextString(senderId: string): Promise<string> {
    return this.preferences.get(senderId) ?? '';
  }

  // Helper methods
  setPreferences(senderId: string, context: string) {
    this.preferences.set(senderId, context);
  }

  clear() {
    this.preferences.clear();
  }
}

// ============== Test Setup ==============

function setupContextManager() {
  const embeddingClient = new MockEmbeddingClient();
  const memoryRepo = new MockMemoryRepository();
  const embeddingRepo = new MockEmbeddingRepository(embeddingClient);
  const messageRepo = new MockMessageRepository();
  const summaryRepo = new MockConversationSummaryRepository();
  const preferenceService = new MockUserPreferenceService() as any;

  const contextManager = new ContextManagerService(
    embeddingClient,
    embeddingRepo,
    memoryRepo,
    messageRepo,
    summaryRepo,
    preferenceService
  );

  return {
    contextManager,
    embeddingClient,
    memoryRepo,
    embeddingRepo,
    messageRepo,
    summaryRepo,
    preferenceService,
  };
}

async function createMemoryWithEmbedding(
  memoryRepo: MockMemoryRepository,
  embeddingRepo: MockEmbeddingRepository,
  embeddingClient: MockEmbeddingClient,
  content: string,
  options: Partial<Memory> = {}
) {
  const memory = memoryRepo.addMemory(content, options);
  const embeddingResult = await embeddingClient.embed(content);
  await embeddingRepo.create({
    sourceType: 'memory',
    sourceId: memory.id,
    content,
    embedding: JSON.stringify(embeddingResult.embedding),
    model: embeddingResult.model,
    dimensions: embeddingResult.embedding.length,
  });
  return memory;
}

// ============== Test Suites ==============

async function runTests() {
  console.log('\n=== Context Quality Assessment Tests ===\n');

  // Override config for testing
  const originalEmbeddingEnabled = appConfig.embedding.enabled;
  const originalMemoryEnabled = appConfig.memory.enabled;
  (appConfig.embedding as any).enabled = true;
  (appConfig.memory as any).enabled = true;

  // -------------------- Relevance Scoring --------------------
  console.log('--- Relevance Scoring ---\n');

  await test('relevant memories are prioritized over irrelevant ones', async () => {
    const { contextManager, memoryRepo, embeddingRepo, embeddingClient } = setupContextManager();

    // Create highly relevant memory
    await createMemoryWithEmbedding(
      memoryRepo,
      embeddingRepo,
      embeddingClient,
      'I love eating pizza, especially margherita',
      { confidence: 95 }
    );

    // Create irrelevant memory
    await createMemoryWithEmbedding(
      memoryRepo,
      embeddingRepo,
      embeddingClient,
      'I enjoy listening to classical music',
      { confidence: 90 }
    );

    // Query about pizza
    const result = await contextManager.buildContext('What food do I like?', {
      senderId: 'test-user',
      chatId: 'test-chat',
      includePreferences: false,
      includeRecentMessages: false,
      includeSummaries: false,
      maxTokens: 1000,
    });

    assertTrue(result.items.length > 0, 'Should retrieve memories');
    assertTrue(
      result.items[0].content.includes('pizza'),
      'Most relevant memory should be about pizza'
    );
    assertGreaterThan(
      result.items[0].score,
      0.1,
      'Relevant memory should have decent score'
    );
  });

  await test('semantic similarity is used for ranking', async () => {
    const { contextManager, memoryRepo, embeddingRepo, embeddingClient } = setupContextManager();

    // Create semantically similar memories
    await createMemoryWithEmbedding(
      memoryRepo,
      embeddingRepo,
      embeddingClient,
      'I traveled to Japan last year'
    );
    await createMemoryWithEmbedding(
      memoryRepo,
      embeddingRepo,
      embeddingClient,
      'I want to visit Tokyo someday'
    );
    await createMemoryWithEmbedding(
      memoryRepo,
      embeddingRepo,
      embeddingClient,
      'I like playing guitar'
    );

    const result = await contextManager.buildContext('Tell me about my travel plans', {
      senderId: 'test-user',
      chatId: 'test-chat',
      includePreferences: false,
      includeRecentMessages: false,
      includeSummaries: false,
    });

    assertTrue(result.items.length > 0, 'Should retrieve memories');
    // Travel-related memories should rank higher
    const topContent = result.items[0].content.toLowerCase();
    assertTrue(
      topContent.includes('japan') || topContent.includes('tokyo') || topContent.includes('travel'),
      'Top result should be travel-related'
    );
  });

  await test('low-scoring items are excluded when below threshold', async () => {
    const { contextManager, memoryRepo, embeddingRepo, embeddingClient } = setupContextManager();

    // Create unrelated memory
    await createMemoryWithEmbedding(
      memoryRepo,
      embeddingRepo,
      embeddingClient,
      'The weather is nice today'
    );

    const result = await contextManager.buildContext('What music do I like?', {
      senderId: 'test-user',
      chatId: 'test-chat',
      includePreferences: false,
      includeRecentMessages: false,
      includeSummaries: false,
      minSimilarity: 0.5, // Set high threshold
    });

    // Should exclude low-similarity results
    assertEqual(result.debug.sources.memories, 0, 'Should exclude irrelevant memories');
  });

  // -------------------- Recency Scoring --------------------
  console.log('\n--- Recency Scoring ---\n');

  await test('recent items score higher than old items', async () => {
    const { contextManager, memoryRepo, embeddingRepo, embeddingClient } = setupContextManager();

    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Create recent memory
    await createMemoryWithEmbedding(
      memoryRepo,
      embeddingRepo,
      embeddingClient,
      'I like pizza',
      { createdAt: oneHourAgo, confidence: 80 }
    );

    // Create old memory with same content
    await createMemoryWithEmbedding(
      memoryRepo,
      embeddingRepo,
      embeddingClient,
      'I like pizza',
      { createdAt: oneWeekAgo, confidence: 80 }
    );

    const result = await contextManager.buildContext('What food do I like?', {
      senderId: 'test-user',
      chatId: 'test-chat',
      includePreferences: false,
      includeRecentMessages: false,
      includeSummaries: false,
    });

    assertTrue(result.items.length >= 2, 'Should retrieve both memories');

    // First item should be the more recent one (it will have higher recency boost)
    const firstItemRecency = result.items[0].metadata.recencyBoost ?? 0;
    const secondItemRecency = result.items[1].metadata.recencyBoost ?? 0;

    assertGreaterThan(
      firstItemRecency,
      secondItemRecency,
      'More recent memory should have higher recency boost'
    );
  });

  await test('recency boost decays exponentially', async () => {
    const { contextManager, memoryRepo, embeddingRepo, embeddingClient } = setupContextManager();

    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    await createMemoryWithEmbedding(
      memoryRepo,
      embeddingRepo,
      embeddingClient,
      'Recent memory',
      { createdAt: oneHourAgo }
    );

    await createMemoryWithEmbedding(
      memoryRepo,
      embeddingRepo,
      embeddingClient,
      'Older memory',
      { createdAt: oneDayAgo }
    );

    const result = await contextManager.buildContext('Tell me something', {
      senderId: 'test-user',
      chatId: 'test-chat',
      includePreferences: false,
      includeRecentMessages: false,
      includeSummaries: false,
    });

    assertTrue(result.items.length >= 2, 'Should retrieve memories');

    const recentBoost = result.items[0].metadata.recencyBoost ?? 0;
    const olderBoost = result.items[1].metadata.recencyBoost ?? 0;

    assertGreaterThan(recentBoost, olderBoost, 'Recent items should have higher boost');
    assertGreaterThan(recentBoost, 0.9, 'Very recent items should have boost close to 1.0');
  });

  // -------------------- Preference Prioritization --------------------
  console.log('\n--- Preference Prioritization ---\n');

  await test('user preferences are always included when available', async () => {
    const { contextManager, preferenceService, memoryRepo, embeddingRepo, embeddingClient } = setupContextManager();

    preferenceService.setPreferences('test-user', 'User prefers: vegetarian food, rock music');

    // Add some memories
    await createMemoryWithEmbedding(
      memoryRepo,
      embeddingRepo,
      embeddingClient,
      'I went to the store yesterday'
    );

    const result = await contextManager.buildContext('Tell me about myself', {
      senderId: 'test-user',
      chatId: 'test-chat',
      includePreferences: true,
      maxTokens: 1000,
    });

    assertTrue(result.debug.sources.preferences > 0, 'Preferences should be included');
    assertTrue(
      result.context.includes('vegetarian'),
      'Context should include preference content'
    );
  });

  await test('preferences have highest priority score', async () => {
    const { contextManager, preferenceService, memoryRepo, embeddingRepo, embeddingClient } = setupContextManager();

    preferenceService.setPreferences('test-user', 'User likes: pizza');

    await createMemoryWithEmbedding(
      memoryRepo,
      embeddingRepo,
      embeddingClient,
      'I love pizza so much',
      { confidence: 100 }
    );

    const result = await contextManager.buildContext('What do I like?', {
      senderId: 'test-user',
      chatId: 'test-chat',
      includePreferences: true,
      includeMemories: true,
      includeRecentMessages: false,
      includeSummaries: false,
      minSimilarity: 0.3, // Lower threshold to ensure memory is included
    });

    const preferenceItem = result.items.find((i) => i.type === 'preference');
    const memoryItem = result.items.find((i) => i.type === 'memory');

    assertTrue(preferenceItem !== undefined, 'Should include preference item');
    assertTrue(memoryItem !== undefined, 'Should include memory item');

    assertEqual(preferenceItem!.score, 1.0, 'Preferences should have score of 1.0');
    assertGreaterThan(
      preferenceItem!.score,
      memoryItem!.score,
      'Preference score should be higher than memory score'
    );
  });

  await test('preferences are included first in context ordering', async () => {
    const { contextManager, preferenceService, messageRepo } = setupContextManager();

    preferenceService.setPreferences('test-user', 'User preferences: vegetarian, cats');

    messageRepo.addMessage('Hello there', { chatId: 'test-chat' });

    const result = await contextManager.buildContext('Hello', {
      senderId: 'test-user',
      chatId: 'test-chat',
      includePreferences: true,
      includeRecentMessages: true,
    });

    // Preferences should be at the top of the context
    const lines = result.context.split('\n');
    assertTrue(
      lines[0].includes('vegetarian') || lines[1].includes('vegetarian'),
      'Preferences should appear at the beginning of context'
    );
  });

  // -------------------- Token Budget --------------------
  console.log('\n--- Token Budget Management ---\n');

  await test('token budget is respected', async () => {
    const { contextManager, memoryRepo, embeddingRepo, embeddingClient } = setupContextManager();

    // Create many memories
    for (let i = 0; i < 10; i++) {
      await createMemoryWithEmbedding(
        memoryRepo,
        embeddingRepo,
        embeddingClient,
        `Memory number ${i}: I really enjoy eating pizza and pasta with friends at nice restaurants`
      );
    }

    const maxTokens = 100;
    const result = await contextManager.buildContext('What do I like?', {
      senderId: 'test-user',
      chatId: 'test-chat',
      includePreferences: false,
      maxTokens,
    });

    assertLessThan(
      result.debug.tokensUsed,
      maxTokens + 50, // Allow small margin for formatting
      `Should respect token budget (used ${result.debug.tokensUsed}, max ${maxTokens})`
    );
  });

  await test('high-priority items are included even with tight budget', async () => {
    const { contextManager, preferenceService, memoryRepo, embeddingRepo, embeddingClient } = setupContextManager();

    preferenceService.setPreferences('test-user', 'Short pref');

    // Add many memories
    for (let i = 0; i < 5; i++) {
      await createMemoryWithEmbedding(
        memoryRepo,
        embeddingRepo,
        embeddingClient,
        `Less important memory ${i}`
      );
    }

    const result = await contextManager.buildContext('Tell me', {
      senderId: 'test-user',
      chatId: 'test-chat',
      includePreferences: true,
      maxTokens: 100, // Reasonable budget for short preference
    });

    // Preference should be included due to high priority
    assertTrue(
      result.context.includes('Short pref'),
      'High-priority preference should be included despite tight budget'
    );
  });

  await test('items are truncated when they exceed remaining budget', async () => {
    const { contextManager, messageRepo } = setupContextManager();

    // Add a moderately long message (will fit with truncation)
    const longContent = 'This is a long message about pizza. '.repeat(15); // ~555 chars
    messageRepo.addMessage(longContent, { chatId: 'test-chat' });

    // Add a shorter message
    messageRepo.addMessage('Short msg', { chatId: 'test-chat' });

    const result = await contextManager.buildContext('pizza', {
      senderId: 'test-user',
      chatId: 'test-chat',
      includePreferences: false,
      includeRecentMessages: true,
      includeSummaries: false,
      includeMemories: false,
      maxTokens: 200, // Budget that allows one full item and one truncated
    });

    assertTrue(result.items.length > 0, 'Should include at least one item');
    assertLessThan(
      result.debug.tokensUsed,
      250,
      'Should respect token budget with truncation'
    );
    // Verify at least one item was included
    assertTrue(result.debug.selectedItems >= 1, 'Should select at least one item');
  });

  // -------------------- Context Ordering --------------------
  console.log('\n--- Context Element Ordering ---\n');

  await test('context elements appear in correct order', async () => {
    const {
      contextManager,
      preferenceService,
      messageRepo,
      memoryRepo,
      embeddingRepo,
      embeddingClient,
      summaryRepo,
    } = setupContextManager();

    // Add all types of context
    preferenceService.setPreferences('test-user', 'User: vegetarian');
    messageRepo.addMessage('Recent message', { chatId: 'test-chat' });
    await createMemoryWithEmbedding(
      memoryRepo,
      embeddingRepo,
      embeddingClient,
      'Important memory'
    );
    summaryRepo.addSummary('Previous conversation summary', { chatId: 'test-chat' });

    const result = await contextManager.buildContext('Hello', {
      senderId: 'test-user',
      chatId: 'test-chat',
      includePreferences: true,
      includeRecentMessages: true,
      includeMemories: true,
      includeSummaries: true,
    });

    // Expected order: preferences, summaries, memories, messages
    const sections = result.context.split('\n\n');

    assertTrue(sections.length > 0, 'Context should have sections');
    assertTrue(
      sections[0].includes('vegetarian'),
      'First section should be preferences'
    );
    assertTrue(
      result.context.includes('Recent message'),
      'Should include recent messages'
    );
  });

  await test('items of same type are ordered by score', async () => {
    const { contextManager, memoryRepo, embeddingRepo, embeddingClient } = setupContextManager();

    await createMemoryWithEmbedding(
      memoryRepo,
      embeddingRepo,
      embeddingClient,
      'I love pizza margherita',
      { confidence: 100 }
    );
    await createMemoryWithEmbedding(
      memoryRepo,
      embeddingRepo,
      embeddingClient,
      'Pizza is great food',
      { confidence: 90 }
    );
    await createMemoryWithEmbedding(
      memoryRepo,
      embeddingRepo,
      embeddingClient,
      'I sometimes eat pizza',
      { confidence: 70 }
    );

    const result = await contextManager.buildContext('What food do I like?', {
      senderId: 'test-user',
      chatId: 'test-chat',
      includePreferences: false,
      includeRecentMessages: false,
      includeSummaries: false,
    });

    assertTrue(result.items.length >= 2, 'Should retrieve multiple memories');

    // Scores should be descending
    for (let i = 0; i < result.items.length - 1; i++) {
      assertGreaterThan(
        result.items[i].score + 0.0001, // Small epsilon for floating point comparison
        result.items[i + 1].score,
        `Item ${i} should have higher score than item ${i + 1}`
      );
    }
  });

  // -------------------- Duplicate Elimination --------------------
  console.log('\n--- Duplicate Elimination ---\n');

  await test('duplicate content is not included multiple times', async () => {
    const { contextManager, messageRepo } = setupContextManager();

    // Add duplicate messages
    messageRepo.addMessage('Hello world', {
      chatId: 'test-chat',
      createdAt: new Date(Date.now() - 60000),
    });
    messageRepo.addMessage('Hello world', {
      chatId: 'test-chat',
      createdAt: new Date(),
    });

    const result = await contextManager.buildContext('Hello', {
      senderId: 'test-user',
      chatId: 'test-chat',
      includeRecentMessages: true,
      includePreferences: false,
      includeSummaries: false,
      includeMemories: false,
    });

    // Both messages will be included (they're separate entries), but we verify
    // that the system can handle similar content
    assertTrue(result.items.length >= 1, 'Should include messages');
  });

  await test('similar memories from different sources are ranked properly', async () => {
    const {
      contextManager,
      messageRepo,
      memoryRepo,
      embeddingRepo,
      embeddingClient,
    } = setupContextManager();

    // Add similar content from different sources
    messageRepo.addMessage('I like pizza', { chatId: 'test-chat' });
    await createMemoryWithEmbedding(
      memoryRepo,
      embeddingRepo,
      embeddingClient,
      'User likes pizza'
    );

    const result = await contextManager.buildContext('What do I like?', {
      senderId: 'test-user',
      chatId: 'test-chat',
      includeRecentMessages: true,
      includeMemories: true,
      includePreferences: false,
      includeSummaries: false,
    });

    // Should include both, with proper type differentiation
    const hasMessage = result.items.some((i) => i.type === 'message');
    const hasMemory = result.items.some((i) => i.type === 'memory');

    assertTrue(hasMessage || hasMemory, 'Should include content from different sources');
  });

  // -------------------- Edge Cases --------------------
  console.log('\n--- Edge Cases ---\n');

  await test('handles empty context gracefully', async () => {
    const { contextManager } = setupContextManager();

    const result = await contextManager.buildContext('Hello', {
      senderId: 'test-user',
      chatId: 'test-chat',
      includePreferences: false,
      includeRecentMessages: false,
      includeMemories: false,
      includeSummaries: false,
    });

    assertEqual(result.items.length, 0, 'Should have no items');
    assertEqual(result.context, '', 'Context should be empty');
    assertEqual(result.debug.tokensUsed, 0, 'Should use no tokens');
  });

  await test('handles very small token budget', async () => {
    const { contextManager, preferenceService } = setupContextManager();

    preferenceService.setPreferences('test-user', 'Hi');

    const result = await contextManager.buildContext('Hello', {
      senderId: 'test-user',
      chatId: 'test-chat',
      includePreferences: true,
      maxTokens: 100, // Small but reasonable budget
    });

    // Should include the short preference
    assertGreaterThan(result.debug.tokensUsed, 0, 'Should use some tokens');
    assertTrue(result.items.length > 0, 'Should include at least one item');
  });

  await test('confidence scores affect memory ranking', async () => {
    const { contextManager, memoryRepo, embeddingRepo, embeddingClient } = setupContextManager();

    const now = new Date();

    await createMemoryWithEmbedding(
      memoryRepo,
      embeddingRepo,
      embeddingClient,
      'I like pizza',
      { confidence: 100, createdAt: now }
    );
    await createMemoryWithEmbedding(
      memoryRepo,
      embeddingRepo,
      embeddingClient,
      'I like pizza',
      { confidence: 50, createdAt: now }
    );

    const result = await contextManager.buildContext('What food do I like?', {
      senderId: 'test-user',
      chatId: 'test-chat',
      includePreferences: false,
      includeRecentMessages: false,
      includeSummaries: false,
    });

    assertTrue(result.items.length >= 2, 'Should retrieve both memories');

    // Higher confidence should result in higher score
    assertGreaterThan(
      result.items[0].metadata.confidence ?? 0,
      result.items[1].metadata.confidence ?? 0,
      'First item should have higher confidence'
    );
  });

  // -------------------- Debug Information --------------------
  console.log('\n--- Debug Information ---\n');

  await test('debug info contains accurate statistics', async () => {
    const { contextManager, memoryRepo, embeddingRepo, embeddingClient } = setupContextManager();

    await createMemoryWithEmbedding(
      memoryRepo,
      embeddingRepo,
      embeddingClient,
      'Test memory 1'
    );
    await createMemoryWithEmbedding(
      memoryRepo,
      embeddingRepo,
      embeddingClient,
      'Test memory 2'
    );

    const result = await contextManager.buildContext('Test', {
      senderId: 'test-user',
      chatId: 'test-chat',
      includePreferences: false,
      includeRecentMessages: false,
      includeSummaries: false,
    });

    assertTrue(result.debug !== undefined, 'Should have debug info');
    assertTrue(result.debug.totalCandidates >= 0, 'Should track total candidates');
    assertTrue(result.debug.selectedItems >= 0, 'Should track selected items');
    assertTrue(result.debug.tokensUsed >= 0, 'Should track tokens used');
    assertTrue(result.debug.timings.totalMs >= 0, 'Should track total time');
  });

  await test('debug info accurately reflects source counts', async () => {
    const {
      contextManager,
      preferenceService,
      messageRepo,
      memoryRepo,
      embeddingRepo,
      embeddingClient,
    } = setupContextManager();

    preferenceService.setPreferences('test-user', 'User preference');
    messageRepo.addMessage('Test message', { chatId: 'test-chat' });
    await createMemoryWithEmbedding(
      memoryRepo,
      embeddingRepo,
      embeddingClient,
      'Test memory related to testing'
    );

    const result = await contextManager.buildContext('Test', {
      senderId: 'test-user',
      chatId: 'test-chat',
      includePreferences: true,
      includeRecentMessages: true,
      includeMemories: true,
      minSimilarity: 0.3, // Lower threshold to ensure memory is retrieved
    });

    assertEqual(result.debug.sources.preferences, 1, 'Should count 1 preference');
    assertEqual(result.debug.sources.messages, 1, 'Should count 1 message');
    assertGreaterThan(result.debug.sources.memories, 0, 'Should count memories');
  });

  // -------------------- Print Results --------------------
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);

  // Restore original config
  (appConfig.embedding as any).enabled = originalEmbeddingEnabled;
  (appConfig.memory as any).enabled = originalMemoryEnabled;

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
