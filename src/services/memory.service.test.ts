#!/usr/bin/env npx tsx
/**
 * MemoryService Tests
 *
 * Run: npx tsx src/services/memory.service.test.ts
 */

// Mock appConfig BEFORE importing MemoryService
import * as configModule from '../config/index.js';
const originalConfig = { ...configModule.appConfig };

// Enable memory and embedding for tests
(configModule.appConfig as any).memory = {
  enabled: true,
  maxMemoriesPerSender: 100,
  archiveAfterDays: 90,
  minConfidence: 50, // 0-100 range, normalized to 0-1 in code
};
(configModule.appConfig as any).embedding = {
  enabled: true,
  model: 'nomic-embed-text',
  dimensions: 768,
  timeoutMs: 10000,
};
(configModule.appConfig as any).rag = {
  enabled: true,
  topK: 10,
  similarityThreshold: 0.7,
  recencyDecayHours: 168,
  maxContextTokens: 2000,
  recentMessagesCount: 5,
};

import { MemoryService, ExtractedFact, ExtractionResult } from './memory.service.js';
import { LLMClient, ChatMessage, LLMResponse } from '../clients/llm.client.js';
import { EmbeddingClient, EmbeddingResponse } from '../clients/embedding.client.js';
import { MemoryRepository, Memory } from '../repositories/memory.repository.js';
import { EmbeddingRepository, SimilarityResult } from '../repositories/embedding.repository.js';
import { Message, Sender } from '../types/index.js';

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

function assertGreaterThan(actual: number, expected: number, message?: string) {
  if (actual <= expected) {
    throw new Error(message || `Expected ${actual} > ${expected}`);
  }
}

// Mock LLMClient
class MockLLMClient {
  private response: string;
  private shouldFail: boolean;
  public chatCalled = false;
  public lastMessages: ChatMessage[] = [];

  constructor(options: { response?: string; shouldFail?: boolean } = {}) {
    this.response =
      options.response || '{"facts": [{"type": "fact", "content": "User likes pizza", "confidence": 0.9}]}';
    this.shouldFail = options.shouldFail || false;
  }

  async chat(messages: ChatMessage[], _requestId?: string): Promise<LLMResponse> {
    this.chatCalled = true;
    this.lastMessages = messages;

    if (this.shouldFail) {
      throw new Error('LLM API error');
    }

    return {
      content: this.response,
      model: 'test-model',
      promptEvalCount: 10,
      evalCount: 20,
    };
  }

  setResponse(response: string) {
    this.response = response;
  }
}

// Mock EmbeddingClient
class MockEmbeddingClient {
  private embedding: number[];
  private shouldFail: boolean;
  public embedCalled = false;
  public lastText = '';

  constructor(options: { embedding?: number[]; shouldFail?: boolean } = {}) {
    this.embedding = options.embedding || Array(768).fill(0.1);
    this.shouldFail = options.shouldFail || false;
  }

  async embed(text: string): Promise<EmbeddingResponse> {
    this.embedCalled = true;
    this.lastText = text;

    if (this.shouldFail) {
      throw new Error('Embedding API error');
    }

    return {
      embedding: this.embedding,
      model: 'nomic-embed-text',
      totalDuration: 100,
    };
  }

  setEmbedding(embedding: number[]) {
    this.embedding = embedding;
  }
}

// Mock MemoryRepository
class MockMemoryRepository {
  private memories: Map<string, Memory> = new Map();
  private nextId = 1;
  public createdMemories: Memory[] = [];
  public updatedMemories: Array<{ id: string; updates: Partial<Memory> }> = [];
  public archivedIds: string[] = [];
  public accessedIds: string[] = [];

  async create(memory: Omit<Memory, 'id' | 'createdAt' | 'updatedAt'>): Promise<Memory> {
    const id = `mem-${this.nextId++}`;
    const created: Memory = {
      ...memory,
      id,
      senderId: memory.senderId ?? null,
      chatId: memory.chatId ?? null,
      userId: (memory as any).userId ?? null,
      conversationId: (memory as any).conversationId ?? null,
      confidence: memory.confidence ?? 100,
      sourceMessageIds: memory.sourceMessageIds ?? null,
      lastAccessedAt: memory.lastAccessedAt ?? null,
      accessCount: memory.accessCount ?? 0,
      isArchived: memory.isArchived ?? false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.memories.set(id, created);
    this.createdMemories.push(created);
    return created;
  }

  async findById(id: string): Promise<Memory | null> {
    return this.memories.get(id) || null;
  }

  async findBySenderId(senderId: string, limit: number = 50): Promise<Memory[]> {
    return Array.from(this.memories.values())
      .filter((m) => m.senderId === senderId)
      .slice(0, limit);
  }

  async update(
    id: string,
    updates: Partial<Omit<Memory, 'id' | 'createdAt'>>
  ): Promise<Memory | null> {
    const memory = this.memories.get(id);
    if (!memory) return null;

    const updated = { ...memory, ...updates, updatedAt: new Date() };
    this.memories.set(id, updated);
    this.updatedMemories.push({ id, updates });
    return updated;
  }

  async recordAccess(id: string): Promise<void> {
    this.accessedIds.push(id);
    const memory = this.memories.get(id);
    if (memory) {
      memory.accessCount++;
      memory.lastAccessedAt = new Date();
    }
  }

  async archive(id: string): Promise<void> {
    this.archivedIds.push(id);
    const memory = this.memories.get(id);
    if (memory) {
      memory.isArchived = true;
    }
  }

  async archiveOlderThan(olderThanTimestamp: Date): Promise<number> {
    let count = 0;
    for (const memory of this.memories.values()) {
      if (!memory.isArchived && memory.createdAt < olderThanTimestamp) {
        memory.isArchived = true;
        count++;
      }
    }
    return count;
  }

  seedMemory(memory: Partial<Memory> & { id: string }): Memory {
    const fullMemory: Memory = {
      senderId: null,
      chatId: null,
      userId: null,
      conversationId: null,
      memoryType: 'fact',
      content: 'Test memory',
      confidence: 100,
      sourceMessageIds: null,
      lastAccessedAt: null,
      accessCount: 0,
      isArchived: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...memory,
    };
    this.memories.set(fullMemory.id, fullMemory);
    return fullMemory;
  }
}

// Mock EmbeddingRepository
class MockEmbeddingRepository {
  private embeddings: Map<string, { sourceId: string; embedding: number[] }> = new Map();
  private similarityResults: SimilarityResult[] = [];
  public createdEmbeddings: Array<{ sourceId: string; content: string; embedding: string }> = [];
  public deletedSources: Array<{ sourceType: string; sourceId: string }> = [];

