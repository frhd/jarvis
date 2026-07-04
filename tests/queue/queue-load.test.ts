#!/usr/bin/env npx tsx
/**
 * Queue System Load Tests
 *
 * Comprehensive load and performance tests for the queue infrastructure.
 * Tests high volume enqueue/dequeue operations, concurrent processing,
 * priority handling under load, and system behavior at scale.
 *
 * Run: npx tsx tests/queue/queue-load.test.ts
 */

import { QueueRepository } from '../../src/repositories/queue.repository.js';
import { DeadLetterQueueRepository } from '../../src/repositories/deadLetterQueue.repository.js';
import { CircuitBreakerRepository } from '../../src/repositories/circuitBreaker.repository.js';
import { RetryStrategyService } from '../../src/services/retryStrategy.service.js';
import { CircuitBreakerService } from '../../src/services/circuitBreaker.service.js';
import { DeadLetterQueueService } from '../../src/services/deadLetterQueue.service.js';
import { PriorityEscalationService } from '../../src/services/priorityEscalation.service.js';
import { MessageRepository } from '../../src/repositories/message.repository.js';
import { PriorityLevel, DLQReason, DEFAULT_PRIORITY_CONFIG } from '../../src/types/queue.types.js';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { queue, messages, chats, senders, deadLetterQueue, circuitBreakerStates } from '../../src/db/schema.js';
import { sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';

// ============================================================================
// Performance Thresholds (in milliseconds)
// ============================================================================

const THRESHOLDS = {
  // Enqueue operations
  ENQUEUE_100_ITEMS: 200,           // < 200ms to enqueue 100 items
  ENQUEUE_1000_ITEMS: 1500,         // < 1.5s to enqueue 1000 items
  ENQUEUE_5000_ITEMS: 7000,         // < 7s to enqueue 5000 items

  // Dequeue operations
  DEQUEUE_100_ITEMS: 300,           // < 300ms to dequeue 100 items
  DEQUEUE_1000_ITEMS: 2500,         // < 2.5s to dequeue 1000 items

  // Priority operations
  PRIORITY_UPDATE_100: 200,         // < 200ms to update 100 priorities
  PRIORITY_ESCALATION_500: 1000,    // < 1s to escalate 500 stale items

  // Stats and queries
  STATS_WITH_10000_ITEMS: 500,      // < 500ms to get stats with 10000 items
  GET_STALE_ITEMS_10000: 500,       // < 500ms to get stale items from 10000
  GET_READY_FOR_RETRY_10000: 500,   // < 500ms to get retry-ready items from 10000

  // Concurrent operations
  CONCURRENT_ENQUEUE_50: 500,       // < 500ms for 50 concurrent enqueues
  CONCURRENT_DEQUEUE_50: 500,       // < 500ms for 50 concurrent dequeues

  // Retry and DLQ
  DLQ_ADD_100: 300,                 // < 300ms to add 100 DLQ items
  DLQ_STATS_WITH_1000: 200,         // < 200ms to get DLQ stats with 1000 items
  RETRY_DELAY_CALC_10000: 200,      // < 200ms to calculate 10000 retry delays

  // Circuit breaker
  CB_STATE_CHANGES_100: 300,        // < 300ms for 100 state changes

  // Memory
  MEMORY_GROWTH_THRESHOLD_MB: 100,  // Memory should not grow more than 100MB
};

// ============================================================================
// Test Utilities
// ============================================================================

interface TestContext {
  db: ReturnType<typeof drizzle>;
  sqlite: Database.Database;
  queueRepo: QueueRepository;
  dlqRepo: DeadLetterQueueRepository;
  cbRepo: CircuitBreakerRepository;
  messageRepo: MessageRepository;
}

interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  details?: Record<string, unknown>;
  error?: string;
}

const testResults: TestResult[] = [];

