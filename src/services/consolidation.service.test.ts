#!/usr/bin/env npx tsx
/**
 * ConsolidationService Tests
 *
 * Run: npx tsx src/services/consolidation.service.test.ts
 */

import { ConsolidationService } from './consolidation.service.js';
import { LLMClient, ChatMessage, LLMResponse } from '../clients/llm.client.js';
import { EmbeddingClient, EmbeddingResponse } from '../clients/embedding.client.js';
import { MemoryRepository, Memory } from '../repositories/memory.repository.js';
import { EmbeddingRepository, SimilarityResult, Embedding } from '../repositories/embedding.repository.js';
import { ConversationSummaryRepository, ConversationSummary } from '../repositories/conversationSummary.repository.js';
import { MessageRepository } from '../repositories/message.repository.js';
import { Message } from '../types/index.js';

// Simple test helpers
let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve(fn())
    .then(() => {
      console.log(`✓ ${name}`);
      passed++;
    })
    .catch((err) => {
      console.log(`✗ ${name}`);
      console.log(`  Error: ${err.message}`);
      failed++;
    });
}

function assertEqual<T>(actual: T, expected: T, message?: string) {
  if (actual !== expected) {
    throw new Error(message || `Expected ${expected}, got ${actual}`);
  }
}

function assertTrue(condition: boolean, message?: string) {
  if (!condition) {
    throw new Error(message || 'Expected true');
  }
}

function assertDeepEqual<T>(actual: T, expected: T, message?: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(message || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// Mock classes
class MockLLMClient {
  private response: LLMResponse;
  private shouldFail: boolean;
  public chatCalled = false;
  public lastMessages: ChatMessage[] = [];

  constructor(options: { response?: Partial<LLMResponse>; shouldFail?: boolean } = {}) {
    this.response = {
      content: options.response?.content || 'Consolidated memory content',
      model: options.response?.model || 'test-model',
      promptEvalCount: options.response?.promptEvalCount ?? 10,
      evalCount: options.response?.evalCount ?? 20,
    };
    this.shouldFail = options.shouldFail || false;
  }

  async chat(messages: ChatMessage[], _requestId?: string): Promise<LLMResponse> {
    this.chatCalled = true;
    this.lastMessages = messages;

    if (this.shouldFail) {
      throw new Error('LLM API error');
    }

    return this.response;
  }

  setResponse(response: Partial<LLMResponse>) {
    this.response = { ...this.response, ...response };
  }

  setFail(shouldFail: boolean) {
    this.shouldFail = shouldFail;
  }
}

class MockEmbeddingClient {
  private response: EmbeddingResponse;
  private shouldFail: boolean;

  constructor(options: { response?: Partial<EmbeddingResponse>; shouldFail?: boolean } = {}) {
    this.response = {
      embedding: options.response?.embedding || [0.1, 0.2, 0.3],
      model: options.response?.model || 'test-embed-model',
      totalDuration: options.response?.totalDuration || 100,
    };
    this.shouldFail = options.shouldFail || false;
  }

  async embed(_text: string): Promise<EmbeddingResponse> {
    if (this.shouldFail) {
      throw new Error('Embedding API error');
    }
    return this.response;
  }
}

class MockMemoryRepository {
  private memories: Memory[] = [];
  public createdMemories: Memory[] = [];
  public archivedIds: string[] = [];

  constructor(initialMemories: Memory[] = []) {
    this.memories = initialMemories;
  }

  async findActiveForSender(senderId: string, limit: number): Promise<Memory[]> {
    return this.memories
      .filter((m) => m.senderId === senderId && !m.isArchived)
      .slice(0, limit);
  }

  async findByType(memoryType: string, limit: number): Promise<Memory[]> {
    return this.memories
      .filter((m) => m.memoryType === memoryType)
      .slice(0, limit);
  }

  async create(data: Omit<Memory, 'id' | 'createdAt' | 'updatedAt'>): Promise<Memory> {
    const memory: Memory = {
      ...data,
      id: `mem-${Date.now()}-${Math.random()}`,
      createdAt: new Date(),
      updatedAt: new Date(),
      isArchived: false,
    };
    this.createdMemories.push(memory);
    this.memories.push(memory);
    return memory;
  }

  async archive(id: string): Promise<void> {
    this.archivedIds.push(id);
    const memory = this.memories.find((m) => m.id === id);
    if (memory) {
      memory.isArchived = true;
    }
  }

  setMemories(memories: Memory[]) {
    this.memories = memories;
  }
}

class MockEmbeddingRepository {
  private embeddings: Map<string, Embedding> = new Map();
  private similarResults: SimilarityResult[] = [];

  async findBySource(sourceType: string, sourceId: string): Promise<Embedding | null> {
    const key = `${sourceType}:${sourceId}`;
    return this.embeddings.get(key) || null;
  }

  async findSimilar(
    _embedding: number[],
    _options: {
      limit: number;
      sourceType?: 'message' | 'memory' | 'preference';
      minSimilarity?: number;
    }
  ): Promise<SimilarityResult[]> {
    return this.similarResults;
  }

  async create(data: Omit<Embedding, 'id' | 'createdAt'>): Promise<Embedding> {
    const embedding: Embedding = {
      ...data,
      id: `emb-${Date.now()}-${Math.random()}`,
      createdAt: new Date(),
    };
    const key = `${data.sourceType}:${data.sourceId}`;
    this.embeddings.set(key, embedding);
    return embedding;
  }

  setEmbedding(sourceType: 'message' | 'memory' | 'preference', sourceId: string, embeddingVector: number[]) {
    const embedding: Embedding = {
      id: `emb-${sourceId}`,
      sourceType,
      sourceId,
      content: 'test content',
      embedding: JSON.stringify(embeddingVector),
      model: 'test-model',
      dimensions: embeddingVector.length,
      createdAt: new Date(),
    };
    const key = `${sourceType}:${sourceId}`;
    this.embeddings.set(key, embedding);
  }

  setSimilarResults(results: Array<{ sourceId: string; similarity: number; sourceType?: string; content?: string }>) {
    this.similarResults = results.map((r, i) => ({
      id: `sim-${i}`,
      sourceType: r.sourceType || 'memory',
      sourceId: r.sourceId,
      content: r.content || 'test content',
      distance: 1 / r.similarity - 1,
      similarity: r.similarity,
    }));
  }
}

class MockConversationSummaryRepository {
  private summaries: ConversationSummary[] = [];
  public createdSummaries: ConversationSummary[] = [];

  async findLatestByChatId(chatId: string): Promise<ConversationSummary | null> {
    const chatSummaries = this.summaries.filter((s) => s.chatId === chatId);
    return chatSummaries.length > 0 ? chatSummaries[chatSummaries.length - 1] : null;
  }

  async create(
    data: Omit<ConversationSummary, 'id' | 'createdAt'>
  ): Promise<ConversationSummary> {
    const summary: ConversationSummary = {
      ...data,
      id: `sum-${Date.now()}-${Math.random()}`,
      createdAt: new Date(),
    };
    this.createdSummaries.push(summary);
    this.summaries.push(summary);
    return summary;
  }

  setSummaries(summaries: ConversationSummary[]) {
    this.summaries = summaries;
  }
}

class MockMessageRepository {
  private messages: Message[] = [];

  constructor(initialMessages: Message[] = []) {
    this.messages = initialMessages;
  }

  async findRecentByChatId(chatId: string, limit: number): Promise<Message[]> {
    return this.messages
      .filter((m) => m.chatId === chatId)
      .slice(0, limit);
  }

  setMessages(messages: Message[]) {
    this.messages = messages;
  }
}

// Test fixtures
function createMockMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: `mem-${Date.now()}-${Math.random()}`,
    senderId: 'sender-123',
    chatId: 'chat-456',
    memoryType: 'fact',
    content: 'User likes pizza',
    confidence: 80,
    sourceMessageIds: JSON.stringify(['msg-1']),
    lastAccessedAt: null,
    accessCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    isArchived: false,
    ...overrides,
  };
}

function createMockMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: `msg-${Date.now()}-${Math.random()}`,
    chatId: 'chat-456',
    senderId: 'sender-789',
    telegramMessageId: 1,
    text: 'Hello there!',
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

// Override appConfig for tests
import { appConfig } from '../config/index.js';
const originalConfig = { ...appConfig };

function enableMemoryAndEmbedding() {
  appConfig.memory = { ...appConfig.memory, enabled: true };
  appConfig.embedding = { ...appConfig.embedding, enabled: true };
}

function disableMemoryAndEmbedding() {
  appConfig.memory = { ...appConfig.memory, enabled: false };
  appConfig.embedding = { ...appConfig.embedding, enabled: false };
}

function resetConfig() {
  Object.assign(appConfig, originalConfig);
}

async function runTests() {
  console.log('\n=== ConsolidationService Tests ===\n');

  // Test 1: consolidateSimilarMemories - returns 0 when memory disabled
  await test('consolidateSimilarMemories returns 0 when memory disabled', async () => {
    disableMemoryAndEmbedding();

    const mockLLM = new MockLLMClient();
    const mockEmbedding = new MockEmbeddingClient();
    const mockMemoryRepo = new MockMemoryRepository();
    const mockEmbeddingRepo = new MockEmbeddingRepository();
    const mockSummaryRepo = new MockConversationSummaryRepository();
    const mockMessageRepo = new MockMessageRepository();

    const service = new ConsolidationService(
      mockLLM as unknown as LLMClient,
      mockEmbedding as unknown as EmbeddingClient,
      mockMemoryRepo as unknown as MemoryRepository,
      mockEmbeddingRepo as unknown as EmbeddingRepository,
      mockSummaryRepo as unknown as ConversationSummaryRepository,
      mockMessageRepo as unknown as MessageRepository
    );

    const count = await service.consolidateSimilarMemories('sender-123');
    assertEqual(count, 0);

    resetConfig();
  });

  // Test 2: consolidateSimilarMemories - returns 0 when less than 2 memories
  await test('consolidateSimilarMemories returns 0 when less than 2 memories', async () => {
    enableMemoryAndEmbedding();

    const mockMemoryRepo = new MockMemoryRepository([createMockMemory()]);
    const mockLLM = new MockLLMClient();
    const mockEmbedding = new MockEmbeddingClient();
    const mockEmbeddingRepo = new MockEmbeddingRepository();
    const mockSummaryRepo = new MockConversationSummaryRepository();
    const mockMessageRepo = new MockMessageRepository();

    const service = new ConsolidationService(
      mockLLM as unknown as LLMClient,
      mockEmbedding as unknown as EmbeddingClient,
      mockMemoryRepo as unknown as MemoryRepository,
      mockEmbeddingRepo as unknown as EmbeddingRepository,
      mockSummaryRepo as unknown as ConversationSummaryRepository,
      mockMessageRepo as unknown as MessageRepository
    );

    const count = await service.consolidateSimilarMemories('sender-123');
    assertEqual(count, 0);

    resetConfig();
  });

  // Test 3: consolidateSimilarMemories - finds and merges similar memories
  await test('consolidateSimilarMemories finds and merges similar memories', async () => {
    enableMemoryAndEmbedding();

    const mem1 = createMockMemory({
      id: 'mem-1',
      content: 'User likes pizza',
      confidence: 80,
    });
    const mem2 = createMockMemory({
      id: 'mem-2',
      content: 'User enjoys pizza on weekends',
      confidence: 85,
    });

    const mockMemoryRepo = new MockMemoryRepository([mem1, mem2]);
    const mockEmbeddingRepo = new MockEmbeddingRepository();

    // Set up embeddings
    mockEmbeddingRepo.setEmbedding('memory', 'mem-1', [0.1, 0.2, 0.3]);
    mockEmbeddingRepo.setEmbedding('memory', 'mem-2', [0.11, 0.21, 0.31]);

    // Set up similarity results - mem-2 is similar to mem-1
    mockEmbeddingRepo.setSimilarResults([
      { sourceId: 'mem-2', similarity: 0.95 },
    ]);

    const mockLLM = new MockLLMClient({
      response: { content: 'User enjoys pizza, especially on weekends' },
    });
    const mockEmbedding = new MockEmbeddingClient();
    const mockSummaryRepo = new MockConversationSummaryRepository();
    const mockMessageRepo = new MockMessageRepository();

    const service = new ConsolidationService(
      mockLLM as unknown as LLMClient,
      mockEmbedding as unknown as EmbeddingClient,
      mockMemoryRepo as unknown as MemoryRepository,
      mockEmbeddingRepo as unknown as EmbeddingRepository,
      mockSummaryRepo as unknown as ConversationSummaryRepository,
      mockMessageRepo as unknown as MessageRepository
    );

    const count = await service.consolidateSimilarMemories('sender-123', 0.75);

    assertEqual(count, 1);
    assertTrue(mockLLM.chatCalled);
    assertTrue(mockMemoryRepo.createdMemories.length > 0);
    assertTrue(mockMemoryRepo.archivedIds.length === 2); // Both original memories archived

    resetConfig();
  });

  // Test 4: consolidateSimilarMemories - handles LLM failure gracefully
  await test('consolidateSimilarMemories handles LLM failure gracefully', async () => {
    enableMemoryAndEmbedding();

    const mem1 = createMockMemory({ id: 'mem-1' });
    const mem2 = createMockMemory({ id: 'mem-2' });

    const mockMemoryRepo = new MockMemoryRepository([mem1, mem2]);
    const mockEmbeddingRepo = new MockEmbeddingRepository();

    mockEmbeddingRepo.setEmbedding('memory', 'mem-1', [0.1, 0.2, 0.3]);
    mockEmbeddingRepo.setEmbedding('memory', 'mem-2', [0.11, 0.21, 0.31]);
    mockEmbeddingRepo.setSimilarResults([{ sourceId: 'mem-2', similarity: 0.95 }]);

    const mockLLM = new MockLLMClient({ shouldFail: true });
    const mockEmbedding = new MockEmbeddingClient();
    const mockSummaryRepo = new MockConversationSummaryRepository();
    const mockMessageRepo = new MockMessageRepository();

    const service = new ConsolidationService(
      mockLLM as unknown as LLMClient,
      mockEmbedding as unknown as EmbeddingClient,
      mockMemoryRepo as unknown as MemoryRepository,
      mockEmbeddingRepo as unknown as EmbeddingRepository,
      mockSummaryRepo as unknown as ConversationSummaryRepository,
      mockMessageRepo as unknown as MessageRepository
    );

    const count = await service.consolidateSimilarMemories('sender-123');

    assertEqual(count, 0); // No consolidation due to failure
    assertTrue(mockMemoryRepo.archivedIds.length === 0); // Nothing archived

    resetConfig();
  });

  // Test 5: consolidateSimilarMemories - only groups memories from same sender
  await test('consolidateSimilarMemories only groups memories from same sender', async () => {
    enableMemoryAndEmbedding();

    const mem1 = createMockMemory({
      id: 'mem-1',
      senderId: 'sender-123',
      content: 'User A likes pizza',
    });
    const mem2 = createMockMemory({
      id: 'mem-2',
      senderId: 'sender-456', // Different sender
      content: 'User B likes pizza',
    });

    const mockMemoryRepo = new MockMemoryRepository([mem1, mem2]);
    const mockEmbeddingRepo = new MockEmbeddingRepository();

    mockEmbeddingRepo.setEmbedding('memory', 'mem-1', [0.1, 0.2, 0.3]);
    mockEmbeddingRepo.setEmbedding('memory', 'mem-2', [0.11, 0.21, 0.31]);
    mockEmbeddingRepo.setSimilarResults([{ sourceId: 'mem-2', similarity: 0.95 }]);

    const mockLLM = new MockLLMClient();
    const mockEmbedding = new MockEmbeddingClient();
    const mockSummaryRepo = new MockConversationSummaryRepository();
    const mockMessageRepo = new MockMessageRepository();

    const service = new ConsolidationService(
      mockLLM as unknown as LLMClient,
      mockEmbedding as unknown as EmbeddingClient,
      mockMemoryRepo as unknown as MemoryRepository,
      mockEmbeddingRepo as unknown as EmbeddingRepository,
      mockSummaryRepo as unknown as ConversationSummaryRepository,
      mockMessageRepo as unknown as MessageRepository
    );

    const count = await service.consolidateSimilarMemories('sender-123');

    // Should not consolidate because mem-2 belongs to different sender
    assertEqual(count, 0);

    resetConfig();
  });

  // Test 6: summarizeConversation - returns null when memory disabled
  await test('summarizeConversation returns null when memory disabled', async () => {
    disableMemoryAndEmbedding();

    const mockLLM = new MockLLMClient();
    const mockEmbedding = new MockEmbeddingClient();
    const mockMemoryRepo = new MockMemoryRepository();
    const mockEmbeddingRepo = new MockEmbeddingRepository();
    const mockSummaryRepo = new MockConversationSummaryRepository();
    const mockMessageRepo = new MockMessageRepository();

    const service = new ConsolidationService(
      mockLLM as unknown as LLMClient,
      mockEmbedding as unknown as EmbeddingClient,
      mockMemoryRepo as unknown as MemoryRepository,
      mockEmbeddingRepo as unknown as EmbeddingRepository,
      mockSummaryRepo as unknown as ConversationSummaryRepository,
      mockMessageRepo as unknown as MessageRepository
    );

    const summary = await service.summarizeConversation('chat-123');
    assertEqual(summary, null);

    resetConfig();
  });

  // Test 7: summarizeConversation - returns null when less than 5 messages
  await test('summarizeConversation returns null when less than 5 messages', async () => {
    enableMemoryAndEmbedding();

    const messages = [
      createMockMessage({ text: 'Hello' }),
      createMockMessage({ text: 'Hi there' }),
    ];

    const mockMessageRepo = new MockMessageRepository(messages);
    const mockLLM = new MockLLMClient();
    const mockEmbedding = new MockEmbeddingClient();
    const mockMemoryRepo = new MockMemoryRepository();
    const mockEmbeddingRepo = new MockEmbeddingRepository();
    const mockSummaryRepo = new MockConversationSummaryRepository();

    const service = new ConsolidationService(
      mockLLM as unknown as LLMClient,
      mockEmbedding as unknown as EmbeddingClient,
      mockMemoryRepo as unknown as MemoryRepository,
      mockEmbeddingRepo as unknown as EmbeddingRepository,
      mockSummaryRepo as unknown as ConversationSummaryRepository,
      mockMessageRepo as unknown as MessageRepository
    );

    const summary = await service.summarizeConversation('chat-123');
    assertEqual(summary, null);

    resetConfig();
  });

  // Test 8: summarizeConversation - creates summary with valid JSON response
  await test('summarizeConversation creates summary with valid JSON response', async () => {
    enableMemoryAndEmbedding();

    const messages = [
      createMockMessage({ id: 'msg-1', chatId: 'chat-123', text: 'Hello', isBot: false }),
      createMockMessage({ id: 'msg-2', chatId: 'chat-123', text: 'Hi!', isBot: true }),
      createMockMessage({ id: 'msg-3', chatId: 'chat-123', text: 'How are you?', isBot: false }),
      createMockMessage({ id: 'msg-4', chatId: 'chat-123', text: 'I am good', isBot: true }),
      createMockMessage({ id: 'msg-5', chatId: 'chat-123', text: 'Great!', isBot: false }),
    ];

    const mockMessageRepo = new MockMessageRepository(messages);
    const mockSummaryRepo = new MockConversationSummaryRepository();

    const jsonResponse = JSON.stringify({
      summary: 'A friendly greeting conversation',
      keyTopics: ['greeting', 'pleasantries'],
    });

    const mockLLM = new MockLLMClient({
      response: { content: jsonResponse },
    });
    const mockEmbedding = new MockEmbeddingClient();
    const mockMemoryRepo = new MockMemoryRepository();
    const mockEmbeddingRepo = new MockEmbeddingRepository();

    const service = new ConsolidationService(
      mockLLM as unknown as LLMClient,
      mockEmbedding as unknown as EmbeddingClient,
      mockMemoryRepo as unknown as MemoryRepository,
      mockEmbeddingRepo as unknown as EmbeddingRepository,
      mockSummaryRepo as unknown as ConversationSummaryRepository,
      mockMessageRepo as unknown as MessageRepository
    );

    const summary = await service.summarizeConversation('chat-123');

    assertTrue(summary !== null, 'Summary should not be null');
    assertEqual(summary?.summary, 'A friendly greeting conversation');
    assertEqual(summary?.messageCount, 5);
    assertEqual(mockSummaryRepo.createdSummaries.length, 1);

    resetConfig();
  });

  // Test 9: summarizeConversation - returns existing summary when no new messages
  await test('summarizeConversation returns existing summary when no new messages', async () => {
    enableMemoryAndEmbedding();

    const messages = [
      createMockMessage({ id: 'msg-5', chatId: 'chat-123', text: 'Hello', isBot: false }),
      createMockMessage({ id: 'msg-4', chatId: 'chat-123', text: 'Hi!', isBot: true }),
      createMockMessage({ id: 'msg-3', chatId: 'chat-123', text: 'How are you?', isBot: false }),
      createMockMessage({ id: 'msg-2', chatId: 'chat-123', text: 'I am good', isBot: true }),
      createMockMessage({ id: 'msg-1', chatId: 'chat-123', text: 'Great!', isBot: false }),
    ];

    const existingSummary: ConversationSummary = {
      id: 'sum-1',
      chatId: 'chat-123',
      startMessageId: 'msg-5',
      endMessageId: 'msg-1',
      messageCount: 5,
      summary: 'Previous summary',
      keyTopics: JSON.stringify(['greeting']),
      createdAt: new Date(),
    };

    const mockMessageRepo = new MockMessageRepository(messages);
    const mockSummaryRepo = new MockConversationSummaryRepository();
    mockSummaryRepo.setSummaries([existingSummary]);

    const mockLLM = new MockLLMClient();
    const mockEmbedding = new MockEmbeddingClient();
    const mockMemoryRepo = new MockMemoryRepository();
    const mockEmbeddingRepo = new MockEmbeddingRepository();

    const service = new ConsolidationService(
      mockLLM as unknown as LLMClient,
      mockEmbedding as unknown as EmbeddingClient,
      mockMemoryRepo as unknown as MemoryRepository,
      mockEmbeddingRepo as unknown as EmbeddingRepository,
      mockSummaryRepo as unknown as ConversationSummaryRepository,
      mockMessageRepo as unknown as MessageRepository
    );

    const summary = await service.summarizeConversation('chat-123');

    assertTrue(summary !== null, 'Should return existing summary');
    assertEqual(summary?.id, 'sum-1');
    assertEqual(mockLLM.chatCalled, false); // Should not call LLM
    assertEqual(mockSummaryRepo.createdSummaries.length, 0); // No new summary created

    resetConfig();
  });

  // Test 10: summarizeConversation - handles invalid JSON response
  await test('summarizeConversation handles invalid JSON response', async () => {
    enableMemoryAndEmbedding();

    const messages = [
      createMockMessage({ id: 'msg-1', text: 'Hello', isBot: false }),
      createMockMessage({ id: 'msg-2', text: 'Hi!', isBot: true }),
      createMockMessage({ id: 'msg-3', text: 'How are you?', isBot: false }),
      createMockMessage({ id: 'msg-4', text: 'I am good', isBot: true }),
      createMockMessage({ id: 'msg-5', text: 'Great!', isBot: false }),
    ];

    const mockMessageRepo = new MockMessageRepository(messages);
    const mockSummaryRepo = new MockConversationSummaryRepository();

    const mockLLM = new MockLLMClient({
      response: { content: 'This is not valid JSON' },
    });
    const mockEmbedding = new MockEmbeddingClient();
    const mockMemoryRepo = new MockMemoryRepository();
    const mockEmbeddingRepo = new MockEmbeddingRepository();

    const service = new ConsolidationService(
      mockLLM as unknown as LLMClient,
      mockEmbedding as unknown as EmbeddingClient,
      mockMemoryRepo as unknown as MemoryRepository,
      mockEmbeddingRepo as unknown as EmbeddingRepository,
      mockSummaryRepo as unknown as ConversationSummaryRepository,
      mockMessageRepo as unknown as MessageRepository
    );

    const summary = await service.summarizeConversation('chat-123');

    assertEqual(summary, null);
    assertTrue(mockSummaryRepo.createdSummaries.length === 0);

    resetConfig();
  });

  // Test 11: summarizeConversation - handles missing summary field in JSON
  await test('summarizeConversation handles missing summary field in JSON', async () => {
    enableMemoryAndEmbedding();

    const messages = [
      createMockMessage({ id: 'msg-1', text: 'Hello', isBot: false }),
      createMockMessage({ id: 'msg-2', text: 'Hi!', isBot: true }),
      createMockMessage({ id: 'msg-3', text: 'How are you?', isBot: false }),
      createMockMessage({ id: 'msg-4', text: 'I am good', isBot: true }),
      createMockMessage({ id: 'msg-5', text: 'Great!', isBot: false }),
    ];

    const mockMessageRepo = new MockMessageRepository(messages);
    const mockSummaryRepo = new MockConversationSummaryRepository();

    const jsonResponse = JSON.stringify({
      keyTopics: ['greeting'],
      // missing summary field
    });

    const mockLLM = new MockLLMClient({
      response: { content: jsonResponse },
    });
    const mockEmbedding = new MockEmbeddingClient();
    const mockMemoryRepo = new MockMemoryRepository();
    const mockEmbeddingRepo = new MockEmbeddingRepository();

    const service = new ConsolidationService(
      mockLLM as unknown as LLMClient,
      mockEmbedding as unknown as EmbeddingClient,
      mockMemoryRepo as unknown as MemoryRepository,
      mockEmbeddingRepo as unknown as EmbeddingRepository,
      mockSummaryRepo as unknown as ConversationSummaryRepository,
      mockMessageRepo as unknown as MessageRepository
    );

    const summary = await service.summarizeConversation('chat-123');

    assertEqual(summary, null);

    resetConfig();
  });

  // Test 12: summarizeConversation - handles LLM failure
  await test('summarizeConversation handles LLM failure', async () => {
    enableMemoryAndEmbedding();

    const messages = [
      createMockMessage({ id: 'msg-1', text: 'Hello', isBot: false }),
      createMockMessage({ id: 'msg-2', text: 'Hi!', isBot: true }),
      createMockMessage({ id: 'msg-3', text: 'How are you?', isBot: false }),
      createMockMessage({ id: 'msg-4', text: 'I am good', isBot: true }),
      createMockMessage({ id: 'msg-5', text: 'Great!', isBot: false }),
    ];

    const mockMessageRepo = new MockMessageRepository(messages);
    const mockSummaryRepo = new MockConversationSummaryRepository();
    const mockLLM = new MockLLMClient({ shouldFail: true });
    const mockEmbedding = new MockEmbeddingClient();
    const mockMemoryRepo = new MockMemoryRepository();
    const mockEmbeddingRepo = new MockEmbeddingRepository();

    const service = new ConsolidationService(
      mockLLM as unknown as LLMClient,
      mockEmbedding as unknown as EmbeddingClient,
      mockMemoryRepo as unknown as MemoryRepository,
      mockEmbeddingRepo as unknown as EmbeddingRepository,
      mockSummaryRepo as unknown as ConversationSummaryRepository,
      mockMessageRepo as unknown as MessageRepository
    );

    const summary = await service.summarizeConversation('chat-123');

    assertEqual(summary, null);

    resetConfig();
  });

  // Test 13: runConsolidationJob - processes multiple senders
  await test('runConsolidationJob processes multiple senders', async () => {
    enableMemoryAndEmbedding();

    const memories = [
      createMockMemory({ id: 'mem-1', senderId: 'sender-1', memoryType: 'fact' }),
      createMockMemory({ id: 'mem-2', senderId: 'sender-1', memoryType: 'fact' }),
      createMockMemory({ id: 'mem-3', senderId: 'sender-2', memoryType: 'fact' }),
      createMockMemory({ id: 'mem-4', senderId: 'sender-2', memoryType: 'fact' }),
    ];

    // Add more memories to exceed threshold of 2
    for (let i = 5; i <= 22; i++) {
      memories.push(createMockMemory({
        id: `mem-${i}`,
        senderId: 'sender-1',
        memoryType: 'fact',
      }));
    }

    const mockMemoryRepo = new MockMemoryRepository(memories);
    const mockEmbeddingRepo = new MockEmbeddingRepository();

    // Set up embeddings for all memories
    for (const mem of memories) {
      mockEmbeddingRepo.setEmbedding('memory', mem.id, [0.1, 0.2, 0.3]);
    }

    // Set up similarity - mem-2 similar to mem-1
    mockEmbeddingRepo.setSimilarResults([
      { sourceId: 'mem-2', similarity: 0.85 },
    ]);

    const mockLLM = new MockLLMClient({
      response: { content: 'Consolidated memory' },
    });
    const mockEmbedding = new MockEmbeddingClient();
    const mockSummaryRepo = new MockConversationSummaryRepository();
    const mockMessageRepo = new MockMessageRepository();

    const service = new ConsolidationService(
      mockLLM as unknown as LLMClient,
      mockEmbedding as unknown as EmbeddingClient,
      mockMemoryRepo as unknown as MemoryRepository,
      mockEmbeddingRepo as unknown as EmbeddingRepository,
      mockSummaryRepo as unknown as ConversationSummaryRepository,
      mockMessageRepo as unknown as MessageRepository
    );

    const result = await service.runConsolidationJob(2);

    assertTrue(result.sendersProcessed >= 1);
    assertTrue(result.memoriesConsolidated >= 0);

    resetConfig();
  });

  // Test 14: runConsolidationJob - skips senders below threshold
  await test('runConsolidationJob skips senders below threshold', async () => {
    enableMemoryAndEmbedding();

    const memories = [
      createMockMemory({ id: 'mem-1', senderId: 'sender-1', memoryType: 'fact' }),
      createMockMemory({ id: 'mem-2', senderId: 'sender-1', memoryType: 'fact' }),
    ];

    const mockMemoryRepo = new MockMemoryRepository(memories);
    const mockEmbeddingRepo = new MockEmbeddingRepository();
    const mockLLM = new MockLLMClient();
    const mockEmbedding = new MockEmbeddingClient();
    const mockSummaryRepo = new MockConversationSummaryRepository();
    const mockMessageRepo = new MockMessageRepository();

    const service = new ConsolidationService(
      mockLLM as unknown as LLMClient,
      mockEmbedding as unknown as EmbeddingClient,
      mockMemoryRepo as unknown as MemoryRepository,
      mockEmbeddingRepo as unknown as EmbeddingRepository,
      mockSummaryRepo as unknown as ConversationSummaryRepository,
      mockMessageRepo as unknown as MessageRepository
    );

    const result = await service.runConsolidationJob(20); // High threshold

    assertEqual(result.sendersProcessed, 0);
    assertEqual(result.memoriesConsolidated, 0);

    resetConfig();
  });

  // Test 15: consolidateGroup - calculates average confidence
  await test('consolidateGroup calculates average confidence correctly', async () => {
    enableMemoryAndEmbedding();

    const mem1 = createMockMemory({
      id: 'mem-1',
      confidence: 70,
      content: 'Memory 1',
    });
    const mem2 = createMockMemory({
      id: 'mem-2',
      confidence: 90,
      content: 'Memory 2',
    });

    const mockMemoryRepo = new MockMemoryRepository([mem1, mem2]);
    const mockEmbeddingRepo = new MockEmbeddingRepository();
    mockEmbeddingRepo.setEmbedding('memory', 'mem-1', [0.1, 0.2, 0.3]);
    mockEmbeddingRepo.setEmbedding('memory', 'mem-2', [0.11, 0.21, 0.31]);
    mockEmbeddingRepo.setSimilarResults([{ sourceId: 'mem-2', similarity: 0.9 }]);

    const mockLLM = new MockLLMClient({
      response: { content: 'Consolidated content here' },
    });
    const mockEmbedding = new MockEmbeddingClient();
    const mockSummaryRepo = new MockConversationSummaryRepository();
    const mockMessageRepo = new MockMessageRepository();

    const service = new ConsolidationService(
      mockLLM as unknown as LLMClient,
      mockEmbedding as unknown as EmbeddingClient,
      mockMemoryRepo as unknown as MemoryRepository,
      mockEmbeddingRepo as unknown as EmbeddingRepository,
      mockSummaryRepo as unknown as ConversationSummaryRepository,
      mockMessageRepo as unknown as MessageRepository
    );

    await service.consolidateSimilarMemories('sender-123');

    const consolidated = mockMemoryRepo.createdMemories[0];
    assertEqual(consolidated.confidence, 80); // Average of 70 and 90

    resetConfig();
  });

  // Test 16: consolidateGroup - merges source message IDs
  await test('consolidateGroup merges source message IDs from all memories', async () => {
    enableMemoryAndEmbedding();

    const mem1 = createMockMemory({
      id: 'mem-1',
      sourceMessageIds: JSON.stringify(['msg-1', 'msg-2']),
      content: 'Memory 1',
    });
    const mem2 = createMockMemory({
      id: 'mem-2',
      sourceMessageIds: JSON.stringify(['msg-3', 'msg-1']), // msg-1 is duplicate
      content: 'Memory 2',
    });

    const mockMemoryRepo = new MockMemoryRepository([mem1, mem2]);
    const mockEmbeddingRepo = new MockEmbeddingRepository();
    mockEmbeddingRepo.setEmbedding('memory', 'mem-1', [0.1, 0.2, 0.3]);
    mockEmbeddingRepo.setEmbedding('memory', 'mem-2', [0.11, 0.21, 0.31]);
    mockEmbeddingRepo.setSimilarResults([{ sourceId: 'mem-2', similarity: 0.9 }]);

    const mockLLM = new MockLLMClient({
      response: { content: 'Consolidated content' },
    });
    const mockEmbedding = new MockEmbeddingClient();
    const mockSummaryRepo = new MockConversationSummaryRepository();
    const mockMessageRepo = new MockMessageRepository();

    const service = new ConsolidationService(
      mockLLM as unknown as LLMClient,
      mockEmbedding as unknown as EmbeddingClient,
      mockMemoryRepo as unknown as MemoryRepository,
      mockEmbeddingRepo as unknown as EmbeddingRepository,
      mockSummaryRepo as unknown as ConversationSummaryRepository,
      mockMessageRepo as unknown as MessageRepository
    );

    await service.consolidateSimilarMemories('sender-123');

    const consolidated = mockMemoryRepo.createdMemories[0];
    const sourceIds = JSON.parse(consolidated.sourceMessageIds || '[]');

    // Should have unique IDs only
    assertTrue(sourceIds.length === 3);
    assertTrue(sourceIds.includes('msg-1'));
    assertTrue(sourceIds.includes('msg-2'));
    assertTrue(sourceIds.includes('msg-3'));

    resetConfig();
  });

  // Test 17: consolidateGroup - skips when LLM returns too short content
  await test('consolidateGroup skips when LLM returns too short content', async () => {
    enableMemoryAndEmbedding();

    const mem1 = createMockMemory({ id: 'mem-1' });
    const mem2 = createMockMemory({ id: 'mem-2' });

    const mockMemoryRepo = new MockMemoryRepository([mem1, mem2]);
    const mockEmbeddingRepo = new MockEmbeddingRepository();
    mockEmbeddingRepo.setEmbedding('memory', 'mem-1', [0.1, 0.2, 0.3]);
    mockEmbeddingRepo.setEmbedding('memory', 'mem-2', [0.11, 0.21, 0.31]);
    mockEmbeddingRepo.setSimilarResults([{ sourceId: 'mem-2', similarity: 0.9 }]);

    const mockLLM = new MockLLMClient({
      response: { content: 'Short' }, // Less than 10 characters
    });
    const mockEmbedding = new MockEmbeddingClient();
    const mockSummaryRepo = new MockConversationSummaryRepository();
    const mockMessageRepo = new MockMessageRepository();

    const service = new ConsolidationService(
      mockLLM as unknown as LLMClient,
      mockEmbedding as unknown as EmbeddingClient,
      mockMemoryRepo as unknown as MemoryRepository,
      mockEmbeddingRepo as unknown as EmbeddingRepository,
      mockSummaryRepo as unknown as ConversationSummaryRepository,
      mockMessageRepo as unknown as MessageRepository
    );

    const count = await service.consolidateSimilarMemories('sender-123');

    assertEqual(count, 0);
    assertTrue(mockMemoryRepo.createdMemories.length === 0);
    assertTrue(mockMemoryRepo.archivedIds.length === 0);

    resetConfig();
  });

  // Test 18: consolidateGroup - creates embedding for consolidated memory
  await test('consolidateGroup creates embedding for consolidated memory', async () => {
    enableMemoryAndEmbedding();

    const mem1 = createMockMemory({ id: 'mem-1' });
    const mem2 = createMockMemory({ id: 'mem-2' });

    const mockMemoryRepo = new MockMemoryRepository([mem1, mem2]);
    const mockEmbeddingRepo = new MockEmbeddingRepository();
    mockEmbeddingRepo.setEmbedding('memory', 'mem-1', [0.1, 0.2, 0.3]);
    mockEmbeddingRepo.setEmbedding('memory', 'mem-2', [0.11, 0.21, 0.31]);
    mockEmbeddingRepo.setSimilarResults([{ sourceId: 'mem-2', similarity: 0.9 }]);

    const mockLLM = new MockLLMClient({
      response: { content: 'Consolidated memory content' },
    });
    const mockEmbedding = new MockEmbeddingClient({
      response: { embedding: [0.5, 0.6, 0.7], model: 'embed-model' },
    });
    const mockSummaryRepo = new MockConversationSummaryRepository();
    const mockMessageRepo = new MockMessageRepository();

    const service = new ConsolidationService(
      mockLLM as unknown as LLMClient,
      mockEmbedding as unknown as EmbeddingClient,
      mockMemoryRepo as unknown as MemoryRepository,
      mockEmbeddingRepo as unknown as EmbeddingRepository,
      mockSummaryRepo as unknown as ConversationSummaryRepository,
      mockMessageRepo as unknown as MessageRepository
    );

    await service.consolidateSimilarMemories('sender-123');

    const consolidated = mockMemoryRepo.createdMemories[0];
    const embedding = await mockEmbeddingRepo.findBySource('memory', consolidated.id);

    assertTrue(embedding !== null);
    assertEqual(embedding?.model, 'embed-model');

    resetConfig();
  });

  // Test 19: summarizeConversation - handles media messages
  await test('summarizeConversation handles media messages', async () => {
    enableMemoryAndEmbedding();

    const messages = [
      createMockMessage({ id: 'msg-1', chatId: 'chat-123', text: 'Check this out', isBot: false }),
      createMockMessage({ id: 'msg-2', chatId: 'chat-123', text: null, mediaType: 'photo', isBot: false }),
      createMockMessage({ id: 'msg-3', chatId: 'chat-123', text: 'Nice!', isBot: true }),
      createMockMessage({ id: 'msg-4', chatId: 'chat-123', text: 'Thanks', isBot: false }),
      createMockMessage({ id: 'msg-5', chatId: 'chat-123', text: 'Welcome', isBot: true }),
    ];

    const mockMessageRepo = new MockMessageRepository(messages);
    const mockSummaryRepo = new MockConversationSummaryRepository();

    const jsonResponse = JSON.stringify({
      summary: 'User shared a photo',
      keyTopics: ['media', 'photo'],
    });

    const mockLLM = new MockLLMClient({
      response: { content: jsonResponse },
    });
    const mockEmbedding = new MockEmbeddingClient();
    const mockMemoryRepo = new MockMemoryRepository();
    const mockEmbeddingRepo = new MockEmbeddingRepository();

    const service = new ConsolidationService(
      mockLLM as unknown as LLMClient,
      mockEmbedding as unknown as EmbeddingClient,
      mockMemoryRepo as unknown as MemoryRepository,
      mockEmbeddingRepo as unknown as EmbeddingRepository,
      mockSummaryRepo as unknown as ConversationSummaryRepository,
      mockMessageRepo as unknown as MessageRepository
    );

    const summary = await service.summarizeConversation('chat-123');

    assertTrue(summary !== null, 'Summary should not be null');
    assertEqual(mockLLM.chatCalled, true);
    // Verify that [media] placeholder was used
    const messageContent = mockLLM.lastMessages[0].content;
    assertTrue(messageContent.includes('[media]'), 'Should include [media] placeholder for null text');

    resetConfig();
  });

  // Test 20: groupSimilarMemories - handles empty embeddings
  await test('groupSimilarMemories handles memories without embeddings', async () => {
    enableMemoryAndEmbedding();

    const mem1 = createMockMemory({ id: 'mem-1' });
    const mem2 = createMockMemory({ id: 'mem-2' });

    const mockMemoryRepo = new MockMemoryRepository([mem1, mem2]);
    const mockEmbeddingRepo = new MockEmbeddingRepository();
    // Only set embedding for mem-2, not mem-1
    mockEmbeddingRepo.setEmbedding('memory', 'mem-2', [0.1, 0.2, 0.3]);

    const mockLLM = new MockLLMClient();
    const mockEmbedding = new MockEmbeddingClient();
    const mockSummaryRepo = new MockConversationSummaryRepository();
    const mockMessageRepo = new MockMessageRepository();

    const service = new ConsolidationService(
      mockLLM as unknown as LLMClient,
      mockEmbedding as unknown as EmbeddingClient,
      mockMemoryRepo as unknown as MemoryRepository,
      mockEmbeddingRepo as unknown as EmbeddingRepository,
      mockSummaryRepo as unknown as ConversationSummaryRepository,
      mockMessageRepo as unknown as MessageRepository
    );

    const count = await service.consolidateSimilarMemories('sender-123');

    // Should handle gracefully and not crash
    assertEqual(count, 0);

    resetConfig();
  });

  // Print summary
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(console.error);
