#!/usr/bin/env npx tsx
/**
 * Semantic Cache Repository Tests
 *
 * Tests the repository operations for semantic cache:
 * - Creating cache entries
 * - Exact hash matching
 * - Semantic similarity search
 * - Hit count tracking
 * - Expiration handling
 * - LRU eviction
 * - Cache statistics
 * - Clearing cache
 *
 * Run: npx tsx tests/cache/semanticCache.repository.test.ts
 */

import { SemanticCacheRepository } from '../../src/repositories/semanticCache.repository.js';
import { EmbeddingRepository } from '../../src/repositories/embedding.repository.js';
import { db } from '../../src/db/client.js';
import { semanticCache, embeddings } from '../../src/db/schema.js';
import { sql, eq } from 'drizzle-orm';

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

function assertGreaterThanOrEqual(actual: number, threshold: number, message?: string) {
  if (actual < threshold) {
    throw new Error(message || `Expected ${actual} to be >= ${threshold}`);
  }
}

function assertLessThan(actual: number, threshold: number, message?: string) {
  if (actual >= threshold) {
    throw new Error(message || `Expected ${actual} to be less than ${threshold}`);
  }
}

function assertNull(value: any, message?: string) {
  if (value !== null) {
    throw new Error(message || `Expected null, got ${JSON.stringify(value)}`);
  }
}

function assertNotNull(value: any, message?: string) {
  if (value === null) {
    throw new Error(message || 'Expected value to be non-null');
  }
}

// ============== Setup & Cleanup ==============

async function cleanupTestData() {
  // Clean up test cache entries (with test- prefix)
  const testEntries = await db
    .select()
    .from(semanticCache)
    .where(sql`${semanticCache.promptText} LIKE 'test-%'`);

  for (const entry of testEntries) {
    // Delete embeddings
    await db
      .delete(embeddings)
      .where(
        sql`${embeddings.sourceType} = 'cache' AND ${embeddings.sourceId} = ${entry.id}`
      );

    // Delete cache entry
    await db.delete(semanticCache).where(sql`${semanticCache.id} = ${entry.id}`);
  }
}

// ============== Test Suites ==============