async function measureTime<T>(fn: () => Promise<T>): Promise<{ result: T; duration: number }> {
  const start = Date.now();
  const result = await fn();
  const duration = Date.now() - start;
  return { result, duration };
}

function measureTimeSync<T>(fn: () => T): { result: T; duration: number } {
  const start = Date.now();
  const result = fn();
  const duration = Date.now() - start;
  return { result, duration };
}

function getMemoryUsageMB(): number {
  const usage = process.memoryUsage();
  return usage.heapUsed / 1024 / 1024;
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function logTest(name: string, passed: boolean, duration: number, details?: Record<string, unknown>, error?: string): void {
  const status = passed ? '✓' : '✗';
  console.log(`  ${status} ${name} (${duration}ms)`);
  if (details) {
    console.log(`    Details: ${JSON.stringify(details)}`);
  }
  if (error) {
    console.log(`    Error: ${error}`);
  }
  testResults.push({ name, passed, duration, details, error });
}

// ============================================================================
// Test Context Setup
// ============================================================================

function createTestContext(): TestContext {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite);

  // Create tables
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS senders (
      id TEXT PRIMARY KEY,
      telegramId TEXT NOT NULL UNIQUE,
      firstName TEXT,
      lastName TEXT,
      username TEXT,
      phone TEXT,
      createdAt INTEGER NOT NULL DEFAULT (unixepoch()),
      updatedAt INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY,
      telegramId TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL,
      title TEXT,
      username TEXT,
      createdAt INTEGER NOT NULL DEFAULT (unixepoch()),
      updatedAt INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      telegramMessageId INTEGER NOT NULL,
      chatId TEXT NOT NULL,
      senderId TEXT,
      text TEXT,
      mediaType TEXT,
      mediaPath TEXT,
      mediaFileId TEXT,
      replyToMessageId INTEGER,
      forwardFromChatId TEXT,
      forwardFromMessageId INTEGER,
      rawJson TEXT NOT NULL,
      isBot INTEGER NOT NULL DEFAULT 0,
      createdAt INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS queue (
      id TEXT PRIMARY KEY,
      messageId TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending',
      priority INTEGER NOT NULL DEFAULT 0,
      attempts INTEGER NOT NULL DEFAULT 0,
      lastError TEXT,
      processedAt INTEGER,
      nextRetryAt INTEGER,
      priorityBoostApplied INTEGER NOT NULL DEFAULT 0,
      originalPriority INTEGER,
      createdAt INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS queue_status_priority_createdAt_idx
      ON queue(status, priority, createdAt);
    CREATE INDEX IF NOT EXISTS queue_nextRetryAt_idx ON queue(nextRetryAt);

    CREATE TABLE IF NOT EXISTS deadLetterQueue (
      id TEXT PRIMARY KEY,
      originalQueueId TEXT NOT NULL,
      messageId TEXT NOT NULL,
      reason TEXT NOT NULL,
      errorHistory TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      metadata TEXT,
      createdAt INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS circuitBreakerStates (
      id TEXT PRIMARY KEY,
      serviceName TEXT NOT NULL UNIQUE,
      state TEXT NOT NULL DEFAULT 'CLOSED',
      failureCount INTEGER NOT NULL DEFAULT 0,
      successCount INTEGER NOT NULL DEFAULT 0,
      lastFailureAt INTEGER,
      lastSuccessAt INTEGER,
      lastStateChangeAt INTEGER NOT NULL DEFAULT (unixepoch()),
      nextAttemptAt INTEGER,
      halfOpenAttempts INTEGER NOT NULL DEFAULT 0,
      createdAt INTEGER NOT NULL DEFAULT (unixepoch()),
      updatedAt INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);

  return {
    db,
    sqlite,
    queueRepo: new QueueRepository(),
    dlqRepo: new DeadLetterQueueRepository(),
    cbRepo: new CircuitBreakerRepository(),
    messageRepo: new MessageRepository(),
  };
}

function cleanupContext(ctx: TestContext): void {
  ctx.sqlite.close();
}

// Helper to create test messages in the real DB for queue tests
async function createTestMessages(count: number): Promise<string[]> {
  const messageIds: string[] = [];
  const chatId = `test-chat-${nanoid()}`;
  const senderId = `test-sender-${nanoid()}`;

  // Create sender and chat first (needed for foreign keys)
  const { db } = await import('../../src/db/client.js');

  await db.insert(senders).values({
    id: senderId,
    telegramId: `tg-${senderId}`,
    firstName: 'Test',
    lastName: 'User',
    createdAt: new Date(),
    updatedAt: new Date(),
  }).onConflictDoNothing();

  await db.insert(chats).values({
    id: chatId,
    telegramId: `tg-${chatId}`,
    type: 'private',
    title: 'Test Chat',
    createdAt: new Date(),
    updatedAt: new Date(),
  }).onConflictDoNothing();

  // Create messages in batches
  const batchSize = 100;
  for (let i = 0; i < count; i += batchSize) {
    const batch = [];
    const batchEnd = Math.min(i + batchSize, count);

    for (let j = i; j < batchEnd; j++) {
      const msgId = `test-msg-${nanoid()}`;
      messageIds.push(msgId);
      batch.push({
        id: msgId,
        telegramMessageId: j,
        chatId,
        senderId,
        text: `Test message ${j}`,
        rawJson: JSON.stringify({ test: true }),
        isBot: false,
        createdAt: new Date(),
      });
    }

    await db.insert(messages).values(batch).onConflictDoNothing();
  }

  return messageIds;
}

// Cleanup test data
async function cleanupTestData(): Promise<void> {
  const { db, connection } = await import('../../src/db/client.js');

  // Temporarily disable foreign keys for cleanup
  connection.exec('PRAGMA foreign_keys = OFF');

  try {
    // Delete in reverse order of dependencies
    await db.delete(queue).where(sql`id LIKE 'test-%' OR messageId LIKE 'test-%'`);
    await db.delete(deadLetterQueue).where(sql`id LIKE 'test-%' OR messageId LIKE 'test-%'`);
    await db.delete(circuitBreakerStates).where(sql`serviceName LIKE 'test-%'`);
    await db.delete(messages).where(sql`id LIKE 'test-%'`);
    await db.delete(chats).where(sql`id LIKE 'test-%'`);
    await db.delete(senders).where(sql`id LIKE 'test-%'`);
  } finally {
    // Re-enable foreign keys
    connection.exec('PRAGMA foreign_keys = ON');
  }
}

// ============================================================================
// Test Suites
// ============================================================================

async function testEnqueuePerformance(): Promise<void> {
  console.log('\n📦 Testing Enqueue Performance...');

  const queueRepo = new QueueRepository();

  // Test 100 items
  {
    const messageIds = await createTestMessages(100);
    const { duration } = await measureTime(async () => {
      for (const msgId of messageIds) {
        await queueRepo.enqueue(msgId, PriorityLevel.NORMAL);
      }
    });

    const passed = duration < THRESHOLDS.ENQUEUE_100_ITEMS;
    logTest('Enqueue 100 items', passed, duration, {
      itemCount: 100,
      threshold: THRESHOLDS.ENQUEUE_100_ITEMS,
      avgPerItem: (duration / 100).toFixed(2),
    });
  }

  // Test 1000 items
  {
    const messageIds = await createTestMessages(1000);
    const { duration } = await measureTime(async () => {
      for (const msgId of messageIds) {
        await queueRepo.enqueue(msgId, PriorityLevel.NORMAL);
      }
    });

    const passed = duration < THRESHOLDS.ENQUEUE_1000_ITEMS;
    logTest('Enqueue 1000 items', passed, duration, {
      itemCount: 1000,
      threshold: THRESHOLDS.ENQUEUE_1000_ITEMS,
      avgPerItem: (duration / 1000).toFixed(2),
    });
  }
}

async function testDequeuePerformance(): Promise<void> {
  console.log('\n📤 Testing Dequeue Performance...');

  const queueRepo = new QueueRepository();

  // First, enqueue items
  const messageIds = await createTestMessages(1000);
  for (const msgId of messageIds) {
    await queueRepo.enqueue(msgId, Math.floor(Math.random() * 5)); // Random priority 0-4
  }

  // Test dequeue
  {
    const { duration } = await measureTime(async () => {
      for (let i = 0; i < 100; i++) {
        const item = await queueRepo.dequeue();
        if (item) {
          await queueRepo.markProcessing(item.id);
          await queueRepo.markCompleted(item.id);
        }
      }
    });

    const passed = duration < THRESHOLDS.DEQUEUE_100_ITEMS;
    logTest('Dequeue and complete 100 items', passed, duration, {
      itemCount: 100,
      threshold: THRESHOLDS.DEQUEUE_100_ITEMS,
      avgPerItem: (duration / 100).toFixed(2),
    });
  }

  // Test dequeue 1000
  {
    const { duration } = await measureTime(async () => {
      for (let i = 0; i < 900; i++) { // 900 remaining
        const item = await queueRepo.dequeue();
        if (item) {
          await queueRepo.markProcessing(item.id);
          await queueRepo.markCompleted(item.id);
        }
      }
    });

    const passed = duration < THRESHOLDS.DEQUEUE_1000_ITEMS;
    logTest('Dequeue and complete 900 items', passed, duration, {
      itemCount: 900,
      threshold: THRESHOLDS.DEQUEUE_1000_ITEMS,
      avgPerItem: (duration / 900).toFixed(2),
    });
  }
}

async function testPriorityOperations(): Promise<void> {
  console.log('\n⬆️ Testing Priority Operations...');

  const queueRepo = new QueueRepository();

  // Enqueue items with low priority
  const messageIds = await createTestMessages(500);
  const queueItems: string[] = [];

  for (const msgId of messageIds) {
    const item = await queueRepo.enqueue(msgId, PriorityLevel.LOW);
    queueItems.push(item.id);
  }

  // Test priority updates
  {
    const { duration } = await measureTime(async () => {
      for (let i = 0; i < 100; i++) {
        await queueRepo.updatePriority(
          queueItems[i],
          PriorityLevel.HIGH,
          2,
          PriorityLevel.LOW
        );
      }
    });

    const passed = duration < THRESHOLDS.PRIORITY_UPDATE_100;
    logTest('Update 100 priorities', passed, duration, {
      itemCount: 100,
      threshold: THRESHOLDS.PRIORITY_UPDATE_100,
    });
  }

  // Test getting stale items
  {
    // Make items appear stale by waiting (or we can test the query itself)
    const { duration } = await measureTime(async () => {
      await queueRepo.getStaleItems(1); // 1ms - everything is stale
    });

    const passed = duration < THRESHOLDS.GET_STALE_ITEMS_10000;
    logTest('Get stale items from 500', passed, duration, {
      threshold: THRESHOLDS.GET_STALE_ITEMS_10000,
    });
  }
}

async function testConcurrentOperations(): Promise<void> {
  console.log('\n🔄 Testing Concurrent Operations...');

  const queueRepo = new QueueRepository();

  // Concurrent enqueues
  {
    const messageIds = await createTestMessages(50);
    const { duration } = await measureTime(async () => {
      await Promise.all(
        messageIds.map(msgId =>
          queueRepo.enqueue(msgId, Math.floor(Math.random() * 5))
        )
      );
    });

    const passed = duration < THRESHOLDS.CONCURRENT_ENQUEUE_50;
    logTest('50 concurrent enqueues', passed, duration, {
      threshold: THRESHOLDS.CONCURRENT_ENQUEUE_50,
    });
  }

  // Concurrent dequeues (with marking)
  {
    // Get all pending items first
    const items: string[] = [];
    for (let i = 0; i < 50; i++) {
      const item = await queueRepo.dequeue();
      if (item) {
        await queueRepo.markProcessing(item.id);
        items.push(item.id);
      }
    }

    const { duration } = await measureTime(async () => {
      await Promise.all(
        items.map(id => queueRepo.markCompleted(id))
      );
    });

    const passed = duration < THRESHOLDS.CONCURRENT_DEQUEUE_50;
    logTest('50 concurrent completions', passed, duration, {
      completedCount: items.length,
      threshold: THRESHOLDS.CONCURRENT_DEQUEUE_50,
    });
  }
}

async function testStatsPerformance(): Promise<void> {
  console.log('\n📊 Testing Stats Performance...');

  const queueRepo = new QueueRepository();

  // First, ensure we have many items
  const messageIds = await createTestMessages(2000);
  for (const msgId of messageIds) {
    await queueRepo.enqueue(msgId, Math.floor(Math.random() * 5));
  }

  // Test stats query
  {
    const { result, duration } = await measureTime(async () => {
      return await queueRepo.getStats();
    });

    const passed = duration < THRESHOLDS.STATS_WITH_10000_ITEMS;
    logTest('Get queue stats', passed, duration, {
      stats: result,
      threshold: THRESHOLDS.STATS_WITH_10000_ITEMS,
    });
  }

  // Test ready for retry query
  {
    // Schedule some items for retry
    const items = await queueRepo.getStaleItems(1);
    for (let i = 0; i < Math.min(100, items.length); i++) {
      await queueRepo.scheduleRetry(
        items[i].id,
        new Date(Date.now() - 1000), // In the past
        'Test error'
      );
    }

    const { result, duration } = await measureTime(async () => {
      return await queueRepo.getReadyForRetry();
    });

    const passed = duration < THRESHOLDS.GET_READY_FOR_RETRY_10000;
    logTest('Get ready for retry items', passed, duration, {
      itemCount: result.length,
      threshold: THRESHOLDS.GET_READY_FOR_RETRY_10000,
    });
  }
}

async function testRetryStrategyPerformance(): Promise<void> {
  console.log('\n🔁 Testing Retry Strategy Performance...');

  const retryService = new RetryStrategyService({
    maxAttempts: 5,
    baseDelayMs: 1000,
    maxDelayMs: 60000,
    backoffMultiplier: 2,
    jitterFactor: 0.1,
  });

  // Test delay calculation performance
  {
    const { duration } = measureTimeSync(() => {
      for (let i = 0; i < 10000; i++) {
        retryService.calculateNextRetryDelay(i % 5 + 1);
      }
    });

    const passed = duration < THRESHOLDS.RETRY_DELAY_CALC_10000;
    logTest('Calculate 10000 retry delays', passed, duration, {
      threshold: THRESHOLDS.RETRY_DELAY_CALC_10000,
      avgPerCalc: (duration / 10000).toFixed(4),
    });
  }

  // Test shouldRetry decisions
  {
    const errors = [
      new Error('Timeout error'),
      new Error('Connection refused'),
      new Error('VALIDATION_ERROR: Invalid input'),
      new Error('Internal server error'),
      null,
    ];

    const { duration } = measureTimeSync(() => {
      for (let i = 0; i < 10000; i++) {
        const error = errors[i % errors.length];
        retryService.shouldRetry(i % 5 + 1, error || undefined);
      }
    });

    const passed = duration < 100; // Should be very fast
    logTest('10000 shouldRetry decisions', passed, duration, {
      avgPerDecision: (duration / 10000).toFixed(4),
    });
  }
}

async function testDLQPerformance(): Promise<void> {
  console.log('\n💀 Testing Dead Letter Queue Performance...');

  const dlqRepo = new DeadLetterQueueRepository();
  const queueRepo = new QueueRepository();
  const dlqService = new DeadLetterQueueService(dlqRepo, queueRepo);

  // Add items to DLQ
  {
    const { duration } = await measureTime(async () => {
      for (let i = 0; i < 100; i++) {
        await dlqRepo.add({
          originalQueueId: `test-queue-${nanoid()}`,
          messageId: `test-msg-${nanoid()}`,
          reason: Object.values(DLQReason)[i % 5],
          errorHistory: [
            { timestamp: new Date(), error: `Error ${i}`, attempt: 1 },
            { timestamp: new Date(), error: `Error ${i} retry`, attempt: 2 },
          ],
          attempts: 2,
          metadata: { testIndex: i },
        });
      }
    });

    const passed = duration < THRESHOLDS.DLQ_ADD_100;
    logTest('Add 100 items to DLQ', passed, duration, {
      threshold: THRESHOLDS.DLQ_ADD_100,
      avgPerItem: (duration / 100).toFixed(2),
    });
  }

  // Test DLQ stats
  {
    const { result, duration } = await measureTime(async () => {
      return await dlqService.getStats();
    });

    const passed = duration < THRESHOLDS.DLQ_STATS_WITH_1000;
    logTest('Get DLQ stats', passed, duration, {
      stats: result,
      threshold: THRESHOLDS.DLQ_STATS_WITH_1000,
    });
  }

  // Test getByReason
  {
    const { result, duration } = await measureTime(async () => {
      return await dlqRepo.getByReason(DLQReason.MAX_RETRIES_EXCEEDED);
    });

    const passed = duration < 200;
    logTest('Get DLQ items by reason', passed, duration, {
      itemCount: result.length,
    });
  }
}

async function testCircuitBreakerPerformance(): Promise<void> {
  console.log('\n⚡ Testing Circuit Breaker Performance...');

  const cbRepo = new CircuitBreakerRepository();
  const cb = new CircuitBreakerService('test-load-service', {
    failureThreshold: 10,
    resetTimeoutMs: 100,
    halfOpenRequests: 3,
  }, cbRepo);

  await cb.initialize();

  // Test state changes
  {
    const { duration } = await measureTime(async () => {
      for (let i = 0; i < 100; i++) {
        if (i % 2 === 0) {
          await cb.recordSuccess();
        } else {
          await cb.recordFailure(new Error('Test failure'));
        }

        // Periodically reset to keep testing
        if (i % 20 === 19) {
          await cb.reset();
        }
      }
    });

    const passed = duration < THRESHOLDS.CB_STATE_CHANGES_100;
    logTest('100 circuit breaker state changes', passed, duration, {
      threshold: THRESHOLDS.CB_STATE_CHANGES_100,
      finalState: cb.getState(),
    });
  }

  // Cleanup
  await cbRepo.delete('test-load-service');
}

async function testMemoryUsage(): Promise<void> {
  console.log('\n🧠 Testing Memory Usage...');

  const queueRepo = new QueueRepository();
  const initialMemory = getMemoryUsageMB();

  // Create and process many items
  const messageIds = await createTestMessages(1000);

  for (const msgId of messageIds) {
    await queueRepo.enqueue(msgId, Math.floor(Math.random() * 5));
  }

  // Process all items
  for (let i = 0; i < 1000; i++) {
    const item = await queueRepo.dequeue();
    if (item) {
      await queueRepo.markProcessing(item.id);
      await queueRepo.markCompleted(item.id);
    }
  }

  // Force garbage collection if available
  if (global.gc) {
    global.gc();
  }

  const finalMemory = getMemoryUsageMB();
  const memoryGrowth = finalMemory - initialMemory;

  const passed = memoryGrowth < THRESHOLDS.MEMORY_GROWTH_THRESHOLD_MB;
  logTest('Memory usage during load', passed, 0, {
    initialMemoryMB: initialMemory.toFixed(2),
    finalMemoryMB: finalMemory.toFixed(2),
    growthMB: memoryGrowth.toFixed(2),
    threshold: THRESHOLDS.MEMORY_GROWTH_THRESHOLD_MB,
  });
}

async function testHighVolumeScenario(): Promise<void> {
  console.log('\n🚀 Testing High Volume Scenario...');

  const queueRepo = new QueueRepository();
  const startTime = Date.now();

  // Simulate high volume: enqueue 500, process 300, enqueue 200 more, process rest
  const batch1 = await createTestMessages(500);

  // Enqueue batch 1
  for (const msgId of batch1) {
    await queueRepo.enqueue(msgId, Math.floor(Math.random() * 5));
  }

  // Process 300
  for (let i = 0; i < 300; i++) {
    const item = await queueRepo.dequeue();
    if (item) {
      await queueRepo.markProcessing(item.id);
      // Simulate some processing time
      await queueRepo.markCompleted(item.id);
    }
  }

  // Enqueue batch 2 while processing continues
  const batch2 = await createTestMessages(200);
  for (const msgId of batch2) {
    await queueRepo.enqueue(msgId, Math.floor(Math.random() * 5));
  }

  // Process remaining
  let processed = 0;
  let item = await queueRepo.dequeue();
  while (item) {
    await queueRepo.markProcessing(item.id);
    await queueRepo.markCompleted(item.id);
    processed++;
    item = await queueRepo.dequeue();
  }

  const duration = Date.now() - startTime;
  const stats = await queueRepo.getStats();

  const passed = stats.pending === 0 && duration < 30000; // Complete in 30s
  logTest('High volume scenario', passed, duration, {
    totalEnqueued: 700,
    totalProcessed: 300 + processed,
    finalStats: stats,
  });
}

// ============================================================================
// Main Test Runner
// ============================================================================

async function runAllTests(): Promise<void> {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('                Queue System Load Tests                         ');
  console.log('═══════════════════════════════════════════════════════════════');

  const startTime = Date.now();
  const initialMemory = getMemoryUsageMB();

  try {
    // Cleanup before tests
    await cleanupTestData();

    await testEnqueuePerformance();
    await cleanupTestData();

    await testDequeuePerformance();
    await cleanupTestData();

    await testPriorityOperations();
    await cleanupTestData();

    await testConcurrentOperations();
    await cleanupTestData();

    await testStatsPerformance();
    await cleanupTestData();

    await testRetryStrategyPerformance();

    await testDLQPerformance();
    await cleanupTestData();

    await testCircuitBreakerPerformance();

    await testMemoryUsage();
    await cleanupTestData();

    await testHighVolumeScenario();
    await cleanupTestData();

  } catch (error) {
    console.error('\n❌ Test suite error:', error);
  }

  // Final cleanup
  await cleanupTestData();

  const totalDuration = Date.now() - startTime;
  const finalMemory = getMemoryUsageMB();

  // Summary
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('                        Test Summary                            ');
  console.log('═══════════════════════════════════════════════════════════════');

  const passed = testResults.filter(r => r.passed).length;
  const failed = testResults.filter(r => !r.passed).length;
  const total = testResults.length;

  console.log(`\n  Total tests: ${total}`);
  console.log(`  ✓ Passed: ${passed}`);
  console.log(`  ✗ Failed: ${failed}`);
  console.log(`  Duration: ${totalDuration}ms`);
  console.log(`  Memory: ${initialMemory.toFixed(2)}MB → ${finalMemory.toFixed(2)}MB`);

  if (failed > 0) {
    console.log('\n  Failed tests:');
    testResults.filter(r => !r.passed).forEach(r => {
      console.log(`    - ${r.name}: ${r.error || 'threshold exceeded'}`);
    });
  }

  console.log('\n═══════════════════════════════════════════════════════════════\n');

  process.exit(failed > 0 ? 1 : 0);
}

// Run tests
runAllTests().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
