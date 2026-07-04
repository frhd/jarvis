#!/usr/bin/env npx tsx
/**
 * Memory and RAG Performance Benchmarks
 *
 * Benchmarks the performance of:
 * - Memory retrieval at various dataset sizes
 * - Embedding similarity search
 * - Context assembly
 * - Token estimation
 *
 * Run: npx tsx tests/performance/memory-benchmarks.test.ts
 */

import { MemoryService } from '../../src/services/memory.service.js';
import { ContextManagerService } from '../../src/services/contextManager.service.js';
import { EmbeddingClient } from '../../src/clients/embedding.client.js';
import { LLMClient } from '../../src/clients/llm.client.js';
import { MemoryRepository, Memory } from '../../src/repositories/memory.repository.js';
import { EmbeddingRepository, SimilarityResult } from '../../src/repositories/embedding.repository.js';
import { MessageRepository } from '../../src/repositories/message.repository.js';
import { ConversationSummaryRepository } from '../../src/repositories/conversationSummary.repository.js';
import { UserPreferenceService } from '../../src/services/userPreference.service.js';
import { Message, Sender } from '../../src/types/index.js';

// ============================================================================
// Performance Thresholds (in milliseconds)
// ============================================================================

const THRESHOLDS = {
  MEMORY_RETRIEVAL_10: 50,      // < 50ms for 10 memories
  MEMORY_RETRIEVAL_100: 100,    // < 100ms for 100 memories
  MEMORY_RETRIEVAL_1000: 500,   // < 500ms for 1000 memories
  EMBEDDING_SEARCH_100: 100,    // < 100ms for searching 100 embeddings
  EMBEDDING_SEARCH_1000: 300,   // < 300ms for searching 1000 embeddings
  CONTEXT_ASSEMBLY_SMALL: 20,   // < 20ms for small context (10 items)
  CONTEXT_ASSEMBLY_LARGE: 50,   // < 50ms for large context (100 items)
  TOKEN_ESTIMATION: 1,          // < 1ms per estimation
  END_TO_END_BUILD: 200,        // < 200ms for complete context build (100 memories)
};

// ============================================================================
// Mock Implementations
// ============================================================================

class MockLLMClient extends LLMClient {
  async chat() {
    return {
      content: JSON.stringify({ facts: [] }),
      model: 'mock-model',
      durationMs: 100,
      promptTokens: 50,
      completionTokens: 20,
      totalTokens: 70,
    };
  }
}

class MockEmbeddingClient extends EmbeddingClient {
  private callCount = 0;

  constructor() {
    super({ baseUrl: 'http://mock', timeoutMs: 5000 });
  }

  async embed(text: string) {
    this.callCount++;
    // Generate a deterministic embedding based on text
    const hash = this.hashString(text);
    const embedding = Array.from({ length: 768 }, (_, i) =>
      Math.sin(hash * (i + 1)) * 0.5 + 0.5
    );

    return {
      embedding,
      model: 'mock-embed',
      totalDuration: 10,
    };
  }

  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash = hash & hash;
    }
    return hash;
  }

  getCallCount() {
    return this.callCount;
  }

  reset() {
    this.callCount = 0;
  }
}

class MockMemoryRepository extends MemoryRepository {
  private memories: Map<string, Memory> = new Map();
  private nextId = 1;