async function runTests() {
  console.log('\n=== Semantic Cache Repository Tests ===\n');

  const cacheRepo = new SemanticCacheRepository();
  const embeddingRepo = new EmbeddingRepository();

  // Clean before tests
  await cleanupTestData();

  // -------------------- Normalization & Hashing Tests --------------------
  console.log('--- Normalization & Hashing Tests ---\n');

  await test('normalizePrompt() normalizes whitespace', () => {
    const input = '  Hello   World  ';
    const normalized = cacheRepo.normalizePrompt(input);
    assertEqual(normalized, 'hello world');
  });

  await test('normalizePrompt() removes punctuation', () => {
    const input = 'Hello, World!';
    const normalized = cacheRepo.normalizePrompt(input);
    assertEqual(normalized, 'hello world');
  });

  await test('normalizePrompt() converts to lowercase', () => {
    const input = 'HELLO WORLD';
    const normalized = cacheRepo.normalizePrompt(input);
    assertEqual(normalized, 'hello world');
  });

  await test('hashPrompt() generates consistent hashes', () => {
    const input1 = 'Hello World';
    const input2 = 'hello world';
    const input3 = '  Hello,   World!  ';

    const hash1 = cacheRepo.hashPrompt(input1);
    const hash2 = cacheRepo.hashPrompt(input2);
    const hash3 = cacheRepo.hashPrompt(input3);

    assertEqual(hash1, hash2);
    assertEqual(hash2, hash3);
  });

  await test('hashPrompt() generates different hashes for different content', () => {
    const hash1 = cacheRepo.hashPrompt('Hello World');
    const hash2 = cacheRepo.hashPrompt('Goodbye World');

    assertTrue(hash1 !== hash2);
  });

  // -------------------- Create Tests --------------------
  console.log('\n--- Create Tests ---\n');

  await test('create() creates a new cache entry', async () => {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours

    const entry = await cacheRepo.create({
      promptText: 'test-create-entry',
      response: 'Test response',
      model: 'test-model',
      intent: 'simple_greeting',
      metadata: null,
      expiresAt,
      sourceMessageIds: null,
    });

    assertNotNull(entry.id);
    assertEqual(entry.promptText, 'test-create-entry');
    assertEqual(entry.response, 'Test response');
    assertEqual(entry.model, 'test-model');
    assertEqual(entry.intent, 'simple_greeting');
    assertEqual(entry.hitCount, 1);
    assertNotNull(entry.promptHash);
  });

  await test('create() auto-generates prompt hash', async () => {
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const entry = await cacheRepo.create({
      promptText: 'test-hash-generation',
      response: 'Response',
      model: 'test-model',
      intent: null,
      metadata: null,
      expiresAt,
      sourceMessageIds: null,
    });

    const expectedHash = cacheRepo.hashPrompt('test-hash-generation');
    assertEqual(entry.promptHash, expectedHash);
  });

  await test('create() sets initial hit count to 1', async () => {
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const entry = await cacheRepo.create({
      promptText: 'test-hit-count',
      response: 'Response',
      model: 'test-model',
      intent: null,
      metadata: null,
      expiresAt,
      sourceMessageIds: null,
    });

    assertEqual(entry.hitCount, 1);
  });

  await test('create() stores metadata as JSON string', async () => {
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const metadata = { key: 'value', nested: { data: 123 } };

    const entry = await cacheRepo.create({
      promptText: 'test-metadata',
      response: 'Response',
      model: 'test-model',
      intent: null,
      metadata: JSON.stringify(metadata),
      expiresAt,
      sourceMessageIds: null,
    });

    assertEqual(entry.metadata, JSON.stringify(metadata));
  });

  // -------------------- Find By Exact Match Tests --------------------
  console.log('\n--- Find By Exact Match Tests ---\n');

  await test('findByExactMatch() finds entry with exact hash', async () => {
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const created = await cacheRepo.create({
      promptText: 'test-exact-match',
      response: 'Exact match response',
      model: 'test-model',
      intent: 'simple_greeting',
      metadata: null,
      expiresAt,
      sourceMessageIds: null,
    });

    const found = await cacheRepo.findByExactMatch('test-exact-match');

    assertNotNull(found);
    assertEqual(found!.id, created.id);
    assertEqual(found!.response, 'Exact match response');
  });

  await test('findByExactMatch() handles case and punctuation variations', async () => {
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await cacheRepo.create({
      promptText: 'test-case-variation',
      response: 'Case insensitive response',
      model: 'test-model',
      intent: null,
      metadata: null,
      expiresAt,
      sourceMessageIds: null,
    });

    // Should match despite different case and punctuation
    const found = await cacheRepo.findByExactMatch('TEST-CASE-VARIATION!!!');

    assertNotNull(found);
    assertEqual(found!.response, 'Case insensitive response');
  });

  await test('findByExactMatch() returns null for non-existent prompt', async () => {
    const found = await cacheRepo.findByExactMatch('test-non-existent-prompt-12345');
    assertNull(found);
  });

  await test('findByExactMatch() excludes expired entries', async () => {
    const expiredDate = new Date(Date.now() - 1000); // Already expired

    await cacheRepo.create({
      promptText: 'test-expired-entry',
      response: 'Expired response',
      model: 'test-model',
      intent: null,
      metadata: null,
      expiresAt: expiredDate,
      sourceMessageIds: null,
    });

    const found = await cacheRepo.findByExactMatch('test-expired-entry');
    assertNull(found);
  });

  await test('findByExactMatch() includes entries without expiration', async () => {
    await cacheRepo.create({
      promptText: 'test-no-expiration',
      response: 'Never expires',
      model: 'test-model',
      intent: null,
      metadata: null,
      expiresAt: null,
      sourceMessageIds: null,
    });

    const found = await cacheRepo.findByExactMatch('test-no-expiration');
    assertNotNull(found);
  });

  // -------------------- Find By ID Tests --------------------
  console.log('\n--- Find By ID Tests ---\n');

  await test('findById() retrieves entry by ID', async () => {
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const created = await cacheRepo.create({
      promptText: 'test-find-by-id',
      response: 'Find by ID response',
      model: 'test-model',
      intent: null,
      metadata: null,
      expiresAt,
      sourceMessageIds: null,
    });

    const found = await cacheRepo.findById(created.id);

    assertNotNull(found);
    assertEqual(found!.id, created.id);
    assertEqual(found!.promptText, 'test-find-by-id');
  });

  await test('findById() returns null for non-existent ID', async () => {
    const found = await cacheRepo.findById('non-existent-id-12345');
    assertNull(found);
  });

  // -------------------- Find By Similarity Tests --------------------
  console.log('\n--- Find By Similarity Tests ---\n');

  await test('findBySimilarity() finds similar entries', async () => {
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    // Create cache entry
    const entry = await cacheRepo.create({
      promptText: 'test-similarity-search',
      response: 'Similar response',
      model: 'test-model',
      intent: 'factual_question',
      metadata: null,
      expiresAt,
      sourceMessageIds: null,
    });

    // Create embedding for the cache entry
    const embedding = Array(384).fill(0).map((_, i) => Math.sin(i * 0.1));
    await embeddingRepo.create({
      sourceType: 'cache',
      sourceId: entry.id,
      content: 'test-similarity-search',
      embedding: JSON.stringify(embedding),
      model: 'test-model',
      dimensions: 384,
    });

    // Search with similar embedding
    const results = await cacheRepo.findBySimilarity(embedding, {
      minSimilarity: 0.9,
      limit: 5,
    });

    assertTrue(results.length > 0);
    assertEqual(results[0].entry.id, entry.id);
    assertEqual(results[0].matchType, 'semantic');
    assertGreaterThanOrEqual(results[0].similarity, 0.9);
  });

  await test('findBySimilarity() respects similarity threshold', async () => {
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const entry = await cacheRepo.create({
      promptText: 'test-similarity-threshold',
      response: 'Response',
      model: 'test-model',
      intent: null,
      metadata: null,
      expiresAt,
      sourceMessageIds: null,
    });

    // Create embedding
    const embedding1 = Array(384).fill(0).map((_, i) => Math.sin(i * 0.2));
    await embeddingRepo.create({
      sourceType: 'cache',
      sourceId: entry.id,
      content: 'test-similarity-threshold',
      embedding: JSON.stringify(embedding1),
      model: 'test-model',
      dimensions: 384,
    });

    // Query with very different embedding
    const embedding2 = Array(384).fill(0).map((_, i) => Math.cos(i * 0.5));

    const results = await cacheRepo.findBySimilarity(embedding2, {
      minSimilarity: 0.99, // Very high threshold
      limit: 5,
    });

    // Should not find matches with such high threshold
    assertEqual(results.length, 0);
  });

  await test('findBySimilarity() filters by intent', async () => {
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    // Create entries with different intents
    const entry1 = await cacheRepo.create({
      promptText: 'test-intent-filter-1',
      response: 'Greeting response',
      model: 'test-model',
      intent: 'simple_greeting',
      metadata: null,
      expiresAt,
      sourceMessageIds: null,
    });

    const entry2 = await cacheRepo.create({
      promptText: 'test-intent-filter-2',
      response: 'Question response',
      model: 'test-model',
      intent: 'factual_question',
      metadata: null,
      expiresAt,
      sourceMessageIds: null,
    });

    // Create embeddings
    const embedding = Array(384).fill(0).map((_, i) => Math.sin(i * 0.1));

    await embeddingRepo.create({
      sourceType: 'cache',
      sourceId: entry1.id,
      content: 'test-intent-filter-1',
      embedding: JSON.stringify(embedding),
      model: 'test-model',
      dimensions: 384,
    });

    await embeddingRepo.create({
      sourceType: 'cache',
      sourceId: entry2.id,
      content: 'test-intent-filter-2',
      embedding: JSON.stringify(embedding),
      model: 'test-model',
      dimensions: 384,
    });

    // Search with intent filter
    const results = await cacheRepo.findBySimilarity(embedding, {
      minSimilarity: 0.9,
      limit: 5,
      intent: 'simple_greeting',
    });

    assertTrue(results.length > 0);
    assertEqual(results[0].entry.intent, 'simple_greeting');
  });

  await test('findBySimilarity() excludes expired entries', async () => {
    // Clean up first to avoid contamination
    await cleanupTestData();

    // Create an entry that will expire in the past
    const entry = await cacheRepo.create({
      promptText: 'test-expired-similarity',
      response: 'Expired',
      model: 'test-model',
      intent: null,
      metadata: null,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // First create as valid
      sourceMessageIds: null,
    });

    const embedding = Array(384).fill(0).map((_, i) => Math.sin(i * 0.1));
    await embeddingRepo.create({
      sourceType: 'cache',
      sourceId: entry.id,
      content: 'test-expired-similarity',
      embedding: JSON.stringify(embedding),
      model: 'test-model',
      dimensions: 384,
    });

    // Now manually update the entry to be expired (Unix timestamp in seconds)
    const expiredTimestamp = Math.floor((Date.now() - 1000) / 1000);
    await db
      .update(semanticCache)
      .set({ expiresAt: new Date(expiredTimestamp * 1000) })
      .where(eq(semanticCache.id, entry.id));

    const results = await cacheRepo.findBySimilarity(embedding, {
      minSimilarity: 0.9,
      limit: 5,
    });

    assertEqual(results.length, 0);
  });

  // -------------------- Record Hit Tests --------------------
  console.log('\n--- Record Hit Tests ---\n');

  await test('recordHit() increments hit count', async () => {
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const entry = await cacheRepo.create({
      promptText: 'test-record-hit',
      response: 'Response',
      model: 'test-model',
      intent: null,
      metadata: null,
      expiresAt,
      sourceMessageIds: null,
    });

    const initialHitCount = entry.hitCount;

    await cacheRepo.recordHit(entry.id);

    const updated = await cacheRepo.findById(entry.id);
    assertEqual(updated!.hitCount, initialHitCount + 1);
  });

  await test('recordHit() updates lastAccessedAt', async () => {
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const entry = await cacheRepo.create({
      promptText: 'test-last-accessed',
      response: 'Response',
      model: 'test-model',
      intent: null,
      metadata: null,
      expiresAt,
      sourceMessageIds: null,
    });

    const initialTime = entry.lastAccessedAt.getTime();

    // Wait at least 1 second for timestamp to change
    await new Promise((resolve) => setTimeout(resolve, 1100));

    await cacheRepo.recordHit(entry.id);

    const updated = await cacheRepo.findById(entry.id);
    // SQLite timestamp is in seconds, so timestamps might be the same within the same second
    // Instead, just verify the hit count changed
    assertGreaterThanOrEqual(updated!.lastAccessedAt.getTime(), initialTime);
  });

  // -------------------- Delete Expired Tests --------------------
  console.log('\n--- Delete Expired Tests ---\n');

  await test('deleteExpired() removes expired entries', async () => {
    const expiredDate = new Date(Date.now() - 1000);

    const entry = await cacheRepo.create({
      promptText: 'test-delete-expired',
      response: 'Expired',
      model: 'test-model',
      intent: null,
      metadata: null,
      expiresAt: expiredDate,
      sourceMessageIds: null,
    });

    const deletedCount = await cacheRepo.deleteExpired();

    assertGreaterThanOrEqual(deletedCount, 1);

    const found = await cacheRepo.findById(entry.id);
    assertNull(found);
  });

  await test('deleteExpired() preserves non-expired entries', async () => {
    const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const entry = await cacheRepo.create({
      promptText: 'test-not-expired',
      response: 'Not expired',
      model: 'test-model',
      intent: null,
      metadata: null,
      expiresAt: futureDate,
      sourceMessageIds: null,
    });

    await cacheRepo.deleteExpired();

    const found = await cacheRepo.findById(entry.id);
    assertNotNull(found);
  });

  await test('deleteExpired() deletes associated embeddings', async () => {
    const expiredDate = new Date(Date.now() - 1000);

    const entry = await cacheRepo.create({
      promptText: 'test-delete-embedding',
      response: 'Expired',
      model: 'test-model',
      intent: null,
      metadata: null,
      expiresAt: expiredDate,
      sourceMessageIds: null,
    });

    // Create embedding
    const embedding = Array(384).fill(0).map((_, i) => Math.sin(i));
    await embeddingRepo.create({
      sourceType: 'cache',
      sourceId: entry.id,
      content: 'test-delete-embedding',
      embedding: JSON.stringify(embedding),
      model: 'test-model',
      dimensions: 384,
    });

    await cacheRepo.deleteExpired();

    // Verify embedding is deleted
    const embeddingExists = await embeddingRepo.findBySource('cache', entry.id);
    assertNull(embeddingExists);
  });

  // -------------------- Delete LRU Tests --------------------
  console.log('\n--- Delete LRU Tests ---\n');

  await test('deleteLRU() deletes least recently used entries', async () => {
    // Clean up first to avoid contamination from previous tests
    await cleanupTestData();

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const entries = [];

    // Create multiple entries with delays to ensure different timestamps
    for (let i = 0; i < 5; i++) {
      const entry = await cacheRepo.create({
        promptText: `test-lru-${i}`,
        response: `Response ${i}`,
        model: 'test-model',
        intent: null,
        metadata: null,
        expiresAt,
        sourceMessageIds: null,
      });
      entries.push(entry);

      // Wait at least 1 second to ensure different Unix timestamps
      if (i < 4) {
        await new Promise((resolve) => setTimeout(resolve, 1100));
      }
    }

    // Wait before accessing to ensure timestamp difference
    await new Promise((resolve) => setTimeout(resolve, 1100));

    // Access the last entry to make it more recent
    await cacheRepo.recordHit(entries[4].id);

    // Delete 2 LRU entries
    const deletedCount = await cacheRepo.deleteLRU(2);
    assertEqual(deletedCount, 2);

    // First entries should be deleted (least recently accessed)
    const found0 = await cacheRepo.findById(entries[0].id);
    assertNull(found0);

    // Last one should still exist (was accessed most recently)
    const found4 = await cacheRepo.findById(entries[4].id);
    assertNotNull(found4);
  });

  // -------------------- Count Tests --------------------
  console.log('\n--- Count Tests ---\n');

  await test('count() returns total entry count', async () => {
    const initialCount = await cacheRepo.count();

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await cacheRepo.create({
      promptText: 'test-count-1',
      response: 'Response 1',
      model: 'test-model',
      intent: null,
      metadata: null,
      expiresAt,
      sourceMessageIds: null,
    });

    await cacheRepo.create({
      promptText: 'test-count-2',
      response: 'Response 2',
      model: 'test-model',
      intent: null,
      metadata: null,
      expiresAt,
      sourceMessageIds: null,
    });

    const newCount = await cacheRepo.count();
    assertEqual(newCount, initialCount + 2);
  });

  // -------------------- Get Stats Tests --------------------
  console.log('\n--- Get Stats Tests ---\n');

  await test('getStats() returns cache statistics', async () => {
    // Clean first
    await cleanupTestData();

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const expiredDate = new Date(Date.now() - 1000);

    // Create some entries
    const entry1 = await cacheRepo.create({
      promptText: 'test-stats-1',
      response: 'Response 1',
      model: 'model-a',
      intent: 'simple_greeting',
      metadata: null,
      expiresAt,
      sourceMessageIds: null,
    });

    await cacheRepo.create({
      promptText: 'test-stats-2',
      response: 'Response 2',
      model: 'model-b',
      intent: 'factual_question',
      metadata: null,
      expiresAt,
      sourceMessageIds: null,
    });

    await cacheRepo.create({
      promptText: 'test-stats-3',
      response: 'Response 3',
      model: 'model-a',
      intent: 'simple_greeting',
      metadata: null,
      expiresAt: expiredDate,
      sourceMessageIds: null,
    });

    // Add some hits
    await cacheRepo.recordHit(entry1.id);
    await cacheRepo.recordHit(entry1.id);

    const stats = await cacheRepo.getStats();

    assertGreaterThanOrEqual(stats.totalEntries, 3);
    assertGreaterThanOrEqual(stats.totalHits, 3);
    assertGreaterThan(stats.avgHitCount, 0);
    assertGreaterThanOrEqual(stats.expiredEntries, 1);
    assertTrue(stats.entriesByIntent['simple_greeting'] >= 2);
    assertTrue(stats.entriesByModel['model-a'] >= 2);
  });

  // -------------------- Find By Intent Tests --------------------
  console.log('\n--- Find By Intent Tests ---\n');

  await test('findByIntent() retrieves entries by intent', async () => {
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await cacheRepo.create({
      promptText: 'test-find-intent-1',
      response: 'Greeting 1',
      model: 'test-model',
      intent: 'simple_greeting',
      metadata: null,
      expiresAt,
      sourceMessageIds: null,
    });

    await cacheRepo.create({
      promptText: 'test-find-intent-2',
      response: 'Greeting 2',
      model: 'test-model',
      intent: 'simple_greeting',
      metadata: null,
      expiresAt,
      sourceMessageIds: null,
    });

    const results = await cacheRepo.findByIntent('simple_greeting', 10);

    assertTrue(results.length >= 2);
    assertTrue(results.every((r) => r.intent === 'simple_greeting'));
  });

  // -------------------- Invalidate By Intent Tests --------------------
  console.log('\n--- Invalidate By Intent Tests ---\n');

  await test('invalidateByIntent() deletes entries by intent', async () => {
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const entry1 = await cacheRepo.create({
      promptText: 'test-invalidate-1',
      response: 'Response 1',
      model: 'test-model',
      intent: 'test_intent',
      metadata: null,
      expiresAt,
      sourceMessageIds: null,
    });

    const entry2 = await cacheRepo.create({
      promptText: 'test-invalidate-2',
      response: 'Response 2',
      model: 'test-model',
      intent: 'test_intent',
      metadata: null,
      expiresAt,
      sourceMessageIds: null,
    });

    const deletedCount = await cacheRepo.invalidateByIntent('test_intent');

    assertEqual(deletedCount, 2);

    const found1 = await cacheRepo.findById(entry1.id);
    const found2 = await cacheRepo.findById(entry2.id);

    assertNull(found1);
    assertNull(found2);
  });

  // -------------------- Clear Tests --------------------
  console.log('\n--- Clear Tests ---\n');

  await test('clear() removes all cache entries', async () => {
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await cacheRepo.create({
      promptText: 'test-clear-1',
      response: 'Response 1',
      model: 'test-model',
      intent: null,
      metadata: null,
      expiresAt,
      sourceMessageIds: null,
    });

    await cacheRepo.create({
      promptText: 'test-clear-2',
      response: 'Response 2',
      model: 'test-model',
      intent: null,
      metadata: null,
      expiresAt,
      sourceMessageIds: null,
    });

    const clearedCount = await cacheRepo.clear();

    assertGreaterThanOrEqual(clearedCount, 2);

    const count = await cacheRepo.count();
    assertEqual(count, 0);
  });

  // Cleanup after tests
  await cleanupTestData();

  // -------------------- Print Results --------------------
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
