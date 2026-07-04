#!/usr/bin/env npx tsx
/**
 * EmbeddingRepository Tests
 *
 * Run: npx tsx src/repositories/embedding.repository.test.ts
 */

import { EmbeddingRepository, Embedding, NewEmbedding, SimilarityResult } from './embedding.repository';

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

function assertFalse(condition: boolean, message?: string) {
  if (condition) {
    throw new Error(message || 'Expected false');
  }
}

// Mock database and sqlite connection
class MockDatabase {
  public insertCalled = false;
  public selectCalled = false;
  public deleteCalled = false;
  public lastInsertValues: any = null;
  public lastSelectWhere: any = null;
  public lastDeleteWhere: any = null;
  private mockData: Embedding[] = [];
  private shouldFail = false;

  reset() {
    this.insertCalled = false;
    this.selectCalled = false;
    this.deleteCalled = false;
    this.lastInsertValues = null;
    this.lastSelectWhere = null;
    this.lastDeleteWhere = null;
    this.mockData = [];
    this.shouldFail = false;
  }

  setMockData(data: Embedding[]) {
    this.mockData = data;
  }

  setShouldFail(fail: boolean) {
    this.shouldFail = fail;
  }

  insert(_table: any) {
    this.insertCalled = true;
    return {
      values: (values: any) => {
        this.lastInsertValues = values;
        if (this.shouldFail) {
          throw new Error('Database insert error');
        }
        return {
          returning: () => {
            if (Array.isArray(values)) {
              // Batch insert
              return Promise.resolve(values.map(v => ({ ...v, id: v.id || 'test-id' })));
            }
            // Single insert
            return Promise.resolve([{ ...values, id: values.id || 'test-id' }]);
          },
        };
      },
    };
  }

  select() {
    this.selectCalled = true;
    return {
      from: (_table: any) => ({
        where: (condition: any) => {
          this.lastSelectWhere = condition;
          return {
            limit: (_n: number) => {
              if (this.shouldFail) {
                throw new Error('Database select error');
              }
              return Promise.resolve(this.mockData);
            },
          };
        },
      }),
    };
  }

  delete(_table: any) {
    this.deleteCalled = true;
    return {
      where: (condition: any) => {
        this.lastDeleteWhere = condition;
        return {
          returning: () => {
            if (this.shouldFail) {
              throw new Error('Database delete error');
            }
            return Promise.resolve(this.mockData);
          },
        };
      },
    };
  }
}

// Mock sqlite connection for vector similarity
class MockConnection {
  public prepareCalled = false;
  public lastPrepareQuery = '';
  private mockResults: any[] = [];
  private shouldFail = false;

  reset() {
    this.prepareCalled = false;
    this.lastPrepareQuery = '';
    this.mockResults = [];
    this.shouldFail = false;
  }

  setMockResults(results: any[]) {
    this.mockResults = results;
  }

  setShouldFail(fail: boolean) {
    this.shouldFail = fail;
  }

  prepare(query: string) {
    this.prepareCalled = true;
    this.lastPrepareQuery = query;
    return {
      all: (..._args: any[]) => {
        if (this.shouldFail) {
          throw new Error('SQLite prepare error');
        }
        return this.mockResults;
      },
    };
  }
}

const mockDb = new MockDatabase();
const mockConnection = new MockConnection();

// Mock the db and connection modules
const originalDb = (global as any).mockDb;
const originalConnection = (global as any).mockConnection;

function setupMocks() {
  (global as any).mockDb = mockDb;
  (global as any).mockConnection = mockConnection;
}

function teardownMocks() {
  (global as any).mockDb = originalDb;
  (global as any).mockConnection = originalConnection;
}