  async create(memory: Omit<Memory, 'id' | 'createdAt' | 'updatedAt'>): Promise<Memory> {
    const id = `mem-${this.nextId++}`;
    const created: Memory = {
      ...memory,
      id,
      senderId: memory.senderId ?? null,
      chatId: memory.chatId ?? null,
      confidence: memory.confidence ?? 100,
      sourceMessageIds: memory.sourceMessageIds ?? null,
      lastAccessedAt: memory.lastAccessedAt ?? null,
      accessCount: memory.accessCount ?? 0,
      isArchived: memory.isArchived ?? false,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Memory;

    this.memories.set(id, created);
    return created;
  }

  async findById(id: string): Promise<Memory | null> {
    return this.memories.get(id) || null;
  }

  async findBySenderId(senderId: string, limit: number = 50): Promise<Memory[]> {
    return Array.from(this.memories.values())
      .filter(m => m.senderId === senderId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  async recordAccess(id: string): Promise<void> {
    const memory = this.memories.get(id);
    if (memory) {
      memory.accessCount++;
      memory.lastAccessedAt = new Date();
    }
  }

  clear() {
    this.memories.clear();
    this.nextId = 1;
  }

  getCount() {
    return this.memories.size;
  }
}

class MockEmbeddingRepository extends EmbeddingRepository {
  private embeddings: Array<{
    id: string;
    sourceType: string;
    sourceId: string;
    content: string;
    embedding: number[];
    model: string;
    dimensions: number;
    createdAt: Date;
  }> = [];
  private nextId = 1;

  async create(embedding: any) {
    const id = `emb-${this.nextId++}`;
    const created = {
      id,
      sourceType: embedding.sourceType,
      sourceId: embedding.sourceId,
      content: embedding.content,
      embedding: JSON.parse(embedding.embedding),
      model: embedding.model,
      dimensions: embedding.dimensions,
      createdAt: new Date(),
    };

    this.embeddings.push(created);
    return created as any;
  }

  async findSimilar(
    queryEmbedding: number[],
    options: {
      limit?: number;
      sourceType?: 'message' | 'memory' | 'preference';
      minSimilarity?: number;
    } = {}
  ): Promise<SimilarityResult[]> {
    const { limit = 10, sourceType, minSimilarity = 0 } = options;

    // Calculate cosine similarity for each embedding
    const results = this.embeddings
      .filter(e => !sourceType || e.sourceType === sourceType)
      .map(e => {
        const similarity = this.cosineSimilarity(queryEmbedding, e.embedding);
        return {
          id: e.id,
          sourceType: e.sourceType,
          sourceId: e.sourceId,
          content: e.content,
          distance: 1 - similarity,
          similarity,
        };
      })
      .filter(r => r.similarity >= minSimilarity)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);

    return results;
  }

  async deleteBySource(sourceType: string, sourceId: string): Promise<boolean> {
    const beforeLength = this.embeddings.length;
    this.embeddings = this.embeddings.filter(
      e => !(e.sourceType === sourceType && e.sourceId === sourceId)
    );
    return this.embeddings.length < beforeLength;
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  clear() {
    this.embeddings = [];
    this.nextId = 1;
  }

  getCount() {
    return this.embeddings.length;
  }
}

class MockMessageRepository extends MessageRepository {
  private messages: Message[] = [];

  async findRecentByChatId(chatId: string, limit: number): Promise<Message[]> {
    return this.messages
      .filter(m => m.chatId === chatId)
      .slice(0, limit);
  }

  addMessage(message: Message) {
    this.messages.unshift(message);
  }

  clear() {
    this.messages = [];
  }
}

class MockConversationSummaryRepository extends ConversationSummaryRepository {
  async findByChatId() {
    return [];
  }
}

class MockUserPreferenceService extends UserPreferenceService {
  async buildContextString() {
    return '';
  }
}

// ============================================================================
// Test Utilities
// ============================================================================

interface BenchmarkResult {
  name: string;
  iterations: number;
  totalMs: number;
  avgMs: number;
  minMs: number;
  maxMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  threshold?: number;
  passed?: boolean;
}

class PerformanceBenchmark {
  private results: BenchmarkResult[] = [];

  async measure(
    name: string,
    fn: () => Promise<void> | void,
    iterations: number = 100,
    threshold?: number
  ): Promise<BenchmarkResult> {
    const timings: number[] = [];

    // Warmup
    for (let i = 0; i < Math.min(10, iterations); i++) {
      await fn();
    }

    // Actual measurements
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      await fn();
      const end = performance.now();
      timings.push(end - start);
    }

    // Calculate statistics
    const sorted = timings.sort((a, b) => a - b);
    const total = timings.reduce((sum, t) => sum + t, 0);
    const avg = total / timings.length;
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const p50 = sorted[Math.floor(sorted.length * 0.5)];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    const p99 = sorted[Math.floor(sorted.length * 0.99)];

    const result: BenchmarkResult = {
      name,
      iterations,
      totalMs: total,
      avgMs: avg,
      minMs: min,
      maxMs: max,
      p50Ms: p50,
      p95Ms: p95,
      p99Ms: p99,
      threshold,
      passed: threshold ? p95 < threshold : undefined,
    };

    this.results.push(result);
    return result;
  }

  async measureSingle(
    name: string,
    fn: () => Promise<void> | void
  ): Promise<number> {
    const start = performance.now();
    await fn();
    const end = performance.now();
    return end - start;
  }

  getResults(): BenchmarkResult[] {
    return this.results;
  }

  printResults() {
    console.log('\n' + '='.repeat(80));
    console.log('PERFORMANCE BENCHMARK RESULTS');
    console.log('='.repeat(80) + '\n');

    for (const result of this.results) {
      const status = result.passed === true ? '✓ PASS' :
                     result.passed === false ? '✗ FAIL' : '  INFO';

      console.log(`${status} ${result.name}`);
      console.log(`  Iterations: ${result.iterations}`);
      console.log(`  Average:    ${result.avgMs.toFixed(2)}ms`);
      console.log(`  Min:        ${result.minMs.toFixed(2)}ms`);
      console.log(`  Max:        ${result.maxMs.toFixed(2)}ms`);
      console.log(`  p50:        ${result.p50Ms.toFixed(2)}ms`);
      console.log(`  p95:        ${result.p95Ms.toFixed(2)}ms`);
      console.log(`  p99:        ${result.p99Ms.toFixed(2)}ms`);

      if (result.threshold !== undefined) {
        console.log(`  Threshold:  < ${result.threshold}ms`);
        console.log(`  Status:     ${result.passed ? 'PASSED' : 'FAILED'}`);
      }
      console.log('');
    }

    // Summary
    const totalTests = this.results.filter(r => r.threshold !== undefined).length;
    const passedTests = this.results.filter(r => r.passed === true).length;
    const failedTests = totalTests - passedTests;

    console.log('='.repeat(80));
    console.log(`SUMMARY: ${passedTests}/${totalTests} passed, ${failedTests} failed`);
    console.log('='.repeat(80) + '\n');

    return failedTests === 0;
  }
}

// ============================================================================
// Data Generation
// ============================================================================

async function generateMemories(
  count: number,
  memoryService: MemoryService,
  senderId: string
): Promise<Memory[]> {
  const memories: Memory[] = [];
  const topics = [
    'programming', 'cooking', 'travel', 'music', 'sports',
    'science', 'art', 'history', 'nature', 'technology'
  ];

  for (let i = 0; i < count; i++) {
    const topic = topics[i % topics.length];
    const content = `User likes ${topic} and has been interested in it for ${i + 1} years. ` +
                   `They mentioned learning about ${topic} techniques and best practices.`;

    const memory = await (memoryService as any).memoryRepo.create({
      senderId,
      chatId: 'test-chat',
      memoryType: 'preference',
      content,
      confidence: Math.floor(Math.random() * 30) + 70,
    });

    // Generate and store embedding
    await (memoryService as any).generateAndStoreEmbedding(memory);

    memories.push(memory);
  }

  return memories;
}

function generateMessages(count: number, chatId: string): Message[] {
  const messages: Message[] = [];
  const baseTime = Date.now();

  for (let i = 0; i < count; i++) {
    messages.push({
      id: `msg-${i}`,
      telegramId: i,
      chatId,
      senderId: 'test-sender',
      text: `This is test message number ${i} about various topics`,
      isBot: i % 2 === 0,
      createdAt: new Date(baseTime - i * 1000),
      updatedAt: new Date(baseTime - i * 1000),
      rawJson: '{}',
      mediaType: null,
      mediaPath: null,
      mediaFileId: null,
    });
  }

  return messages;
}

// ============================================================================
// Benchmark Tests
// ============================================================================

async function runBenchmarks() {
  console.log('Starting memory and RAG performance benchmarks...\n');

  const benchmark = new PerformanceBenchmark();

  // Setup
  const mockLLM = new MockLLMClient({ baseUrl: 'http://mock', timeoutMs: 5000 });
  const mockEmbedding = new MockEmbeddingClient();
  const mockMemoryRepo = new MockMemoryRepository();
  const mockEmbeddingRepo = new MockEmbeddingRepository();
  const mockMessageRepo = new MockMessageRepository();
  const mockSummaryRepo = new MockConversationSummaryRepository();
  const mockUserPrefService = new MockUserPreferenceService(
    null as any,
    null as any,
    null as any
  );

  const memoryService = new MemoryService(
    mockLLM,
    mockEmbedding,
    mockMemoryRepo,
    mockEmbeddingRepo
  );

  const contextManager = new ContextManagerService(
    mockEmbedding,
    mockEmbeddingRepo,
    mockMemoryRepo,
    mockMessageRepo,
    mockSummaryRepo,
    mockUserPrefService
  );

  // ========================================================================
  // Benchmark 1: Memory Retrieval with 10 memories
  // ========================================================================
  console.log('Setting up 10 memories for retrieval test...');
  mockMemoryRepo.clear();
  mockEmbeddingRepo.clear();
  await generateMemories(10, memoryService, 'user-1');

  await benchmark.measure(
    'Memory Retrieval (10 memories)',
    async () => {
      await memoryService.retrieveRelevant('I want to learn about programming', 'user-1', {
        limit: 5,
        minSimilarity: 0.5,
      });
    },
    100,
    THRESHOLDS.MEMORY_RETRIEVAL_10
  );

  // ========================================================================
  // Benchmark 2: Memory Retrieval with 100 memories
  // ========================================================================
  console.log('Setting up 100 memories for retrieval test...');
  mockMemoryRepo.clear();
  mockEmbeddingRepo.clear();
  await generateMemories(100, memoryService, 'user-1');

  await benchmark.measure(
    'Memory Retrieval (100 memories)',
    async () => {
      await memoryService.retrieveRelevant('Tell me about cooking techniques', 'user-1', {
        limit: 10,
        minSimilarity: 0.5,
      });
    },
    50,
    THRESHOLDS.MEMORY_RETRIEVAL_100
  );

  // ========================================================================
  // Benchmark 3: Memory Retrieval with 1000 memories
  // ========================================================================
  console.log('Setting up 1000 memories for retrieval test...');
  mockMemoryRepo.clear();
  mockEmbeddingRepo.clear();
  await generateMemories(1000, memoryService, 'user-1');

  await benchmark.measure(
    'Memory Retrieval (1000 memories)',
    async () => {
      await memoryService.retrieveRelevant('What are good travel destinations?', 'user-1', {
        limit: 10,
        minSimilarity: 0.5,
      });
    },
    20,
    THRESHOLDS.MEMORY_RETRIEVAL_1000
  );

  // ========================================================================
  // Benchmark 4: Embedding Similarity Search (100 embeddings)
  // ========================================================================
  console.log('Testing embedding similarity search with 100 embeddings...');
  mockEmbeddingRepo.clear();

  for (let i = 0; i < 100; i++) {
    const content = `Test content ${i} with various keywords and topics`;
    const embeddingResponse = await mockEmbedding.embed(content);
    await mockEmbeddingRepo.create({
      sourceType: 'memory',
      sourceId: `mem-${i}`,
      content,
      embedding: JSON.stringify(embeddingResponse.embedding),
      model: 'mock',
      dimensions: 768,
    });
  }

  const queryEmbedding = await mockEmbedding.embed('test query about topics');

  await benchmark.measure(
    'Embedding Similarity Search (100 embeddings)',
    async () => {
      await mockEmbeddingRepo.findSimilar(queryEmbedding.embedding, {
        limit: 10,
        sourceType: 'memory',
        minSimilarity: 0.3,
      });
    },
    100,
    THRESHOLDS.EMBEDDING_SEARCH_100
  );

  // ========================================================================
  // Benchmark 5: Embedding Similarity Search (1000 embeddings)
  // ========================================================================
  console.log('Testing embedding similarity search with 1000 embeddings...');
  mockEmbeddingRepo.clear();

  for (let i = 0; i < 1000; i++) {
    const content = `Content item ${i} discussing topics like technology, science, and innovation`;
    const embeddingResponse = await mockEmbedding.embed(content);
    await mockEmbeddingRepo.create({
      sourceType: 'memory',
      sourceId: `mem-${i}`,
      content,
      embedding: JSON.stringify(embeddingResponse.embedding),
      model: 'mock',
      dimensions: 768,
    });
  }

  const queryEmbedding2 = await mockEmbedding.embed('artificial intelligence and machine learning');

  await benchmark.measure(
    'Embedding Similarity Search (1000 embeddings)',
    async () => {
      await mockEmbeddingRepo.findSimilar(queryEmbedding2.embedding, {
        limit: 10,
        sourceType: 'memory',
        minSimilarity: 0.3,
      });
    },
    50,
    THRESHOLDS.EMBEDDING_SEARCH_1000
  );

  // ========================================================================
  // Benchmark 6: Context Assembly (Small - 10 items)
  // ========================================================================
  console.log('Testing context assembly with 10 items...');
  mockMessageRepo.clear();
  const messages10 = generateMessages(10, 'test-chat');
  messages10.forEach(m => mockMessageRepo.addMessage(m));

  await benchmark.measure(
    'Context Assembly (10 items)',
    async () => {
      await contextManager.buildContext('What did we discuss?', {
        chatId: 'test-chat',
        senderId: 'user-1',
        maxTokens: 2000,
        includeMemories: false,
        includeSummaries: false,
        includePreferences: false,
      });
    },
    100,
    THRESHOLDS.CONTEXT_ASSEMBLY_SMALL
  );

  // ========================================================================
  // Benchmark 7: Context Assembly (Large - 100 items)
  // ========================================================================
  console.log('Testing context assembly with 100 items...');
  mockMessageRepo.clear();
  const messages100 = generateMessages(100, 'test-chat');
  messages100.forEach(m => mockMessageRepo.addMessage(m));

  await benchmark.measure(
    'Context Assembly (100 items)',
    async () => {
      await contextManager.buildContext('Summarize our conversation', {
        chatId: 'test-chat',
        senderId: 'user-1',
        maxTokens: 4000,
        includeMemories: false,
        includeSummaries: false,
        includePreferences: false,
        recentMessageCount: 100,
      });
    },
    50,
    THRESHOLDS.CONTEXT_ASSEMBLY_LARGE
  );

  // ========================================================================
  // Benchmark 8: Token Estimation Accuracy
  // ========================================================================
  console.log('Testing token estimation...');
  const testTexts = [
    'Short text',
    'This is a medium length text with some words and punctuation.',
    'This is a much longer text that contains multiple sentences. '.repeat(10),
    'A'.repeat(1000),
  ];

  for (const text of testTexts) {
    await benchmark.measure(
      `Token Estimation (${text.length} chars)`,
      () => {
        // Estimate tokens (4 chars per token)
        const estimated = Math.ceil(text.length / 4);
        return estimated;
      },
      1000,
      THRESHOLDS.TOKEN_ESTIMATION
    );
  }

  // ========================================================================
  // Benchmark 9: End-to-End Context Building (100 memories)
  // ========================================================================
  console.log('Testing end-to-end context building with 100 memories...');
  mockMemoryRepo.clear();
  mockEmbeddingRepo.clear();
  mockMessageRepo.clear();

  await generateMemories(100, memoryService, 'user-1');
  const messages20 = generateMessages(20, 'test-chat');
  messages20.forEach(m => mockMessageRepo.addMessage(m));

  await benchmark.measure(
    'End-to-End Context Build (100 memories + 20 messages)',
    async () => {
      await contextManager.buildContext('Tell me about my preferences and recent conversation', {
        chatId: 'test-chat',
        senderId: 'user-1',
        maxTokens: 4000,
        includeMemories: true,
        includeRecentMessages: true,
        includeSummaries: false,
        includePreferences: false,
        topK: 10,
        minSimilarity: 0.5,
      });
    },
    20,
    THRESHOLDS.END_TO_END_BUILD
  );

  // ========================================================================
  // Benchmark 10: Embedding Generation Speed
  // ========================================================================
  console.log('Testing embedding generation speed...');
  mockEmbedding.reset();

  await benchmark.measure(
    'Embedding Generation (single)',
    async () => {
      await mockEmbedding.embed('This is a test query for embedding generation');
    },
    100
  );

  // ========================================================================
  // Benchmark 11: Duplicate Detection Performance
  // ========================================================================
  console.log('Testing duplicate detection performance...');
  mockMemoryRepo.clear();
  mockEmbeddingRepo.clear();
  await generateMemories(50, memoryService, 'user-1');

  await benchmark.measure(
    'Duplicate Detection (50 memories)',
    async () => {
      // This internally uses embedding similarity search
      await (memoryService as any).checkDuplicate(
        'User likes programming and has been interested in it',
        'user-1'
      );
    },
    50
  );

  // Print results
  const allPassed = benchmark.printResults();

  // Exit with appropriate code
  process.exit(allPassed ? 0 : 1);
}

// ============================================================================
// Run Benchmarks
// ============================================================================

runBenchmarks().catch((err) => {
  console.error('Benchmark error:', err);
  process.exit(1);
});
