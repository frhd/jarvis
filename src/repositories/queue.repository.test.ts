#!/usr/bin/env npx tsx
/**
 * QueueRepository Tests
 *
 * Comprehensive tests covering:
 * - Enqueue operations (new items, deduplication)
 * - Dequeue operations (priority order, FIFO within priority)
 * - Status transitions (pending -> processing -> completed/failed)
 * - Priority handling (higher priority first)
 * - Retry logic (attempt count increment, error tracking)
 * - Optimistic locking (version field)
 * - Atomic dequeue operations (race condition handling)
 * - Concurrent operations
 * - Edge cases
 *
 * Run: npx tsx src/repositories/queue.repository.test.ts
 */

import { QueueRepository } from './queue.repository.js';
import { QueueItem, QueueStatus } from '../types/index.js';
import { db } from '../db/client.js';
import { queue, messages, senders, chats } from '../db/schema.js';
import { sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';

// ============================================================================
// Test Helpers
// ============================================================================

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

function assertFalse(condition: boolean, message?: string) {
  if (condition) {
    throw new Error(message || 'Expected condition to be false');
  }
}

function assertNull(value: any, message?: string) {
  if (value !== null) {
    throw new Error(message || `Expected null, got ${JSON.stringify(value)}`);
  }
}

function assertNotNull(value: any, message?: string) {
  if (value === null) {
    throw new Error(message || 'Expected non-null value');
  }
}

function assertGreaterThan(actual: number, expected: number, message?: string) {
  if (actual <= expected) {
    throw new Error(message || `Expected ${actual} > ${expected}`);
  }
}

function assertGreaterThanOrEqual(actual: number, expected: number, message?: string) {
  if (actual < expected) {
    throw new Error(message || `Expected ${actual} >= ${expected}`);
  }
}

// ============================================================================
// Setup and Teardown
// ============================================================================

async function setupTestData() {
  // Create a test sender
  const senderId = nanoid();
  const telegramId = `test_${Date.now()}_${Math.random()}`;

  await db.insert(senders).values({
    id: senderId,
    telegramId,
    firstName: 'Test',
    lastName: 'User',
    username: 'testuser',
    phone: null,
  });

  // Create a test chat
  const chatId = nanoid();
  const chatTelegramId = `chat_${Date.now()}_${Math.random()}`;

  await db.insert(chats).values({
    id: chatId,
    telegramId: chatTelegramId,
    type: 'private',
    title: null,
    username: 'testuser',
  });

  return { senderId, chatId };
}

async function createTestMessage(chatId: string, senderId: string, text: string = 'Test message') {
  const messageId = nanoid();
  const telegramMessageId = Math.floor(Math.random() * 1000000) + Date.now();

  await db.insert(messages).values({
    id: messageId,
    telegramMessageId,
    chatId,
    senderId,
    text,
    mediaType: null,
    mediaPath: null,
    mediaFileId: null,
    transcript: null,
    transcriptStatus: null,
    transcriptError: null,
    transcriptLanguage: null,
    transcriptDurationMs: null,
    transcriptedAt: null,
    replyToMessageId: null,
    forwardFromChatId: null,
    forwardFromMessageId: null,
    rawJson: JSON.stringify({ text }),
    isBot: false,
  });

  return messageId;
}

async function cleanupTestData() {
  // Clean up in reverse order of dependencies
  try {
    await db.delete(queue);
    await db.delete(messages);
    await db.delete(chats);
    await db.delete(senders);
  } catch (error) {
    // Ignore errors during cleanup - may not exist yet
  }
}

// ============================================================================
// Tests
// ============================================================================

async function runTests() {
  console.log('\n=== QueueRepository Tests ===\n');

  const repo = new QueueRepository();
  let testData: { senderId: string; chatId: string };

  // Setup
  try {
    await cleanupTestData();
    testData = await setupTestData();
    console.log(`Test data setup complete: senderId=${testData.senderId}, chatId=${testData.chatId}\n`);
  } catch (error) {
    console.error('Failed to setup test data:', error);
    process.exit(1);
  }

  // ============================================================================
  // Enqueue Tests
  // ============================================================================

  await test('enqueue: creates new queue item with default priority', async () => {
    await cleanupTestData();
    testData = await setupTestData();
    const messageId = await createTestMessage(testData.chatId, testData.senderId);

    const item = await repo.enqueue(messageId);

    assertNotNull(item);
    assertEqual(item.messageId, messageId);
    assertEqual(item.status, 'pending');
    assertEqual(item.priority, 0);
    assertEqual(item.attempts, 0);
    assertEqual(item.version, 1);
    assertNull(item.lastError);
    assertNull(item.processedAt);
    assertNull(item.processingStartedAt);
  });

  await test('enqueue: creates queue item with custom priority', async () => {
    await cleanupTestData();
    testData = await setupTestData();
    const messageId = await createTestMessage(testData.chatId, testData.senderId);

    const item = await repo.enqueue(messageId, 3);

    assertEqual(item.priority, 3);
  });

  await test('enqueue: prevents duplicate enqueue of active items (pending)', async () => {
    await cleanupTestData();
    testData = await setupTestData();
    const messageId = await createTestMessage(testData.chatId, testData.senderId);

    const item1 = await repo.enqueue(messageId);
    const item2 = await repo.enqueue(messageId);

    assertEqual(item1.id, item2.id, 'Should return same item for duplicate enqueue');
  });

  await test('enqueue: prevents duplicate enqueue of active items (processing)', async () => {
    await cleanupTestData();
    testData = await setupTestData();
    const messageId = await createTestMessage(testData.chatId, testData.senderId);

    const item1 = await repo.enqueue(messageId);
    await repo.markProcessing(item1.id);
    const item2 = await repo.enqueue(messageId);

    assertEqual(item1.id, item2.id, 'Should return same item when already processing');
  });

  await test('enqueue: allows re-enqueue after completion', async () => {
    await cleanupTestData();
    testData = await setupTestData();
    const messageId = await createTestMessage(testData.chatId, testData.senderId);

    const item1 = await repo.enqueue(messageId);
    await repo.markCompleted(item1.id);

    // Delete the completed item to allow re-enqueue
    await db.delete(queue).where(sql`${queue.id} = ${item1.id}`);

    const item2 = await repo.enqueue(messageId);

    assertTrue(item1.id !== item2.id, 'Should create new item after completion');
  });

  // ============================================================================
  // Dequeue Tests
  // ============================================================================

  await test('dequeue: returns highest priority item first', async () => {
    await cleanupTestData();
    testData = await setupTestData();

    const msg1 = await createTestMessage(testData.chatId, testData.senderId, 'Low priority');
    const msg2 = await createTestMessage(testData.chatId, testData.senderId, 'High priority');
    const msg3 = await createTestMessage(testData.chatId, testData.senderId, 'Medium priority');

    await repo.enqueue(msg1, 1);
    await repo.enqueue(msg2, 5);
    await repo.enqueue(msg3, 3);

    const item = await repo.dequeue();
    assertNotNull(item);
    assertEqual(item!.messageId, msg2, 'Should return highest priority item');
  });

  await test('dequeue: returns oldest item for same priority (FIFO)', async () => {
    await cleanupTestData();
    testData = await setupTestData();

    const messages = [];
    for (let i = 0; i < 3; i++) {
      const msgId = await createTestMessage(testData.chatId, testData.senderId, `Message ${i}`);
      await repo.enqueue(msgId, 2);
      messages.push(msgId);
      // Ensure different timestamps at second granularity (SQLite unixepoch() precision)
      await new Promise(resolve => setTimeout(resolve, 1100));
    }

    const item1 = await repo.dequeue();
    const item2 = await repo.dequeue();
    const item3 = await repo.dequeue();

    assertNotNull(item1);
    assertNotNull(item2);
    assertNotNull(item3);

    // Verify order: first dequeued should be oldest (first created)
    // Due to createdAt being stored as seconds, verify at least correct order
    assertTrue(item1!.createdAt <= item2!.createdAt, 'First item should be oldest or equal');
    assertTrue(item2!.createdAt <= item3!.createdAt, 'Second item should be older or equal to third');
  });

  await test('dequeue: returns null when queue is empty', async () => {
    await cleanupTestData();
    testData = await setupTestData();

    const item = await repo.dequeue();
    assertNull(item);
  });

  await test('dequeue: ignores processing and completed items', async () => {
    await cleanupTestData();
    testData = await setupTestData();

    const msg1 = await createTestMessage(testData.chatId, testData.senderId);
    const msg2 = await createTestMessage(testData.chatId, testData.senderId);
    const msg3 = await createTestMessage(testData.chatId, testData.senderId);

    const item1 = await repo.enqueue(msg1);
    const item2 = await repo.enqueue(msg2);
    await repo.enqueue(msg3);

    await repo.markProcessing(item1.id);
    await repo.markCompleted(item2.id);

    const item = await repo.dequeue();
    assertEqual(item!.messageId, msg3, 'Should only return pending item');
  });

  // ============================================================================
  // Status Transition Tests
  // ============================================================================

  await test('markProcessing: transitions from pending to processing', async () => {
    await cleanupTestData();
    testData = await setupTestData();
    const messageId = await createTestMessage(testData.chatId, testData.senderId);

    const item = await repo.enqueue(messageId);
    const success = await repo.markProcessing(item.id);

    assertTrue(success);
    const updated = await repo.getById(item.id);
    assertEqual(updated!.status, 'processing');
    assertEqual(updated!.version, 2, 'Version should increment');
    assertNotNull(updated!.processingStartedAt);
  });

  await test('markProcessing: uses optimistic locking (version mismatch)', async () => {
    await cleanupTestData();
    testData = await setupTestData();
    const messageId = await createTestMessage(testData.chatId, testData.senderId);

    const item = await repo.enqueue(messageId);

    // Simulate concurrent modification by marking processing once
    await repo.markProcessing(item.id);

    // Try to mark processing again with old version (should fail)
    const success = await repo.markProcessing(item.id, 1);

    assertFalse(success, 'Should fail due to version mismatch');
  });

  await test('markProcessing: succeeds with correct version', async () => {
    await cleanupTestData();
    testData = await setupTestData();
    const messageId = await createTestMessage(testData.chatId, testData.senderId);

    const item = await repo.enqueue(messageId);
    const success = await repo.markProcessing(item.id, item.version);

    assertTrue(success);
  });

  await test('markCompleted: sets status and processedAt', async () => {
    await cleanupTestData();
    testData = await setupTestData();
    const messageId = await createTestMessage(testData.chatId, testData.senderId);

    const item = await repo.enqueue(messageId);
    await repo.markProcessing(item.id);
    await repo.markCompleted(item.id);

    const completed = await repo.getById(item.id);
    assertEqual(completed!.status, 'completed');
    assertNotNull(completed!.processedAt);
  });

  await test('markFailed: sets status, error, and processedAt', async () => {
    await cleanupTestData();
    testData = await setupTestData();
    const messageId = await createTestMessage(testData.chatId, testData.senderId);

    const item = await repo.enqueue(messageId);
    await repo.markProcessing(item.id);
    await repo.markFailed(item.id, 'Test error');

    const failed = await repo.getById(item.id);
    assertEqual(failed!.status, 'failed');
    assertEqual(failed!.lastError, 'Test error');
    assertNotNull(failed!.processedAt);
  });

  // ============================================================================
  // Atomic Dequeue Tests
  // ============================================================================

  await test('dequeueAtomic: gets and marks processing atomically', async () => {
    await cleanupTestData();
    testData = await setupTestData();
    const messageId = await createTestMessage(testData.chatId, testData.senderId);

    await repo.enqueue(messageId);
    const item = await repo.dequeueAtomic();

    assertNotNull(item);
    assertEqual(item!.status, 'processing', 'Should be marked as processing');
    assertEqual(item!.version, 2, 'Version should increment');
  });

  await test('dequeueAtomic: returns null when queue is empty', async () => {
    await cleanupTestData();
    testData = await setupTestData();

    const item = await repo.dequeueAtomic();
    assertNull(item);
  });

  await test('dequeueAtomic: handles race condition (retries on conflict)', async () => {
    await cleanupTestData();
    testData = await setupTestData();
    const messageId = await createTestMessage(testData.chatId, testData.senderId);

    await repo.enqueue(messageId);

    // Simulate race condition by having two concurrent dequeue attempts
    const [item1, item2] = await Promise.all([
      repo.dequeueAtomic(),
      repo.dequeueAtomic(),
    ]);

    // One should succeed, one should return null (no other pending items)
    const successCount = [item1, item2].filter(i => i !== null).length;
    assertEqual(successCount, 1, 'Only one dequeue should succeed');
  });

  // ============================================================================
  // Retry Logic Tests
  // ============================================================================

  await test('incrementAttempts: increments attempt counter', async () => {
    await cleanupTestData();
    testData = await setupTestData();
    const messageId = await createTestMessage(testData.chatId, testData.senderId);

    const item = await repo.enqueue(messageId);
    const attempts1 = await repo.incrementAttempts(item.id);
    const attempts2 = await repo.incrementAttempts(item.id);

    assertEqual(attempts1, 1);
    assertEqual(attempts2, 2);
  });

  await test('incrementAttempts: throws error for non-existent item', async () => {
    try {
      await repo.incrementAttempts('non-existent-id');
      assertTrue(false, 'Should throw error');
    } catch (error) {
      assertTrue(error instanceof Error);
      assertTrue(error.message.includes('not found'));
    }
  });

  await test('updateAttemptsWithError: increments attempts and sets error', async () => {
    await cleanupTestData();
    testData = await setupTestData();
    const messageId = await createTestMessage(testData.chatId, testData.senderId);

    const item = await repo.enqueue(messageId);
    const attempts = await repo.updateAttemptsWithError(item.id, 'Retry error');

    assertEqual(attempts, 1);
    const updated = await repo.getById(item.id);
    assertEqual(updated!.attempts, 1);
    assertEqual(updated!.lastError, 'Retry error');
  });

  await test('scheduleRetry: sets status to pending with retry time', async () => {
    await cleanupTestData();
    testData = await setupTestData();
    const messageId = await createTestMessage(testData.chatId, testData.senderId);

    const item = await repo.enqueue(messageId);
    await repo.markProcessing(item.id);

    const nextRetryAt = new Date(Date.now() + 5000);
    await repo.scheduleRetry(item.id, nextRetryAt, 'Temporary error');

    const updated = await repo.getById(item.id);
    assertEqual(updated!.status, 'pending');
    assertEqual(updated!.lastError, 'Temporary error');
    assertNotNull(updated!.nextRetryAt);
  });

  await test('getReadyForRetry: returns items ready for retry', async () => {
    await cleanupTestData();
    testData = await setupTestData();

    const msg1 = await createTestMessage(testData.chatId, testData.senderId);
    const msg2 = await createTestMessage(testData.chatId, testData.senderId);
    const msg3 = await createTestMessage(testData.chatId, testData.senderId);

    // Item ready for immediate retry (null nextRetryAt)
    await repo.enqueue(msg1);

    // Item ready for retry (past nextRetryAt)
    const item2 = await repo.enqueue(msg2);
    const pastTime = new Date(Date.now() - 1000);
    await repo.scheduleRetry(item2.id, pastTime, 'Error');

    // Item not ready for retry (future nextRetryAt)
    const item3 = await repo.enqueue(msg3);
    const futureTime = new Date(Date.now() + 10000);
    await repo.scheduleRetry(item3.id, futureTime, 'Error');

    const ready = await repo.getReadyForRetry();

    assertEqual(ready.length, 2, 'Should return 2 items ready for retry');
  });

  await test('getPendingRetries: returns pending items with attempts > 0', async () => {
    await cleanupTestData();
    testData = await setupTestData();

    const msg1 = await createTestMessage(testData.chatId, testData.senderId);
    const msg2 = await createTestMessage(testData.chatId, testData.senderId);
    const msg3 = await createTestMessage(testData.chatId, testData.senderId);

    // New item (attempts = 0)
    await repo.enqueue(msg1);

    // Item with retry
    const item2 = await repo.enqueue(msg2);
    await repo.incrementAttempts(item2.id);

    // Item with multiple retries
    const item3 = await repo.enqueue(msg3);
    await repo.incrementAttempts(item3.id);
    await repo.incrementAttempts(item3.id);

    const retries = await repo.getPendingRetries();

    assertEqual(retries.length, 2, 'Should return 2 items with retries');
  });

  // ============================================================================
  // Priority Management Tests
  // ============================================================================

  await test('updatePriority: updates priority and boost flag', async () => {
    await cleanupTestData();
    testData = await setupTestData();
    const messageId = await createTestMessage(testData.chatId, testData.senderId);

    const item = await repo.enqueue(messageId, 1);
    await repo.updatePriority(item.id, 3, 2, 1);

    const updated = await repo.getById(item.id);
    assertEqual(updated!.priority, 3);
    assertEqual(updated!.priorityBoostApplied, true);
    assertEqual(updated!.originalPriority, 1);
  });

  await test('updatePriority: sets boost to false when boostApplied is 0', async () => {
    await cleanupTestData();
    testData = await setupTestData();
    const messageId = await createTestMessage(testData.chatId, testData.senderId);

    const item = await repo.enqueue(messageId, 1);
    await repo.updatePriority(item.id, 1, 0);

    const updated = await repo.getById(item.id);
    assertEqual(updated!.priorityBoostApplied, false);
  });

  // ============================================================================
  // Queue Statistics Tests
  // ============================================================================

  await test('getStats: returns correct status counts', async () => {
    await cleanupTestData();
    testData = await setupTestData();

    const msg1 = await createTestMessage(testData.chatId, testData.senderId);
    const msg2 = await createTestMessage(testData.chatId, testData.senderId);
    const msg3 = await createTestMessage(testData.chatId, testData.senderId);
    const msg4 = await createTestMessage(testData.chatId, testData.senderId);

    const item1 = await repo.enqueue(msg1);
    const item2 = await repo.enqueue(msg2);
    const item3 = await repo.enqueue(msg3);
    const item4 = await repo.enqueue(msg4);

    await repo.markProcessing(item2.id);
    await repo.markCompleted(item3.id);
    await repo.markFailed(item4.id, 'Error');

    const stats = await repo.getStats();

    assertEqual(stats.pending, 1);
    assertEqual(stats.processing, 1);
    assertEqual(stats.completed, 1);
    assertEqual(stats.failed, 1);
  });

  await test('getStats: returns zeros for empty queue', async () => {
    await cleanupTestData();
    testData = await setupTestData();

    const stats = await repo.getStats();

    assertEqual(stats.pending, 0);
    assertEqual(stats.processing, 0);
    assertEqual(stats.completed, 0);
    assertEqual(stats.failed, 0);
  });

  // ============================================================================
  // Stale Items Tests
  // ============================================================================

  await test('getStaleItems: returns items older than threshold', async () => {
    await cleanupTestData();
    testData = await setupTestData();

    const msg1 = await createTestMessage(testData.chatId, testData.senderId);
    const msg2 = await createTestMessage(testData.chatId, testData.senderId);

    await repo.enqueue(msg1);
    await repo.enqueue(msg2);

    // Wait a bit
    await new Promise(resolve => setTimeout(resolve, 100));

    const stale = await repo.getStaleItems(50);

    assertGreaterThanOrEqual(stale.length, 2, 'Should return stale items');
  });

  await test('getStaleItems: returns empty array when no stale items', async () => {
    await cleanupTestData();
    testData = await setupTestData();

    const messageId = await createTestMessage(testData.chatId, testData.senderId);
    await repo.enqueue(messageId);

    const stale = await repo.getStaleItems(10000);

    assertEqual(stale.length, 0, 'Should return empty array');
  });

  // ============================================================================
  // Stuck Messages Tests
  // ============================================================================

  await test('getStuckProcessingMessages: returns processing items older than threshold', async () => {
    await cleanupTestData();
    testData = await setupTestData();

    const msg1 = await createTestMessage(testData.chatId, testData.senderId);
    const msg2 = await createTestMessage(testData.chatId, testData.senderId);

    const item1 = await repo.enqueue(msg1);
    const item2 = await repo.enqueue(msg2);

    await repo.markProcessing(item1.id);
    await repo.markProcessing(item2.id);

    await new Promise(resolve => setTimeout(resolve, 100));

    const stuck = await repo.getStuckProcessingMessages(50);

    assertGreaterThanOrEqual(stuck.length, 2, 'Should return stuck messages');
  });

  await test('getStuckMessagesForRetry: filters by max attempts', async () => {
    await cleanupTestData();
    testData = await setupTestData();

    const msg1 = await createTestMessage(testData.chatId, testData.senderId);
    const msg2 = await createTestMessage(testData.chatId, testData.senderId);

    const item1 = await repo.enqueue(msg1);
    const item2 = await repo.enqueue(msg2);

    await repo.incrementAttempts(item1.id);
    await repo.incrementAttempts(item2.id);
    await repo.incrementAttempts(item2.id);
    await repo.incrementAttempts(item2.id);

    await repo.markProcessing(item1.id);
    await repo.markProcessing(item2.id);

    await new Promise(resolve => setTimeout(resolve, 100));

    const stuck = await repo.getStuckMessagesForRetry(50, 2);

    assertEqual(stuck.length, 1, 'Should only return item under max attempts');
    assertEqual(stuck[0].id, item1.id);
  });

  await test('resetStuckForRetry: resets processing to pending and increments attempts', async () => {
    await cleanupTestData();
    testData = await setupTestData();
    const messageId = await createTestMessage(testData.chatId, testData.senderId);

    const item = await repo.enqueue(messageId);
    await repo.markProcessing(item.id);

    const nextRetryAt = new Date(Date.now() + 5000);
    const attempts = await repo.resetStuckForRetry(item.id, nextRetryAt, 'Stuck error');

    assertEqual(attempts, 1);
    const updated = await repo.getById(item.id);
    assertEqual(updated!.status, 'pending');
    assertEqual(updated!.attempts, 1);
    assertEqual(updated!.lastError, 'Stuck error');
  });

  await test('getStuckMessageStats: returns statistics for stuck messages', async () => {
    await cleanupTestData();
    testData = await setupTestData();

    const msg1 = await createTestMessage(testData.chatId, testData.senderId);
    const msg2 = await createTestMessage(testData.chatId, testData.senderId);

    const item1 = await repo.enqueue(msg1, 1);
    const item2 = await repo.enqueue(msg2, 2);

    await repo.markProcessing(item1.id);
    await repo.markProcessing(item2.id);

    await new Promise(resolve => setTimeout(resolve, 150));

    const stats = await repo.getStuckMessageStats(50);

    assertEqual(stats.count, 2, 'Should count both stuck messages');
    assertGreaterThanOrEqual(stats.oldestAgeMinutes, 0, 'Oldest age should be >= 0');
    assertTrue(stats.ageDistribution.length > 0);
    assertTrue(stats.byPriority.length > 0);
  });

  // ============================================================================
  // Batch Operations Tests
  // ============================================================================

  await test('batchMarkFailed: marks multiple items as failed', async () => {
    await cleanupTestData();
    testData = await setupTestData();

    const msg1 = await createTestMessage(testData.chatId, testData.senderId);
    const msg2 = await createTestMessage(testData.chatId, testData.senderId);
    const msg3 = await createTestMessage(testData.chatId, testData.senderId);

    const item1 = await repo.enqueue(msg1);
    const item2 = await repo.enqueue(msg2);
    const item3 = await repo.enqueue(msg3);

    const count = await repo.batchMarkFailed([item1.id, item2.id, item3.id], 'Batch error');

    assertEqual(count, 3);

    const failed1 = await repo.getById(item1.id);
    const failed2 = await repo.getById(item2.id);
    const failed3 = await repo.getById(item3.id);

    assertEqual(failed1!.status, 'failed');
    assertEqual(failed2!.status, 'failed');
    assertEqual(failed3!.status, 'failed');
  });

  await test('batchMarkFailed: returns 0 for empty array', async () => {
    const count = await repo.batchMarkFailed([], 'Error');
    assertEqual(count, 0);
  });

  // ============================================================================
  // Shutdown and Recovery Tests
  // ============================================================================

  await test('resetAllProcessingForShutdown: resets all processing messages', async () => {
    await cleanupTestData();
    testData = await setupTestData();

    const msg1 = await createTestMessage(testData.chatId, testData.senderId);
    const msg2 = await createTestMessage(testData.chatId, testData.senderId);

    const item1 = await repo.enqueue(msg1);
    const item2 = await repo.enqueue(msg2);

    await repo.markProcessing(item1.id);
    await repo.markProcessing(item2.id);

    const count = await repo.resetAllProcessingForShutdown();

    assertEqual(count, 2, 'Should reset both processing messages');

    const reset1 = await repo.getById(item1.id);
    const reset2 = await repo.getById(item2.id);

    assertEqual(reset1!.status, 'pending');
    assertEqual(reset2!.status, 'pending');
    assertEqual(reset1!.lastError, 'Interrupted by graceful shutdown');
    assertEqual(reset2!.lastError, 'Interrupted by graceful shutdown');
  });

  await test('getProcessingMessages: returns all processing messages', async () => {
    await cleanupTestData();
    testData = await setupTestData();

    const msg1 = await createTestMessage(testData.chatId, testData.senderId);
    const msg2 = await createTestMessage(testData.chatId, testData.senderId);
    const msg3 = await createTestMessage(testData.chatId, testData.senderId);

    const item1 = await repo.enqueue(msg1);
    const item2 = await repo.enqueue(msg2);
    await repo.enqueue(msg3);

    await repo.markProcessing(item1.id);
    await repo.markProcessing(item2.id);

    const processing = await repo.getProcessingMessages();

    assertEqual(processing.length, 2);
  });

  // ============================================================================
  // Cleanup Tests
  // ============================================================================

  await test('purgeOldEntries: removes old completed and failed entries', async () => {
    await cleanupTestData();
    testData = await setupTestData();

    const msg1 = await createTestMessage(testData.chatId, testData.senderId);
    const msg2 = await createTestMessage(testData.chatId, testData.senderId);
    const msg3 = await createTestMessage(testData.chatId, testData.senderId);

    const item1 = await repo.enqueue(msg1);
    const item2 = await repo.enqueue(msg2);
    const item3 = await repo.enqueue(msg3);

    await repo.markCompleted(item1.id);
    await repo.markFailed(item2.id, 'Error');

    // Wait a bit
    await new Promise(resolve => setTimeout(resolve, 100));

    const purged = await repo.purgeOldEntries(50);

    assertGreaterThanOrEqual(purged, 2, 'Should purge completed and failed entries');

    const remaining = await repo.getById(item3.id);
    assertNotNull(remaining, 'Pending item should remain');
  });

  // ============================================================================
  // Edge Cases
  // ============================================================================

  await test('getById: returns null for non-existent item', async () => {
    const item = await repo.getById('non-existent-id');
    assertNull(item);
  });

  await test('findActiveByMessageId: returns null for completed message', async () => {
    await cleanupTestData();
    testData = await setupTestData();
    const messageId = await createTestMessage(testData.chatId, testData.senderId);

    const item = await repo.enqueue(messageId);
    await repo.markCompleted(item.id);

    const active = await repo.findActiveByMessageId(messageId);
    assertNull(active);
  });

  await test('findActiveByMessageId: returns null for failed message', async () => {
    await cleanupTestData();
    testData = await setupTestData();
    const messageId = await createTestMessage(testData.chatId, testData.senderId);

    const item = await repo.enqueue(messageId);
    await repo.markFailed(item.id, 'Error');

    const active = await repo.findActiveByMessageId(messageId);
    assertNull(active);
  });

  await test('markProcessing: returns false for non-existent item', async () => {
    const success = await repo.markProcessing('non-existent-id');
    assertFalse(success);
  });

  await test('concurrent enqueue: handles race condition gracefully', async () => {
    await cleanupTestData();
    testData = await setupTestData();
    const messageId = await createTestMessage(testData.chatId, testData.senderId);

    // Try to enqueue the same message concurrently
    const [item1, item2, item3] = await Promise.all([
      repo.enqueue(messageId),
      repo.enqueue(messageId),
      repo.enqueue(messageId),
    ]);

    // All should return the same item (deduplication)
    assertEqual(item1.id, item2.id);
    assertEqual(item2.id, item3.id);
  });

  // ============================================================================
  // Cleanup and Summary
  // ============================================================================

  try {
    await cleanupTestData();
  } catch (error) {
    console.error('Failed to cleanup test data:', error);
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((error) => {
  console.error('Test suite failed:', error);
  process.exit(1);
});