  async create(data: {
    sourceType: string;
    sourceId: string;
    content: string;
    embedding: string;
    model: string;
    dimensions: number;
  }): Promise<void> {
    this.createdEmbeddings.push(data);
    this.embeddings.set(data.sourceId, {
      sourceId: data.sourceId,
      embedding: JSON.parse(data.embedding),
    });
  }

  async findSimilar(
    queryEmbedding: number[],
    options: {
      limit?: number;
      sourceType?: 'message' | 'memory' | 'preference';
      minSimilarity?: number;
    } = {}
  ): Promise<SimilarityResult[]> {
    return this.similarityResults
      .filter((r) => !options.sourceType || r.sourceType === options.sourceType)
      .filter((r) => !options.minSimilarity || r.similarity >= options.minSimilarity)
      .slice(0, options.limit || 10);
  }

  async deleteBySource(
    sourceType: 'message' | 'memory' | 'preference',
    sourceId: string
  ): Promise<boolean> {
    this.deletedSources.push({ sourceType, sourceId });
    return this.embeddings.delete(sourceId);
  }

  setSimilarResults(results: SimilarityResult[]) {
    this.similarityResults = results;
  }
}

// Test fixtures
function createMockMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'msg-123',
    chatId: 'chat-456',
    senderId: 'sender-789',
    telegramMessageId: 1,
    text: 'I love pizza',
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

function createMockSender(overrides: Partial<Sender> = {}): Sender {
  return {
    id: 'sender-789',
    telegramId: '987654',
    firstName: 'Test',
    lastName: 'User',
    username: 'testuser',
    phone: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

async function runTests() {
  console.log('\n=== MemoryService Tests ===\n');

  // Test 1: Extract and store facts from valid message
  await test('extracts and stores facts from valid message', async () => {
    const mockLLM = new MockLLMClient({
      response: JSON.stringify({
        facts: [
          { type: 'preference', content: 'User loves pizza', confidence: 0.9 },
          { type: 'fact', content: 'User lives in NYC', confidence: 0.85 },
        ],
      }),
    });
    const mockEmbedding = new MockEmbeddingClient();
    const mockMemoryRepo = new MockMemoryRepository();
    const mockEmbeddingRepo = new MockEmbeddingRepository();

    const service = new MemoryService(
      mockLLM as unknown as LLMClient,
      mockEmbedding as unknown as EmbeddingClient,
      mockMemoryRepo as unknown as MemoryRepository,
      mockEmbeddingRepo as unknown as EmbeddingRepository
    );

    const result = await service.extractAndStore(
      createMockMessage({ text: 'I love pizza and live in NYC' })
    );

    assertTrue(result.processed);
    assertEqual(result.facts.length, 2);
    assertEqual(mockMemoryRepo.createdMemories.length, 2);
    assertEqual(mockEmbeddingRepo.createdEmbeddings.length, 2);
  });

  // Test 2: Extract facts with conversation context
  await test('includes conversation context in extraction', async () => {
    const mockLLM = new MockLLMClient({
      response: JSON.stringify({
        facts: [{ type: 'preference', content: 'User prefers tea over coffee', confidence: 0.8 }],
      }),
    });
    const mockEmbedding = new MockEmbeddingClient();
    const mockMemoryRepo = new MockMemoryRepository();
    const mockEmbeddingRepo = new MockEmbeddingRepository();

    const service = new MemoryService(
      mockLLM as unknown as LLMClient,
      mockEmbedding as unknown as EmbeddingClient,
      mockMemoryRepo as unknown as MemoryRepository,
      mockEmbeddingRepo as unknown as EmbeddingRepository
    );

    const context: Message[] = [
      createMockMessage({ id: 'msg-1', text: 'Do you like coffee?', isBot: true }),
      createMockMessage({ id: 'msg-2', text: 'I prefer tea', isBot: false }),
    ];

    await service.extractAndStore(
      createMockMessage({ text: 'Yes, definitely tea' }),
      context
    );

    assertTrue(mockLLM.chatCalled);
    const userMessage = mockLLM.lastMessages.find((m) => m.role === 'user');
    assertTrue(userMessage?.content.includes('Do you like coffee') ?? false);
    assertTrue(userMessage?.content.includes('prefer tea') ?? false);
  });

  // Test 3: Skip extraction for empty message
  await test('skips extraction for empty message text', async () => {
    const mockLLM = new MockLLMClient();
    const mockEmbedding = new MockEmbeddingClient();
    const mockMemoryRepo = new MockMemoryRepository();
    const mockEmbeddingRepo = new MockEmbeddingRepository();

    const service = new MemoryService(
      mockLLM as unknown as LLMClient,
      mockEmbedding as unknown as EmbeddingClient,
      mockMemoryRepo as unknown as MemoryRepository,
      mockEmbeddingRepo as unknown as EmbeddingRepository
    );

    const result = await service.extractAndStore(
      createMockMessage({ text: '' })
    );

    assertTrue(!result.processed);
    assertEqual(result.facts.length, 0);
    assertTrue(!mockLLM.chatCalled);
  });

  // Test 4: Filter facts by minimum confidence
  await test('filters facts by minimum confidence threshold', async () => {
    const mockLLM = new MockLLMClient({
      response: JSON.stringify({
        facts: [
          { type: 'fact', content: 'High confidence fact', confidence: 0.9 },
          { type: 'fact', content: 'Low confidence fact', confidence: 0.3 },
        ],
      }),
    });
    const mockEmbedding = new MockEmbeddingClient();
    const mockMemoryRepo = new MockMemoryRepository();
    const mockEmbeddingRepo = new MockEmbeddingRepository();

    const service = new MemoryService(
      mockLLM as unknown as LLMClient,
      mockEmbedding as unknown as EmbeddingClient,
      mockMemoryRepo as unknown as MemoryRepository,
      mockEmbeddingRepo as unknown as EmbeddingRepository
    );

    const result = await service.extractAndStore(
      createMockMessage({ text: 'Test message' })
    );

    // Only stored facts are returned in result.facts
    assertEqual(result.facts.length, 1); // Only high confidence fact returned
    assertEqual(mockMemoryRepo.createdMemories.length, 1); // Only high confidence stored
    assertEqual(mockMemoryRepo.createdMemories[0].content, 'High confidence fact');
  });

  // Test 5: Handle invalid JSON in extraction response
  await test('handles invalid JSON in extraction response with fallback', async () => {
    const mockLLM = new MockLLMClient({
      response: 'This is not valid JSON at all',
    });
    const mockEmbedding = new MockEmbeddingClient();
    const mockMemoryRepo = new MockMemoryRepository();
    const mockEmbeddingRepo = new MockEmbeddingRepository();

    const service = new MemoryService(
      mockLLM as unknown as LLMClient,
      mockEmbedding as unknown as EmbeddingClient,
      mockMemoryRepo as unknown as MemoryRepository,
      mockEmbeddingRepo as unknown as EmbeddingRepository
    );

    const result = await service.extractAndStore(
      createMockMessage({ text: 'Test message' })
    );

    assertTrue(result.processed);
    assertEqual(result.facts.length, 0);
  });

  // Test 6: Extract JSON from response with extra text
  await test('extracts JSON from response with surrounding text', async () => {
    const mockLLM = new MockLLMClient({
      response:
        'Here are my findings: {"facts": [{"type": "fact", "content": "User is 25 years old", "confidence": 0.9}]} That is all.',
    });
    const mockEmbedding = new MockEmbeddingClient();
    const mockMemoryRepo = new MockMemoryRepository();
    const mockEmbeddingRepo = new MockEmbeddingRepository();

    const service = new MemoryService(
      mockLLM as unknown as LLMClient,
      mockEmbedding as unknown as EmbeddingClient,
      mockMemoryRepo as unknown as MemoryRepository,
      mockEmbeddingRepo as unknown as EmbeddingRepository
    );

    const result = await service.extractAndStore(
      createMockMessage({ text: "I'm 25" })
    );

    assertEqual(result.facts.length, 1);
    assertEqual(result.facts[0].content, 'User is 25 years old');
  });

  // Test 7: Validate and normalize fact types
  await test('validates fact types and filters invalid ones', async () => {
    const mockLLM = new MockLLMClient({
      response: JSON.stringify({
        facts: [
          { type: 'fact', content: 'Valid fact', confidence: 0.9 },
          { type: 'invalid_type', content: 'Invalid type', confidence: 0.9 },
          { type: 'preference', content: 'Valid preference', confidence: 0.8 },
        ],
      }),
    });
    const mockEmbedding = new MockEmbeddingClient();
    const mockMemoryRepo = new MockMemoryRepository();
    const mockEmbeddingRepo = new MockEmbeddingRepository();

    const service = new MemoryService(
      mockLLM as unknown as LLMClient,
      mockEmbedding as unknown as EmbeddingClient,
      mockMemoryRepo as unknown as MemoryRepository,
      mockEmbeddingRepo as unknown as EmbeddingRepository
    );

    const result = await service.extractAndStore(
      createMockMessage({ text: 'Test' })
    );

    assertEqual(result.facts.length, 2); // Only valid types
    assertEqual(mockMemoryRepo.createdMemories.length, 2);
  });

  // Test 8: Check duplicate prevents storing similar memories
  await test('checkDuplicate prevents storing similar memories', async () => {
    const mockLLM = new MockLLMClient({
      response: JSON.stringify({
        facts: [{ type: 'fact', content: 'User likes coffee', confidence: 0.9 }],
      }),
    });
    const mockEmbedding = new MockEmbeddingClient();
    const mockMemoryRepo = new MockMemoryRepository();
    const mockEmbeddingRepo = new MockEmbeddingRepository();

    // Seed existing similar memory
    const existingMemory = mockMemoryRepo.seedMemory({
      id: 'mem-existing',
      senderId: 'sender-789',
      content: 'User likes coffee',
    });

    // Set up similarity result
    mockEmbeddingRepo.setSimilarResults([
      {
        id: 'emb-1',
        sourceType: 'memory',
        sourceId: existingMemory.id,
        content: 'User likes coffee',
        distance: 0.1,
        similarity: 0.9,
      },
    ]);

    const service = new MemoryService(
      mockLLM as unknown as LLMClient,
      mockEmbedding as unknown as EmbeddingClient,
      mockMemoryRepo as unknown as MemoryRepository,
      mockEmbeddingRepo as unknown as EmbeddingRepository
    );

    const result = await service.extractAndStore(
      createMockMessage({ text: 'I like coffee' })
    );

    // Duplicate is skipped, so not in result.facts
    assertEqual(result.facts.length, 0);
    // Should not create new memory due to duplicate
    assertEqual(mockMemoryRepo.createdMemories.length, 0);
  });

  // Test 9: Retrieve relevant memories with scoring
  await test('retrieves relevant memories with similarity × recency × confidence scoring', async () => {
    const mockLLM = new MockLLMClient();
    const mockEmbedding = new MockEmbeddingClient();
    const mockMemoryRepo = new MockMemoryRepository();
    const mockEmbeddingRepo = new MockEmbeddingRepository();

    // Seed memories
    const memory1 = mockMemoryRepo.seedMemory({
      id: 'mem-1',
      senderId: 'sender-789',
      content: 'User loves pizza',
      confidence: 90,
      createdAt: new Date(Date.now() - 1000 * 60 * 60), // 1 hour ago
    });

    const memory2 = mockMemoryRepo.seedMemory({
      id: 'mem-2',
      senderId: 'sender-789',
      content: 'User lives in NYC',
      confidence: 80,
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24), // 1 day ago
    });

    // Set similarity results
    mockEmbeddingRepo.setSimilarResults([
      {
        id: 'emb-1',
        sourceType: 'memory',
        sourceId: memory1.id,
        content: memory1.content,
        distance: 0.2,
        similarity: 0.9,
      },
      {
        id: 'emb-2',
        sourceType: 'memory',
        sourceId: memory2.id,
        content: memory2.content,
        distance: 0.3,
        similarity: 0.8,
      },
    ]);

    const service = new MemoryService(
      mockLLM as unknown as LLMClient,
      mockEmbedding as unknown as EmbeddingClient,
      mockMemoryRepo as unknown as MemoryRepository,
      mockEmbeddingRepo as unknown as EmbeddingRepository
    );

    const result = await service.retrieveRelevant('What food does the user like?', 'sender-789');

    assertEqual(result.memories.length, 2);
    assertTrue(result.memories[0].score > 0);
    assertTrue(result.memories[0].similarity > 0);
    assertTrue(result.memories[0].recencyBoost > 0);
    // First memory should score higher (higher similarity, more recent)
    assertTrue(result.memories[0].score > result.memories[1].score);
  });

  // Test 10: Retrieve filters by sender ID
  await test('retrieve filters memories by sender ID', async () => {
    const mockLLM = new MockLLMClient();
    const mockEmbedding = new MockEmbeddingClient();
    const mockMemoryRepo = new MockMemoryRepository();
    const mockEmbeddingRepo = new MockEmbeddingRepository();

    // Seed memories for different senders
    const memory1 = mockMemoryRepo.seedMemory({
      id: 'mem-1',
      senderId: 'sender-789',
      content: 'Sender 1 memory',
    });

    mockMemoryRepo.seedMemory({
      id: 'mem-2',
      senderId: 'sender-999',
      content: 'Sender 2 memory',
    });

    mockEmbeddingRepo.setSimilarResults([
      {
        id: 'emb-1',
        sourceType: 'memory',
        sourceId: 'mem-1',
        content: memory1.content,
        distance: 0.2,
        similarity: 0.9,
      },
      {
        id: 'emb-2',
        sourceType: 'memory',
        sourceId: 'mem-2',
        content: 'Sender 2 memory',
        distance: 0.2,
        similarity: 0.9,
      },
    ]);

    const service = new MemoryService(
      mockLLM as unknown as LLMClient,
      mockEmbedding as unknown as EmbeddingClient,
      mockMemoryRepo as unknown as MemoryRepository,
      mockEmbeddingRepo as unknown as EmbeddingRepository
    );

    const result = await service.retrieveRelevant('test query', 'sender-789');

    assertEqual(result.memories.length, 1);
    assertEqual(result.memories[0].senderId, 'sender-789');
  });

  // Test 11: Retrieve excludes archived memories by default
  await test('retrieve excludes archived memories by default', async () => {
    const mockLLM = new MockLLMClient();
    const mockEmbedding = new MockEmbeddingClient();
    const mockMemoryRepo = new MockMemoryRepository();
    const mockEmbeddingRepo = new MockEmbeddingRepository();

    const archivedMemory = mockMemoryRepo.seedMemory({
      id: 'mem-archived',
      senderId: 'sender-789',
      content: 'Archived memory',
      isArchived: true,
    });

    mockEmbeddingRepo.setSimilarResults([
      {
        id: 'emb-1',
        sourceType: 'memory',
        sourceId: archivedMemory.id,
        content: archivedMemory.content,
        distance: 0.2,
        similarity: 0.9,
      },
    ]);

    const service = new MemoryService(
      mockLLM as unknown as LLMClient,
      mockEmbedding as unknown as EmbeddingClient,
      mockMemoryRepo as unknown as MemoryRepository,
      mockEmbeddingRepo as unknown as EmbeddingRepository
    );

    const result = await service.retrieveRelevant('test query', 'sender-789');

    assertEqual(result.memories.length, 0);
  });

  // Test 12: Retrieve includes archived when requested
  await test('retrieve includes archived memories when requested', async () => {
    const mockLLM = new MockLLMClient();
    const mockEmbedding = new MockEmbeddingClient();
    const mockMemoryRepo = new MockMemoryRepository();
    const mockEmbeddingRepo = new MockEmbeddingRepository();

    const archivedMemory = mockMemoryRepo.seedMemory({
      id: 'mem-archived',
      senderId: 'sender-789',
      content: 'Archived memory',
      isArchived: true,
    });

    mockEmbeddingRepo.setSimilarResults([
      {
        id: 'emb-1',
        sourceType: 'memory',
        sourceId: archivedMemory.id,
        content: archivedMemory.content,
        distance: 0.2,
        similarity: 0.9,
      },
    ]);

    const service = new MemoryService(
      mockLLM as unknown as LLMClient,
      mockEmbedding as unknown as EmbeddingClient,
      mockMemoryRepo as unknown as MemoryRepository,
      mockEmbeddingRepo as unknown as EmbeddingRepository
    );

    const result = await service.retrieveRelevant('test query', 'sender-789', {
      includeArchived: true,
    });

    assertEqual(result.memories.length, 1);
  });

  // Test 13: Retrieve records access for each memory
  await test('retrieve records access for each retrieved memory', async () => {
    const mockLLM = new MockLLMClient();
    const mockEmbedding = new MockEmbeddingClient();
    const mockMemoryRepo = new MockMemoryRepository();
    const mockEmbeddingRepo = new MockEmbeddingRepository();

    const memory = mockMemoryRepo.seedMemory({
      id: 'mem-1',
      senderId: 'sender-789',
      content: 'Test memory',
    });

    mockEmbeddingRepo.setSimilarResults([
      {
        id: 'emb-1',
        sourceType: 'memory',
        sourceId: memory.id,
        content: memory.content,
        distance: 0.2,
        similarity: 0.9,
      },
    ]);

    const service = new MemoryService(
      mockLLM as unknown as LLMClient,
      mockEmbedding as unknown as EmbeddingClient,
      mockMemoryRepo as unknown as MemoryRepository,
      mockEmbeddingRepo as unknown as EmbeddingRepository
    );

    await service.retrieveRelevant('test query', 'sender-789');

    assertTrue(mockMemoryRepo.accessedIds.includes(memory.id));
  });

  // Test 14: Update memory content regenerates embedding
  await test('updateMemory regenerates embedding when content changes', async () => {
    const mockLLM = new MockLLMClient();
    const mockEmbedding = new MockEmbeddingClient();
    const mockMemoryRepo = new MockMemoryRepository();
    const mockEmbeddingRepo = new MockEmbeddingRepository();

    const memory = mockMemoryRepo.seedMemory({
      id: 'mem-1',
      senderId: 'sender-789',
      content: 'Old content',
    });

    const service = new MemoryService(
      mockLLM as unknown as LLMClient,
      mockEmbedding as unknown as EmbeddingClient,
      mockMemoryRepo as unknown as MemoryRepository,
      mockEmbeddingRepo as unknown as EmbeddingRepository
    );

    const updated = await service.updateMemory(memory.id, {
      content: 'New content',
    });

    assertTrue(updated !== null);
    assertEqual(updated?.content, 'New content');
    // Should delete old embedding and create new one
    assertEqual(mockEmbeddingRepo.deletedSources.length, 1);
    assertEqual(mockEmbeddingRepo.createdEmbeddings.length, 1);
    assertEqual(mockEmbeddingRepo.createdEmbeddings[0].content, 'New content');
  });

  // Test 15: Update memory confidence only
  await test('updateMemory updates confidence without regenerating embedding', async () => {
    const mockLLM = new MockLLMClient();
    const mockEmbedding = new MockEmbeddingClient();
    const mockMemoryRepo = new MockMemoryRepository();
    const mockEmbeddingRepo = new MockEmbeddingRepository();

    const memory = mockMemoryRepo.seedMemory({
      id: 'mem-1',
      senderId: 'sender-789',
      content: 'Test content',
      confidence: 80,
    });

    const service = new MemoryService(
      mockLLM as unknown as LLMClient,
      mockEmbedding as unknown as EmbeddingClient,
      mockMemoryRepo as unknown as MemoryRepository,
      mockEmbeddingRepo as unknown as EmbeddingRepository
    );

    const updated = await service.updateMemory(memory.id, {
      confidence: 95,
    });

    assertTrue(updated !== null);
    assertEqual(updated?.confidence, 95);
    // Should not regenerate embedding
    assertEqual(mockEmbeddingRepo.deletedSources.length, 0);
    assertEqual(mockEmbeddingRepo.createdEmbeddings.length, 0);
  });

  // Test 16: Update adds source message ID
  await test('updateMemory adds source message ID to existing list', async () => {
    const mockLLM = new MockLLMClient();
    const mockEmbedding = new MockEmbeddingClient();
    const mockMemoryRepo = new MockMemoryRepository();
    const mockEmbeddingRepo = new MockEmbeddingRepository();

    const memory = mockMemoryRepo.seedMemory({
      id: 'mem-1',
      senderId: 'sender-789',
      content: 'Test content',
      sourceMessageIds: JSON.stringify(['msg-1', 'msg-2']),
    });

    const service = new MemoryService(
      mockLLM as unknown as LLMClient,
      mockEmbedding as unknown as EmbeddingClient,
      mockMemoryRepo as unknown as MemoryRepository,
      mockEmbeddingRepo as unknown as EmbeddingRepository
    );

    const updated = await service.updateMemory(memory.id, {
      addSourceMessageId: 'msg-3',
    });

    assertTrue(updated !== null);
    const sourceIds = JSON.parse(updated?.sourceMessageIds || '[]');
    assertEqual(sourceIds.length, 3);
    assertTrue(sourceIds.includes('msg-3'));
  });

  // Test 17: Consolidate memories merges source IDs
  await test('consolidateMemories merges multiple memories into one', async () => {
    const mockLLM = new MockLLMClient();
    const mockEmbedding = new MockEmbeddingClient();
    const mockMemoryRepo = new MockMemoryRepository();
    const mockEmbeddingRepo = new MockEmbeddingRepository();

    const memory1 = mockMemoryRepo.seedMemory({
      id: 'mem-1',
      senderId: 'sender-789',
      chatId: 'chat-1',
      memoryType: 'preference',
      content: 'User likes pizza',
      sourceMessageIds: JSON.stringify(['msg-1']),
    });

    const memory2 = mockMemoryRepo.seedMemory({
      id: 'mem-2',
      senderId: 'sender-789',
      chatId: 'chat-1',
      memoryType: 'preference',
      content: 'User loves Italian food',
      sourceMessageIds: JSON.stringify(['msg-2']),
    });

    const service = new MemoryService(
      mockLLM as unknown as LLMClient,
      mockEmbedding as unknown as EmbeddingClient,
      mockMemoryRepo as unknown as MemoryRepository,
      mockEmbeddingRepo as unknown as EmbeddingRepository
    );

    const consolidated = await service.consolidateMemories(
      [memory1.id, memory2.id],
      'User loves Italian food, especially pizza',
      95
    );

    assertTrue(consolidated !== null);
    assertEqual(consolidated?.content, 'User loves Italian food, especially pizza');
    assertEqual(consolidated?.confidence, 95);

    const sourceIds = JSON.parse(consolidated?.sourceMessageIds || '[]');
    assertEqual(sourceIds.length, 2);
    assertTrue(sourceIds.includes('msg-1'));
    assertTrue(sourceIds.includes('msg-2'));

    // Original memories should be archived
    assertTrue(mockMemoryRepo.archivedIds.includes(memory1.id));
    assertTrue(mockMemoryRepo.archivedIds.includes(memory2.id));

    // Should create embedding for consolidated memory
    assertEqual(mockEmbeddingRepo.createdEmbeddings.length, 1);
  });

  // Test 18: Consolidate requires at least 2 memories
  await test('consolidateMemories returns null if less than 2 memories', async () => {
    const mockLLM = new MockLLMClient();
    const mockEmbedding = new MockEmbeddingClient();
    const mockMemoryRepo = new MockMemoryRepository();
    const mockEmbeddingRepo = new MockEmbeddingRepository();

    mockMemoryRepo.seedMemory({
      id: 'mem-1',
      senderId: 'sender-789',
      content: 'Single memory',
    });

    const service = new MemoryService(
      mockLLM as unknown as LLMClient,
      mockEmbedding as unknown as EmbeddingClient,
      mockMemoryRepo as unknown as MemoryRepository,
      mockEmbeddingRepo as unknown as EmbeddingRepository
    );

    const consolidated = await service.consolidateMemories(['mem-1'], 'Consolidated content');

    assertTrue(consolidated === null);
  });

  // Test 19: Prune old memories archives them
  await test('pruneOldMemories archives memories older than threshold', async () => {
    const mockLLM = new MockLLMClient();
    const mockEmbedding = new MockEmbeddingClient();
    const mockMemoryRepo = new MockMemoryRepository();
    const mockEmbeddingRepo = new MockEmbeddingRepository();

    // Seed old and recent memories
    const oldDate = new Date(Date.now() - 1000 * 60 * 60 * 24 * 100); // 100 days ago
    const recentDate = new Date(Date.now() - 1000 * 60 * 60 * 24 * 10); // 10 days ago

    mockMemoryRepo.seedMemory({
      id: 'mem-old',
      senderId: 'sender-789',
      content: 'Old memory',
      createdAt: oldDate,
      isArchived: false,
    });

    mockMemoryRepo.seedMemory({
      id: 'mem-recent',
      senderId: 'sender-789',
      content: 'Recent memory',
      createdAt: recentDate,
      isArchived: false,
    });

    const service = new MemoryService(
      mockLLM as unknown as LLMClient,
      mockEmbedding as unknown as EmbeddingClient,
      mockMemoryRepo as unknown as MemoryRepository,
      mockEmbeddingRepo as unknown as EmbeddingRepository
    );

    const archivedCount = await service.pruneOldMemories();

    // archiveAfterDays default is 90 in config
    assertGreaterThan(archivedCount, 0);
  });

  // Test 20: Get stats aggregates memory counts
  await test('getStats returns aggregated memory statistics', async () => {
    const mockLLM = new MockLLMClient();
    const mockEmbedding = new MockEmbeddingClient();
    const mockMemoryRepo = new MockMemoryRepository();
    const mockEmbeddingRepo = new MockEmbeddingRepository();

    // Seed various memories
    mockMemoryRepo.seedMemory({
      id: 'mem-1',
      senderId: 'sender-789',
      memoryType: 'fact',
      content: 'Fact 1',
      isArchived: false,
    });

    mockMemoryRepo.seedMemory({
      id: 'mem-2',
      senderId: 'sender-789',
      memoryType: 'fact',
      content: 'Fact 2',
      isArchived: false,
    });

    mockMemoryRepo.seedMemory({
      id: 'mem-3',
      senderId: 'sender-789',
      memoryType: 'preference',
      content: 'Preference 1',
      isArchived: false,
    });

    mockMemoryRepo.seedMemory({
      id: 'mem-4',
      senderId: 'sender-789',
      memoryType: 'event',
      content: 'Event 1',
      isArchived: true,
    });

    const service = new MemoryService(
      mockLLM as unknown as LLMClient,
      mockEmbedding as unknown as EmbeddingClient,
      mockMemoryRepo as unknown as MemoryRepository,
      mockEmbeddingRepo as unknown as EmbeddingRepository
    );

    const stats = await service.getStats('sender-789');

    assertEqual(stats.totalMemories, 4);
    assertEqual(stats.activeMemories, 3);
    assertEqual(stats.byType['fact'], 2);
    assertEqual(stats.byType['preference'], 1);
    assertTrue(!stats.byType['event']); // Archived, so not in active count
  });

  // Test 21: Handle LLM error during extraction
  await test('handles LLM error during extraction gracefully', async () => {
    const mockLLM = new MockLLMClient({ shouldFail: true });
    const mockEmbedding = new MockEmbeddingClient();
    const mockMemoryRepo = new MockMemoryRepository();
    const mockEmbeddingRepo = new MockEmbeddingRepository();

    const service = new MemoryService(
      mockLLM as unknown as LLMClient,
      mockEmbedding as unknown as EmbeddingClient,
      mockMemoryRepo as unknown as MemoryRepository,
      mockEmbeddingRepo as unknown as EmbeddingRepository
    );

    const result = await service.extractAndStore(
      createMockMessage({ text: 'Test message' })
    );

    assertTrue(!result.processed);
    assertEqual(result.facts.length, 0);
    assertTrue(result.error !== undefined);
  });

  // Test 22: Handle embedding error prevents storage
  await test('handles embedding error by not storing the fact', async () => {
    const mockLLM = new MockLLMClient({
      response: JSON.stringify({
        facts: [{ type: 'fact', content: 'Test fact', confidence: 0.9 }],
      }),
    });
    const mockEmbedding = new MockEmbeddingClient({ shouldFail: true });
    const mockMemoryRepo = new MockMemoryRepository();
    const mockEmbeddingRepo = new MockEmbeddingRepository();

    const service = new MemoryService(
      mockLLM as unknown as LLMClient,
      mockEmbedding as unknown as EmbeddingClient,
      mockMemoryRepo as unknown as MemoryRepository,
      mockEmbeddingRepo as unknown as EmbeddingRepository
    );

    const result = await service.extractAndStore(
      createMockMessage({ text: 'Test message' })
    );

    // Extraction succeeds but embedding fails, so fact is not stored
    assertTrue(result.processed);
    assertEqual(result.facts.length, 0); // Not stored due to embedding error
    assertEqual(mockMemoryRepo.createdMemories.length, 0);
  });

  // Test 23: Normalize confidence to 0-1 range
  await test('normalizes confidence values to 0-1 range', async () => {
    const mockLLM = new MockLLMClient({
      response: JSON.stringify({
        facts: [
          { type: 'fact', content: 'Over range', confidence: 1.5 },
          { type: 'fact', content: 'Normal', confidence: 0.8 },
        ],
      }),
    });
    const mockEmbedding = new MockEmbeddingClient();
    const mockMemoryRepo = new MockMemoryRepository();
    const mockEmbeddingRepo = new MockEmbeddingRepository();

    const service = new MemoryService(
      mockLLM as unknown as LLMClient,
      mockEmbedding as unknown as EmbeddingClient,
      mockMemoryRepo as unknown as MemoryRepository,
      mockEmbeddingRepo as unknown as EmbeddingRepository
    );

    const result = await service.extractAndStore(
      createMockMessage({ text: 'Test' })
    );

    // Both facts should be stored (confidence normalized to max 1.0)
    assertEqual(result.facts.length, 2);
    // First fact normalized from 1.5 to 1.0
    assertTrue(result.facts[0].confidence <= 1.0);
    // Second fact unchanged
    assertEqual(result.facts[1].confidence, 0.8);
  });

  // Test 24: Store memory confidence as percentage
  await test('stores memory confidence as percentage (0-100)', async () => {
    const mockLLM = new MockLLMClient({
      response: JSON.stringify({
        facts: [{ type: 'fact', content: 'Test fact', confidence: 0.85 }],
      }),
    });
    const mockEmbedding = new MockEmbeddingClient();
    const mockMemoryRepo = new MockMemoryRepository();
    const mockEmbeddingRepo = new MockEmbeddingRepository();

    const service = new MemoryService(
      mockLLM as unknown as LLMClient,
      mockEmbedding as unknown as EmbeddingClient,
      mockMemoryRepo as unknown as MemoryRepository,
      mockEmbeddingRepo as unknown as EmbeddingRepository
    );

    await service.extractAndStore(createMockMessage({ text: 'Test' }));

    assertEqual(mockMemoryRepo.createdMemories[0].confidence, 85);
  });

  // Test 25: Handle missing facts array in response
  await test('handles missing facts array in extraction response', async () => {
    const mockLLM = new MockLLMClient({
      response: JSON.stringify({ somethingElse: 'no facts here' }),
    });
    const mockEmbedding = new MockEmbeddingClient();
    const mockMemoryRepo = new MockMemoryRepository();
    const mockEmbeddingRepo = new MockEmbeddingRepository();

    const service = new MemoryService(
      mockLLM as unknown as LLMClient,
      mockEmbedding as unknown as EmbeddingClient,
      mockMemoryRepo as unknown as MemoryRepository,
      mockEmbeddingRepo as unknown as EmbeddingRepository
    );

    const result = await service.extractAndStore(
      createMockMessage({ text: 'Test' })
    );

    assertTrue(result.processed);
    assertEqual(result.facts.length, 0);
  });

  // Test 26: extractAndStore accepts userId and stores it
  await test('extractAndStore stores userId when provided in options', async () => {
    const mockLLM = new MockLLMClient({
      response: JSON.stringify({
        facts: [{ type: 'fact', content: 'User is a developer', confidence: 0.9 }],
      }),
    });
    const mockEmbedding = new MockEmbeddingClient();
    const mockMemoryRepo = new MockMemoryRepository();
    const mockEmbeddingRepo = new MockEmbeddingRepository();

    const service = new MemoryService(
      mockLLM as unknown as LLMClient,
      mockEmbedding as unknown as EmbeddingClient,
      mockMemoryRepo as unknown as MemoryRepository,
      mockEmbeddingRepo as unknown as EmbeddingRepository
    );

    const result = await service.extractAndStore(
      createMockMessage({ text: 'I am a developer' }),
      undefined,
      { userId: 'user-123' }
    );

    assertTrue(result.processed);
    assertEqual(result.facts.length, 1);
    assertEqual(mockMemoryRepo.createdMemories[0].userId, 'user-123');
  });

  // Test 27: extractAndStore stores conversationId when provided
  await test('extractAndStore stores conversationId when provided in options', async () => {
    const mockLLM = new MockLLMClient({
      response: JSON.stringify({
        facts: [{ type: 'preference', content: 'User prefers dark mode', confidence: 0.85 }],
      }),
    });
    const mockEmbedding = new MockEmbeddingClient();
    const mockMemoryRepo = new MockMemoryRepository();
    const mockEmbeddingRepo = new MockEmbeddingRepository();

    const service = new MemoryService(
      mockLLM as unknown as LLMClient,
      mockEmbedding as unknown as EmbeddingClient,
      mockMemoryRepo as unknown as MemoryRepository,
      mockEmbeddingRepo as unknown as EmbeddingRepository
    );

    const result = await service.extractAndStore(
      createMockMessage({ text: 'I prefer dark mode' }),
      undefined,
      { userId: 'user-123', conversationId: 'conv-456' }
    );

    assertTrue(result.processed);
    assertEqual(mockMemoryRepo.createdMemories[0].userId, 'user-123');
    assertEqual(mockMemoryRepo.createdMemories[0].conversationId, 'conv-456');
  });

  // Test 28: Duplicate detection uses userId when provided
  await test('duplicate detection scoped to userId when provided', async () => {
    const mockLLM = new MockLLMClient({
      response: JSON.stringify({
        facts: [{ type: 'fact', content: 'User likes coffee', confidence: 0.9 }],
      }),
    });
    const mockEmbedding = new MockEmbeddingClient();
    const mockMemoryRepo = new MockMemoryRepository();
    const mockEmbeddingRepo = new MockEmbeddingRepository();

    // Seed existing memory with userId
    mockMemoryRepo.seedMemory({
      id: 'mem-existing',
      userId: 'user-123',
      senderId: null,
      content: 'User likes coffee',
    });

    // Set up similarity result pointing to existing memory
    mockEmbeddingRepo.setSimilarResults([
      {
        id: 'emb-1',
        sourceType: 'memory',
        sourceId: 'mem-existing',
        content: 'User likes coffee',
        distance: 0.1,
        similarity: 0.9,
      },
    ]);

    const service = new MemoryService(
      mockLLM as unknown as LLMClient,
      mockEmbedding as unknown as EmbeddingClient,
      mockMemoryRepo as unknown as MemoryRepository,
      mockEmbeddingRepo as unknown as EmbeddingRepository
    );

    const result = await service.extractAndStore(
      createMockMessage({ text: 'I like coffee' }),
      undefined,
      { userId: 'user-123' }
    );

    // Duplicate detected by userId match, so not stored
    assertEqual(result.facts.length, 0);
    assertEqual(mockMemoryRepo.createdMemories.length, 0);
  });

  // Test 29: extractAndStore works with senderId only (backward compat)
  await test('extractAndStore works with senderId only (backward compat)', async () => {
    const mockLLM = new MockLLMClient({
      response: JSON.stringify({
        facts: [{ type: 'fact', content: 'User likes tea', confidence: 0.9 }],
      }),
    });
    const mockEmbedding = new MockEmbeddingClient();
    const mockMemoryRepo = new MockMemoryRepository();
    const mockEmbeddingRepo = new MockEmbeddingRepository();

    const service = new MemoryService(
      mockLLM as unknown as LLMClient,
      mockEmbedding as unknown as EmbeddingClient,
      mockMemoryRepo as unknown as MemoryRepository,
      mockEmbeddingRepo as unknown as EmbeddingRepository
    );

    // No options param — backward compatible call
    const result = await service.extractAndStore(
      createMockMessage({ text: 'I like tea' })
    );

    assertTrue(result.processed);
    assertEqual(result.facts.length, 1);
    assertEqual(mockMemoryRepo.createdMemories[0].senderId, 'sender-789');
    assertEqual(mockMemoryRepo.createdMemories[0].userId, null);
    assertEqual(mockMemoryRepo.createdMemories[0].conversationId, null);
  });

  // Test 30: retrieveRelevant filters by userId via options
  await test('retrieveRelevant filters by userId when provided in options', async () => {
    const mockLLM = new MockLLMClient();
    const mockEmbedding = new MockEmbeddingClient();
    const mockMemoryRepo = new MockMemoryRepository();
    const mockEmbeddingRepo = new MockEmbeddingRepository();

    // Seed memories with different userIds
    mockMemoryRepo.seedMemory({
      id: 'mem-1',
      userId: 'user-123',
      senderId: null,
      content: 'User 1 memory',
    });

    mockMemoryRepo.seedMemory({
      id: 'mem-2',
      userId: 'user-999',
      senderId: null,
      content: 'User 2 memory',
    });

    mockEmbeddingRepo.setSimilarResults([
      {
        id: 'emb-1',
        sourceType: 'memory',
        sourceId: 'mem-1',
        content: 'User 1 memory',
        distance: 0.2,
        similarity: 0.9,
      },
      {
        id: 'emb-2',
        sourceType: 'memory',
        sourceId: 'mem-2',
        content: 'User 2 memory',
        distance: 0.2,
        similarity: 0.9,
      },
    ]);

    const service = new MemoryService(
      mockLLM as unknown as LLMClient,
      mockEmbedding as unknown as EmbeddingClient,
      mockMemoryRepo as unknown as MemoryRepository,
      mockEmbeddingRepo as unknown as EmbeddingRepository
    );

    const result = await service.retrieveRelevant('test query', null, {
      userId: 'user-123',
    });

    assertEqual(result.memories.length, 1);
    assertEqual(result.memories[0].userId, 'user-123');
  });

  // Test 31: retrieveRelevant filters by conversationId via options
  await test('retrieveRelevant filters by conversationId when provided in options', async () => {
    const mockLLM = new MockLLMClient();
    const mockEmbedding = new MockEmbeddingClient();
    const mockMemoryRepo = new MockMemoryRepository();
    const mockEmbeddingRepo = new MockEmbeddingRepository();

    mockMemoryRepo.seedMemory({
      id: 'mem-1',
      conversationId: 'conv-1',
      senderId: null,
      content: 'Conv 1 memory',
    });

    mockMemoryRepo.seedMemory({
      id: 'mem-2',
      conversationId: 'conv-2',
      senderId: null,
      content: 'Conv 2 memory',
    });

    mockEmbeddingRepo.setSimilarResults([
      {
        id: 'emb-1',
        sourceType: 'memory',
        sourceId: 'mem-1',
        content: 'Conv 1 memory',
        distance: 0.2,
        similarity: 0.9,
      },
      {
        id: 'emb-2',
        sourceType: 'memory',
        sourceId: 'mem-2',
        content: 'Conv 2 memory',
        distance: 0.2,
        similarity: 0.9,
      },
    ]);

    const service = new MemoryService(
      mockLLM as unknown as LLMClient,
      mockEmbedding as unknown as EmbeddingClient,
      mockMemoryRepo as unknown as MemoryRepository,
      mockEmbeddingRepo as unknown as EmbeddingRepository
    );

    const result = await service.retrieveRelevant('test query', null, {
      conversationId: 'conv-1',
    });

    assertEqual(result.memories.length, 1);
    assertEqual(result.memories[0].conversationId, 'conv-1');
  });

  // Test 32: retrieveRelevant with senderId still works (backward compat)
  await test('retrieveRelevant with senderId still works (backward compat)', async () => {
    const mockLLM = new MockLLMClient();
    const mockEmbedding = new MockEmbeddingClient();
    const mockMemoryRepo = new MockMemoryRepository();
    const mockEmbeddingRepo = new MockEmbeddingRepository();

    mockMemoryRepo.seedMemory({
      id: 'mem-1',
      senderId: 'sender-789',
      content: 'Sender memory',
    });

    mockMemoryRepo.seedMemory({
      id: 'mem-2',
      senderId: 'sender-other',
      content: 'Other memory',
    });

    mockEmbeddingRepo.setSimilarResults([
      {
        id: 'emb-1',
        sourceType: 'memory',
        sourceId: 'mem-1',
        content: 'Sender memory',
        distance: 0.2,
        similarity: 0.9,
      },
      {
        id: 'emb-2',
        sourceType: 'memory',
        sourceId: 'mem-2',
        content: 'Other memory',
        distance: 0.2,
        similarity: 0.9,
      },
    ]);

    const service = new MemoryService(
      mockLLM as unknown as LLMClient,
      mockEmbedding as unknown as EmbeddingClient,
      mockMemoryRepo as unknown as MemoryRepository,
      mockEmbeddingRepo as unknown as EmbeddingRepository
    );

    // Use legacy senderId param without options.userId
    const result = await service.retrieveRelevant('test query', 'sender-789');

    assertEqual(result.memories.length, 1);
    assertEqual(result.memories[0].senderId, 'sender-789');
  });

  // Print summary
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(console.error);