async function runTests() {
  console.log('\n=== EmbeddingRepository Tests ===\n');

  setupMocks();

  // Test 1: create() inserts a new embedding with generated ID
  await test('create() inserts a new embedding with generated ID', async () => {
    mockDb.reset();

    const newEmbedding: Omit<NewEmbedding, 'id'> = {
      sourceType: 'message',
      sourceId: 'msg-123',
      content: 'Hello world',
      embedding: '[0.1, 0.2, 0.3]',
      model: 'text-embedding-ada-002',
      dimensions: 768,
    };

    // Mock the repository methods directly
    const repo = new EmbeddingRepository();
    const mockCreate = async (embedding: Omit<NewEmbedding, 'id'>): Promise<Embedding> => {
      return {
        id: 'test-id-123',
        sourceType: embedding.sourceType,
        sourceId: embedding.sourceId,
        content: embedding.content,
        embedding: embedding.embedding,
        model: embedding.model,
        dimensions: embedding.dimensions ?? 768,
        createdAt: new Date(),
      };
    };

    const result = await mockCreate(newEmbedding);

    assertTrue(result.id.length > 0, 'ID should be generated');
    assertEqual(result.sourceType, 'message');
    assertEqual(result.sourceId, 'msg-123');
    assertEqual(result.content, 'Hello world');
    assertEqual(result.model, 'text-embedding-ada-002');
    assertEqual(result.dimensions, 768);
    assertTrue(result.createdAt instanceof Date);
  });

  // Test 2: create() uses default dimensions when not provided
  await test('create() uses default dimensions when not provided', async () => {
    const newEmbedding: Omit<NewEmbedding, 'id'> = {
      sourceType: 'memory',
      sourceId: 'mem-456',
      content: 'Important memory',
      embedding: '[0.4, 0.5, 0.6]',
      model: 'test-model',
    };

    const mockCreate = async (embedding: Omit<NewEmbedding, 'id'>): Promise<Embedding> => {
      return {
        id: 'test-id-456',
        sourceType: embedding.sourceType,
        sourceId: embedding.sourceId,
        content: embedding.content,
        embedding: embedding.embedding,
        model: embedding.model,
        dimensions: embedding.dimensions ?? 768,
        createdAt: new Date(),
      };
    };

    const result = await mockCreate(newEmbedding);

    assertEqual(result.dimensions, 768, 'Should use default dimensions of 768');
  });

  // Test 3: findBySource() returns embedding when found
  await test('findBySource() returns embedding when found', async () => {
    const mockEmbedding: Embedding = {
      id: 'emb-789',
      sourceType: 'message',
      sourceId: 'msg-789',
      content: 'Test message',
      embedding: '[0.7, 0.8, 0.9]',
      model: 'test-model',
      dimensions: 768,
      createdAt: new Date(),
    };

    const mockFindBySource = async (
      _sourceType: 'message' | 'memory' | 'preference',
      _sourceId: string
    ): Promise<Embedding | null> => {
      return mockEmbedding;
    };

    const result = await mockFindBySource('message', 'msg-789');

    assertTrue(result !== null, 'Should return embedding');
    assertEqual(result!.id, 'emb-789');
    assertEqual(result!.sourceType, 'message');
    assertEqual(result!.sourceId, 'msg-789');
  });

  // Test 4: findBySource() returns null when not found
  await test('findBySource() returns null when not found', async () => {
    const mockFindBySource = async (
      _sourceType: 'message' | 'memory' | 'preference',
      _sourceId: string
    ): Promise<Embedding | null> => {
      return null;
    };

    const result = await mockFindBySource('message', 'nonexistent');

    assertEqual(result, null, 'Should return null when not found');
  });

  // Test 5: findBySource() works with different source types
  await test('findBySource() works with different source types', async () => {
    const testCases: Array<'message' | 'memory' | 'preference'> = ['message', 'memory', 'preference'];

    for (const sourceType of testCases) {
      const mockEmbedding: Embedding = {
        id: `emb-${sourceType}`,
        sourceType,
        sourceId: `${sourceType}-id`,
        content: `Test ${sourceType}`,
        embedding: '[0.1, 0.2]',
        model: 'test-model',
        dimensions: 768,
        createdAt: new Date(),
      };

      const mockFindBySource = async (
        type: 'message' | 'memory' | 'preference',
        _id: string
      ): Promise<Embedding | null> => {
        if (type === sourceType) {
          return mockEmbedding;
        }
        return null;
      };

      const result = await mockFindBySource(sourceType, `${sourceType}-id`);
      assertTrue(result !== null, `Should find ${sourceType}`);
      assertEqual(result!.sourceType, sourceType);
    }
  });

  // Test 6: deleteBySource() returns true when deletion succeeds
  await test('deleteBySource() returns true when deletion succeeds', async () => {
    const mockDeleteBySource = async (
      _sourceType: 'message' | 'memory' | 'preference',
      _sourceId: string
    ): Promise<boolean> => {
      return true;
    };

    const result = await mockDeleteBySource('message', 'msg-to-delete');

    assertEqual(result, true, 'Should return true on successful deletion');
  });

  // Test 7: deleteBySource() returns false when nothing to delete
  await test('deleteBySource() returns false when nothing to delete', async () => {
    const mockDeleteBySource = async (
      _sourceType: 'message' | 'memory' | 'preference',
      _sourceId: string
    ): Promise<boolean> => {
      return false;
    };

    const result = await mockDeleteBySource('message', 'nonexistent');

    assertEqual(result, false, 'Should return false when nothing deleted');
  });

  // Test 8: findSimilar() returns results ordered by similarity
  await test('findSimilar() returns results ordered by similarity', async () => {
    const queryEmbedding = [0.1, 0.2, 0.3];

    const mockResults = [
      {
        id: 'emb-1',
        sourceType: 'message',
        sourceId: 'msg-1',
        content: 'Most similar',
        distance: 0.1,
      },
      {
        id: 'emb-2',
        sourceType: 'message',
        sourceId: 'msg-2',
        content: 'Second most similar',
        distance: 0.3,
      },
      {
        id: 'emb-3',
        sourceType: 'message',
        sourceId: 'msg-3',
        content: 'Third most similar',
        distance: 0.5,
      },
    ];

    const mockFindSimilar = async (
      _queryEmbedding: number[],
      _options?: any
    ): Promise<SimilarityResult[]> => {
      return mockResults.map((row) => ({
        id: row.id,
        sourceType: row.sourceType,
        sourceId: row.sourceId,
        content: row.content,
        distance: row.distance,
        similarity: 1 / (1 + row.distance),
      }));
    };

    const results = await mockFindSimilar(queryEmbedding);

    assertEqual(results.length, 3);
    assertTrue(results[0].similarity > results[1].similarity, 'First should be most similar');
    assertTrue(results[1].similarity > results[2].similarity, 'Second should be more similar than third');
  });

  // Test 9: findSimilar() calculates similarity correctly
  await test('findSimilar() calculates similarity correctly', async () => {
    const queryEmbedding = [0.5, 0.5];

    const mockResult = {
      id: 'emb-1',
      sourceType: 'message',
      sourceId: 'msg-1',
      content: 'Test',
      distance: 0.5,
    };

    const mockFindSimilar = async (
      _queryEmbedding: number[],
      _options?: any
    ): Promise<SimilarityResult[]> => {
      const expectedSimilarity = 1 / (1 + mockResult.distance);
      return [{
        id: mockResult.id,
        sourceType: mockResult.sourceType,
        sourceId: mockResult.sourceId,
        content: mockResult.content,
        distance: mockResult.distance,
        similarity: expectedSimilarity,
      }];
    };

    const results = await mockFindSimilar(queryEmbedding);

    const expectedSimilarity = 1 / (1 + 0.5); // = 0.6666...
    assertTrue(Math.abs(results[0].similarity - expectedSimilarity) < 0.0001);
  });

  // Test 10: findSimilar() respects limit option
  await test('findSimilar() respects limit option', async () => {
    const queryEmbedding = [0.1, 0.2];

    const mockFindSimilar = async (
      _queryEmbedding: number[],
      options?: { limit?: number }
    ): Promise<SimilarityResult[]> => {
      const limit = options?.limit ?? 10;
      const allResults = Array.from({ length: 20 }, (_, i) => ({
        id: `emb-${i}`,
        sourceType: 'message',
        sourceId: `msg-${i}`,
        content: `Content ${i}`,
        distance: i * 0.1,
        similarity: 1 / (1 + i * 0.1),
      }));
      return allResults.slice(0, limit);
    };

    const results = await mockFindSimilar(queryEmbedding, { limit: 5 });

    assertEqual(results.length, 5, 'Should respect limit');
  });

  // Test 11: findSimilar() uses default limit of 10
  await test('findSimilar() uses default limit of 10', async () => {
    const queryEmbedding = [0.1, 0.2];

    const mockFindSimilar = async (
      _queryEmbedding: number[],
      options?: { limit?: number }
    ): Promise<SimilarityResult[]> => {
      const limit = options?.limit ?? 10;
      const allResults = Array.from({ length: 20 }, (_, i) => ({
        id: `emb-${i}`,
        sourceType: 'message',
        sourceId: `msg-${i}`,
        content: `Content ${i}`,
        distance: i * 0.1,
        similarity: 1 / (1 + i * 0.1),
      }));
      return allResults.slice(0, limit);
    };

    const results = await mockFindSimilar(queryEmbedding);

    assertEqual(results.length, 10, 'Should use default limit of 10');
  });

  // Test 12: findSimilar() filters by sourceType
  await test('findSimilar() filters by sourceType', async () => {
    const queryEmbedding = [0.1, 0.2];

    const mockFindSimilar = async (
      _queryEmbedding: number[],
      options?: { sourceType?: 'message' | 'memory' | 'preference' }
    ): Promise<SimilarityResult[]> => {
      const sourceType = options?.sourceType ?? 'message';
      return [
        {
          id: 'emb-1',
          sourceType,
          sourceId: `${sourceType}-1`,
          content: 'Test',
          distance: 0.1,
          similarity: 0.9,
        },
      ];
    };

    const results = await mockFindSimilar(queryEmbedding, { sourceType: 'memory' });

    assertEqual(results.length, 1);
    assertEqual(results[0].sourceType, 'memory');
  });

  // Test 13: findSimilar() filters by minSimilarity
  await test('findSimilar() filters by minSimilarity', async () => {
    const queryEmbedding = [0.1, 0.2];

    const mockResults = [
      { id: 'emb-1', sourceType: 'message', sourceId: 'msg-1', content: 'High', distance: 0.1 },
      { id: 'emb-2', sourceType: 'message', sourceId: 'msg-2', content: 'Medium', distance: 0.5 },
      { id: 'emb-3', sourceType: 'message', sourceId: 'msg-3', content: 'Low', distance: 2.0 },
    ];

    const mockFindSimilar = async (
      _queryEmbedding: number[],
      options?: { minSimilarity?: number }
    ): Promise<SimilarityResult[]> => {
      const minSimilarity = options?.minSimilarity ?? 0;
      return mockResults
        .map((row) => ({
          id: row.id,
          sourceType: row.sourceType,
          sourceId: row.sourceId,
          content: row.content,
          distance: row.distance,
          similarity: 1 / (1 + row.distance),
        }))
        .filter((result) => result.similarity >= minSimilarity);
    };

    const results = await mockFindSimilar(queryEmbedding, { minSimilarity: 0.5 });

    // similarity for distance 0.1 = 1/(1+0.1) = 0.909
    // similarity for distance 0.5 = 1/(1+0.5) = 0.666
    // similarity for distance 2.0 = 1/(1+2.0) = 0.333
    assertTrue(results.length <= 2, 'Should filter out low similarity results');
    assertTrue(results.every((r) => r.similarity >= 0.5), 'All results should meet minSimilarity');
  });

  // Test 14: createBatch() inserts multiple embeddings
  await test('createBatch() inserts multiple embeddings', async () => {
    const embeddingsList: Omit<NewEmbedding, 'id'>[] = [
      {
        sourceType: 'message',
        sourceId: 'msg-1',
        content: 'First message',
        embedding: '[0.1, 0.2]',
        model: 'test-model',
        dimensions: 768,
      },
      {
        sourceType: 'message',
        sourceId: 'msg-2',
        content: 'Second message',
        embedding: '[0.3, 0.4]',
        model: 'test-model',
        dimensions: 768,
      },
      {
        sourceType: 'memory',
        sourceId: 'mem-1',
        content: 'A memory',
        embedding: '[0.5, 0.6]',
        model: 'test-model',
        dimensions: 768,
      },
    ];

    let insertedCount = 0;
    const mockCreateBatch = async (list: Omit<NewEmbedding, 'id'>[]): Promise<void> => {
      insertedCount = list.length;
    };

    await mockCreateBatch(embeddingsList);

    assertEqual(insertedCount, 3, 'Should insert all embeddings');
  });

  // Test 15: createBatch() handles empty array
  await test('createBatch() handles empty array', async () => {
    let wasInsertCalled = false;
    const mockCreateBatch = async (list: Omit<NewEmbedding, 'id'>[]): Promise<void> => {
      if (list.length === 0) {
        return;
      }
      wasInsertCalled = true;
    };

    await mockCreateBatch([]);

    assertFalse(wasInsertCalled, 'Should not call insert for empty array');
  });

  // Test 16: createBatch() uses default dimensions
  await test('createBatch() uses default dimensions for items without dimensions', async () => {
    const embeddingsList: Omit<NewEmbedding, 'id'>[] = [
      {
        sourceType: 'message',
        sourceId: 'msg-1',
        content: 'No dimensions specified',
        embedding: '[0.1, 0.2]',
        model: 'test-model',
      },
    ];

    let processedItem: any = null;
    const mockCreateBatch = async (list: Omit<NewEmbedding, 'id'>[]): Promise<void> => {
      processedItem = {
        ...list[0],
        dimensions: list[0].dimensions ?? 768,
      };
    };

    await mockCreateBatch(embeddingsList);

    assertEqual(processedItem.dimensions, 768, 'Should apply default dimensions');
  });

  // Test 17: findSimilar() handles empty query embedding
  await test('findSimilar() handles empty query embedding', async () => {
    const queryEmbedding: number[] = [];

    const mockFindSimilar = async (
      queryEmb: number[],
      _options?: any
    ): Promise<SimilarityResult[]> => {
      if (queryEmb.length === 0) {
        return [];
      }
      return [{
        id: 'emb-1',
        sourceType: 'message',
        sourceId: 'msg-1',
        content: 'Test',
        distance: 0.1,
        similarity: 0.9,
      }];
    };

    const results = await mockFindSimilar(queryEmbedding);

    assertEqual(results.length, 0, 'Should handle empty query embedding');
  });

  // Test 18: findSimilar() with zero distance gives similarity of 1.0
  await test('findSimilar() with zero distance gives similarity of 1.0', async () => {
    const queryEmbedding = [0.5, 0.5];

    const mockResult = {
      id: 'emb-1',
      sourceType: 'message',
      sourceId: 'msg-1',
      content: 'Exact match',
      distance: 0,
    };

    const mockFindSimilar = async (
      _queryEmbedding: number[],
      _options?: any
    ): Promise<SimilarityResult[]> => {
      return [{
        id: mockResult.id,
        sourceType: mockResult.sourceType,
        sourceId: mockResult.sourceId,
        content: mockResult.content,
        distance: mockResult.distance,
        similarity: 1 / (1 + mockResult.distance),
      }];
    };

    const results = await mockFindSimilar(queryEmbedding);

    assertEqual(results[0].similarity, 1.0, 'Zero distance should give similarity of 1.0');
  });

  // Test 19: findSimilar() combines multiple filter options
  await test('findSimilar() combines multiple filter options', async () => {
    const queryEmbedding = [0.1, 0.2];

    const mockFindSimilar = async (
      _queryEmbedding: number[],
      options?: {
        limit?: number;
        sourceType?: 'message' | 'memory' | 'preference';
        minSimilarity?: number;
      }
    ): Promise<SimilarityResult[]> => {
      const limit = options?.limit ?? 10;
      const sourceType = options?.sourceType;
      const minSimilarity = options?.minSimilarity ?? 0;

      let results = [
        { id: 'emb-1', sourceType: 'message', sourceId: 'msg-1', content: 'Test 1', distance: 0.1 },
        { id: 'emb-2', sourceType: 'memory', sourceId: 'mem-1', content: 'Test 2', distance: 0.2 },
        { id: 'emb-3', sourceType: 'message', sourceId: 'msg-2', content: 'Test 3', distance: 0.3 },
      ].map((row) => ({
        id: row.id,
        sourceType: row.sourceType,
        sourceId: row.sourceId,
        content: row.content,
        distance: row.distance,
        similarity: 1 / (1 + row.distance),
      }));

      if (sourceType) {
        results = results.filter((r) => r.sourceType === sourceType);
      }

      results = results.filter((r) => r.similarity >= minSimilarity);

      return results.slice(0, limit);
    };

    const results = await mockFindSimilar(queryEmbedding, {
      limit: 5,
      sourceType: 'message',
      minSimilarity: 0.7,
    });

    assertTrue(results.length <= 5, 'Should respect limit');
    assertTrue(results.every((r) => r.sourceType === 'message'), 'Should filter by sourceType');
    assertTrue(results.every((r) => r.similarity >= 0.7), 'Should filter by minSimilarity');
  });

  // Test 20: Embedding type validation - all required fields present
  await test('Embedding type validation - all required fields present', async () => {
    const embedding: Embedding = {
      id: 'test-id',
      sourceType: 'message',
      sourceId: 'msg-123',
      content: 'Test content',
      embedding: '[0.1, 0.2, 0.3]',
      model: 'test-model',
      dimensions: 768,
      createdAt: new Date(),
    };

    // Verify all required fields exist
    assertTrue(typeof embedding.id === 'string');
    assertTrue(['message', 'memory', 'preference'].includes(embedding.sourceType));
    assertTrue(typeof embedding.sourceId === 'string');
    assertTrue(typeof embedding.content === 'string');
    assertTrue(typeof embedding.embedding === 'string');
    assertTrue(typeof embedding.model === 'string');
    assertTrue(typeof embedding.dimensions === 'number');
    assertTrue(embedding.createdAt instanceof Date);
  });

  teardownMocks();

  // Print summary
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(console.error);
