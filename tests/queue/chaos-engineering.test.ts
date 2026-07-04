#!/usr/bin/env npx tsx
/**
 * Chaos Engineering Tests for Queue System
 *
 * Tests system resilience and recovery under various failure conditions:
 * - Random failures during processing
 * - Circuit breaker behavior under cascading failures
 * - Recovery after service restoration
 * - DLQ overflow scenarios
 * - Priority starvation prevention
 * - Thundering herd prevention
 * - Partial system failures
 *
 * Run: npx tsx tests/queue/chaos-engineering.test.ts
 */

import { QueueRepository } from '../../src/repositories/queue.repository.js';
import { DeadLetterQueueRepository } from '../../src/repositories/deadLetterQueue.repository.js';
import { CircuitBreakerRepository } from '../../src/repositories/circuitBreaker.repository.js';
import { RetryStrategyService } from '../../src/services/retryStrategy.service.js';
import { CircuitBreakerService, CircuitOpenError } from '../../src/services/circuitBreaker.service.js';
import { DeadLetterQueueService } from '../../src/services/deadLetterQueue.service.js';
import { PriorityEscalationService } from '../../src/services/priorityEscalation.service.js';
import { MessageRepository } from '../../src/repositories/message.repository.js';
import { PriorityLevel, DLQReason, DEFAULT_PRIORITY_CONFIG } from '../../src/types/queue.types.js';
import { queue, messages, chats, senders, deadLetterQueue, circuitBreakerStates } from '../../src/db/schema.js';
import { sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';

// ============================================================================
// Types and Configuration
// ============================================================================

interface ChaosTestResult {
  name: string;
  passed: boolean;
  duration: number;
  details?: Record<string, unknown>;
  error?: string;
}

interface ChaosConfig {
  failureRate: number;       // 0-1, probability of failure
  latencyMs: number;         // Simulated latency
  timeoutMs: number;         // When to consider operation timed out
  recoveryDelayMs: number;   // Time before service "recovers"
}

const DEFAULT_CHAOS_CONFIG: ChaosConfig = {
  failureRate: 0.3,          // 30% failure rate
  latencyMs: 50,
  timeoutMs: 5000,
  recoveryDelayMs: 1000,
};

const testResults: ChaosTestResult[] = [];

// ============================================================================
// Test Utilities
// ============================================================================

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

async function measureTime<T>(fn: () => Promise<T>): Promise<{ result: T; duration: number }> {
  const start = Date.now();
  const result = await fn();
  const duration = Date.now() - start;
  return { result, duration };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Simulates an unreliable service that fails randomly
 */
class UnreliableService {
  private failureRate: number;
  private latencyMs: number;
  private forceFail: boolean = false;
  private forceSuccess: boolean = false;

  constructor(config: Partial<ChaosConfig> = {}) {
    this.failureRate = config.failureRate ?? DEFAULT_CHAOS_CONFIG.failureRate;
    this.latencyMs = config.latencyMs ?? DEFAULT_CHAOS_CONFIG.latencyMs;
  }

  setForceFail(value: boolean): void {
    this.forceFail = value;
    this.forceSuccess = false;
  }

  setForceSuccess(value: boolean): void {
    this.forceSuccess = value;
    this.forceFail = false;
  }

  resetForce(): void {
    this.forceFail = false;
    this.forceSuccess = false;
  }

  async call<T>(operation: () => Promise<T>): Promise<T> {
    // Simulate network latency
    await sleep(Math.random() * this.latencyMs);

    if (this.forceFail || (!this.forceSuccess && Math.random() < this.failureRate)) {
      throw new Error('Service unavailable (chaos injection)');
    }

    return operation();
  }
}

// Helper to create test messages
async function createTestMessages(count: number): Promise<string[]> {
  const messageIds: string[] = [];
  const chatId = `test-chaos-chat-${nanoid()}`;
  const senderId = `test-chaos-sender-${nanoid()}`;

  const { db } = await import('../../src/db/client.js');

  await db.insert(senders).values({
    id: senderId,
    telegramId: `tg-${senderId}`,
    firstName: 'Chaos',
    lastName: 'Test',
    createdAt: new Date(),
    updatedAt: new Date(),
  }).onConflictDoNothing();

  await db.insert(chats).values({
    id: chatId,
    telegramId: `tg-${chatId}`,
    type: 'private',
    title: 'Chaos Test Chat',
    createdAt: new Date(),
    updatedAt: new Date(),
  }).onConflictDoNothing();

  const batchSize = 50;
  for (let i = 0; i < count; i += batchSize) {
    const batch = [];
    const batchEnd = Math.min(i + batchSize, count);

    for (let j = i; j < batchEnd; j++) {
      const msgId = `test-chaos-msg-${nanoid()}`;
      messageIds.push(msgId);
      batch.push({
        id: msgId,
        telegramMessageId: j,
        chatId,
        senderId,
        text: `Chaos test message ${j}`,
        rawJson: JSON.stringify({ chaos: true }),
        isBot: false,
        createdAt: new Date(),
      });
    }

    await db.insert(messages).values(batch).onConflictDoNothing();
  }

  return messageIds;
}

async function cleanupTestData(): Promise<void> {
  const { db, connection } = await import('../../src/db/client.js');

  // Temporarily disable foreign keys for cleanup
  connection.exec('PRAGMA foreign_keys = OFF');

  try {
    await db.delete(queue).where(sql`id LIKE 'test-%' OR messageId LIKE 'test-%'`);
    await db.delete(deadLetterQueue).where(sql`id LIKE 'test-%' OR messageId LIKE 'test-%'`);
    await db.delete(circuitBreakerStates).where(sql`serviceName LIKE 'test-%' OR serviceName LIKE 'chaos-%'`);
    await db.delete(messages).where(sql`id LIKE 'test-%'`);
    await db.delete(chats).where(sql`id LIKE 'test-%'`);
    await db.delete(senders).where(sql`id LIKE 'test-%'`);
  } finally {
    // Re-enable foreign keys
    connection.exec('PRAGMA foreign_keys = ON');
  }
}

// ============================================================================
// Chaos Test Scenarios
// ============================================================================

/**
 * Test 1: Random Failures During Processing
 * Verifies that the system correctly handles random failures and retries
 */
async function testRandomFailures(): Promise<void> {
  console.log('\n🎲 Testing Random Failures During Processing...');

  const queueRepo = new QueueRepository();
  const retryService = new RetryStrategyService({
    maxAttempts: 3,
    baseDelayMs: 10,
    maxDelayMs: 100,
    backoffMultiplier: 2,
    jitterFactor: 0.1,
  });
  const unreliable = new UnreliableService({ failureRate: 0.5 });

  const messageIds = await createTestMessages(20);
  const queueItems: { id: string; messageId: string }[] = [];

  // Enqueue all items
  for (const msgId of messageIds) {
    const item = await queueRepo.enqueue(msgId, PriorityLevel.NORMAL);
    queueItems.push({ id: item.id, messageId: msgId });
  }

  let successCount = 0;
  let failureCount = 0;
  let retryCount = 0;

  const { duration } = await measureTime(async () => {
    for (const queueItem of queueItems) {
      let attempts = 0;
      let processed = false;

      while (!processed && attempts < 3) {
        attempts++;
        await queueRepo.markProcessing(queueItem.id);

        try {
          await unreliable.call(async () => {
            // Simulate processing
            await sleep(10);
          });

          await queueRepo.markCompleted(queueItem.id);
          successCount++;
          processed = true;
        } catch (error) {
          if (retryService.shouldRetry(attempts)) {
            const delay = retryService.calculateNextRetryDelay(attempts);
            await queueRepo.scheduleRetry(queueItem.id, new Date(Date.now() + delay), (error as Error).message);
            retryCount++;
            await sleep(delay);
          } else {
            await queueRepo.markFailed(queueItem.id, (error as Error).message);
            failureCount++;
            processed = true;
          }
        }
      }
    }
  });

  const stats = await queueRepo.getStats();
  const passed = successCount > 0 && stats.completed > 0;

  logTest('Random failures handling', passed, duration, {
    totalItems: 20,
    successCount,
    failureCount,
    retryCount,
    stats,
  });
}

/**
 * Test 2: Circuit Breaker Under Cascading Failures
 * Verifies circuit breaker opens under sustained failures
 */
async function testCircuitBreakerCascade(): Promise<void> {
  console.log('\n⚡ Testing Circuit Breaker Under Cascading Failures...');

  const cbRepo = new CircuitBreakerRepository();
  const cb = new CircuitBreakerService('chaos-cascade-test', {
    failureThreshold: 5,
    resetTimeoutMs: 500,
    halfOpenRequests: 2,
  }, cbRepo);

  await cb.initialize();

  const unreliable = new UnreliableService();
  unreliable.setForceFail(true); // Force all calls to fail

  let circuitOpenedAt: number | null = null;
  let callsRejected = 0;

  const { duration } = await measureTime(async () => {
    for (let i = 0; i < 20; i++) {
      try {
        await cb.execute(async () => {
          return unreliable.call(async () => 'success');
        });
      } catch (error) {
        if (error instanceof CircuitOpenError) {
          if (!circuitOpenedAt) {
            circuitOpenedAt = i;
          }
          callsRejected++;
        }
        // Expected failures
      }
    }
  });

  const state = cb.getState();
  const passed = state === 'OPEN' && circuitOpenedAt !== null && circuitOpenedAt <= 5;

  logTest('Circuit breaker cascade protection', passed, duration, {
    finalState: state,
    circuitOpenedAtCall: circuitOpenedAt,
    callsRejected,
    stats: cb.getStats(),
  });

  // Cleanup
  await cbRepo.delete('chaos-cascade-test');
}

/**
 * Test 3: Recovery After Service Restoration
 * Verifies system recovers when service becomes healthy again
 */
async function testRecoveryAfterRestoration(): Promise<void> {
  console.log('\n🔄 Testing Recovery After Service Restoration...');

  const cbRepo = new CircuitBreakerRepository();
  const cb = new CircuitBreakerService('chaos-recovery-test', {
    failureThreshold: 3,
    resetTimeoutMs: 200,
    halfOpenRequests: 2,
  }, cbRepo);

  await cb.initialize();

  const unreliable = new UnreliableService();

  // Phase 1: Cause failures to open circuit
  unreliable.setForceFail(true);
  for (let i = 0; i < 5; i++) {
    try {
      await cb.execute(async () => unreliable.call(async () => 'test'));
    } catch {
      // Expected
    }
  }

  const stateAfterFailures = cb.getState();

  // Phase 2: Wait for reset timeout
  await sleep(300);

  // Phase 3: Service recovers
  unreliable.setForceSuccess(true);

  let recoverySuccessCount = 0;
  const { duration } = await measureTime(async () => {
    for (let i = 0; i < 5; i++) {
      try {
        await cb.execute(async () => unreliable.call(async () => 'success'));
        recoverySuccessCount++;
      } catch {
        // May fail during half-open
      }
      await sleep(50); // Small delay between attempts
    }
  });

  const finalState = cb.getState();
  const passed = stateAfterFailures === 'OPEN' && finalState === 'CLOSED' && recoverySuccessCount > 0;

  logTest('Recovery after service restoration', passed, duration, {
    stateAfterFailures,
    finalState,
    recoverySuccessCount,
  });

  // Cleanup
  await cbRepo.delete('chaos-recovery-test');
}

/**
 * Test 4: DLQ Overflow Handling
 * Verifies system handles many items moving to DLQ
 */
async function testDLQOverflow(): Promise<void> {
  console.log('\n💀 Testing DLQ Overflow Handling...');

  const queueRepo = new QueueRepository();
  const dlqRepo = new DeadLetterQueueRepository();
  const dlqService = new DeadLetterQueueService(dlqRepo, queueRepo);

  // Create real messages first to satisfy foreign key constraint
  const messageIds = await createTestMessages(100);

  const { duration } = await measureTime(async () => {
    // Add many items to DLQ
    for (let i = 0; i < 100; i++) {
      await dlqRepo.add({
        originalQueueId: `test-overflow-queue-${nanoid()}`,
        messageId: messageIds[i],
        reason: DLQReason.MAX_RETRIES_EXCEEDED,
        errorHistory: [
          { timestamp: new Date(), error: `Error ${i}`, attempt: 1 },
          { timestamp: new Date(), error: `Error ${i} retry 1`, attempt: 2 },
          { timestamp: new Date(), error: `Error ${i} retry 2`, attempt: 3 },
        ],
        attempts: 3,
        metadata: { index: i },
      });
    }
  });

  const stats = await dlqService.getStats();
  const passed = stats.total >= 100 && duration < 5000;

  logTest('DLQ overflow handling', passed, duration, {
    itemsAdded: 100,
    stats,
  });
}

/**
 * Test 5: Priority Starvation Prevention
 * Verifies that low-priority items eventually get processed
 */
async function testPriorityStarvation(): Promise<void> {
  console.log('\n📊 Testing Priority Starvation Prevention...');

  const queueRepo = new QueueRepository();
  const messageRepo = new MessageRepository();

  // Create mix of priorities
  const lowPriorityMsgs = await createTestMessages(10);
  const highPriorityMsgs = await createTestMessages(10);

  // Enqueue low priority first
  const lowPriorityItems: string[] = [];
  for (const msgId of lowPriorityMsgs) {
    const item = await queueRepo.enqueue(msgId, PriorityLevel.LOW);
    lowPriorityItems.push(item.id);
  }

  // Wait a bit, then enqueue high priority
  await sleep(100);

  for (const msgId of highPriorityMsgs) {
    await queueRepo.enqueue(msgId, PriorityLevel.HIGH);
  }

  // Set up escalation service with aggressive escalation
  const escalationService = new PriorityEscalationService(queueRepo, messageRepo, {
    ...DEFAULT_PRIORITY_CONFIG,
    escalationRules: [
      { ageThresholdMs: 50, priorityBoost: 1, maxPriority: PriorityLevel.HIGH },
      { ageThresholdMs: 100, priorityBoost: 2, maxPriority: PriorityLevel.URGENT },
    ],
  });

  // Run escalation
  const { duration } = await measureTime(async () => {
    await sleep(150); // Wait for items to become stale
    await escalationService.escalateStaleItems();
  });

  // Check that low priority items were escalated
  let escalatedCount = 0;
  for (const itemId of lowPriorityItems) {
    const item = await queueRepo.getById(itemId);
    if (item && item.priority > PriorityLevel.LOW) {
      escalatedCount++;
    }
  }

  const passed = escalatedCount > 0;

  logTest('Priority starvation prevention', passed, duration, {
    lowPriorityItems: 10,
    escalatedCount,
  });
}

/**
 * Test 6: Thundering Herd Prevention
 * Verifies jitter prevents all retries from happening at once
 */
async function testThunderingHerdPrevention(): Promise<void> {
  console.log('\n🐘 Testing Thundering Herd Prevention...');

  const retryService = new RetryStrategyService({
    maxAttempts: 5,
    baseDelayMs: 100,
    maxDelayMs: 1000,
    backoffMultiplier: 2,
    jitterFactor: 0.25, // 25% jitter
  });

  // Calculate delays for same attempt number many times
  const delays: number[] = [];
  const attemptNumber = 3;

  const { duration } = await measureTime(async () => {
    for (let i = 0; i < 100; i++) {
      delays.push(retryService.calculateNextRetryDelay(attemptNumber));
    }
  });

  // Check that delays are spread out (not all the same)
  const uniqueDelays = new Set(delays);
  const minDelay = Math.min(...delays);
  const maxDelay = Math.max(...delays);
  const spread = maxDelay - minDelay;

  // With 25% jitter on a ~800ms base delay, expect spread > 200ms
  const passed = uniqueDelays.size > 50 && spread > 100;

  logTest('Thundering herd prevention (jitter)', passed, duration, {
    uniqueDelayCount: uniqueDelays.size,
    minDelay,
    maxDelay,
    spread,
    sampleDelays: delays.slice(0, 5),
  });
}

/**
 * Test 7: Partial System Failure
 * Verifies system continues operating when some components fail
 */
async function testPartialSystemFailure(): Promise<void> {
  console.log('\n🔧 Testing Partial System Failure...');

  const queueRepo = new QueueRepository();
  const cbRepo = new CircuitBreakerRepository();

  // Create two circuit breakers for different "services"
  const primaryCB = new CircuitBreakerService('chaos-primary', {
    failureThreshold: 3,
    resetTimeoutMs: 100,
    halfOpenRequests: 2,
  }, cbRepo);

  const backupCB = new CircuitBreakerService('chaos-backup', {
    failureThreshold: 3,
    resetTimeoutMs: 100,
    halfOpenRequests: 2,
  }, cbRepo);

  await primaryCB.initialize();
  await backupCB.initialize();

  const unreliablePrimary = new UnreliableService();
  const unreliableBackup = new UnreliableService();

  unreliablePrimary.setForceFail(true); // Primary always fails
  unreliableBackup.setForceSuccess(true); // Backup always succeeds

  let primaryFailures = 0;
  let backupSuccesses = 0;

  const messageIds = await createTestMessages(10);
  const queueItems: string[] = [];

  for (const msgId of messageIds) {
    const item = await queueRepo.enqueue(msgId, PriorityLevel.NORMAL);
    queueItems.push(item.id);
  }

  const { duration } = await measureTime(async () => {
    for (const itemId of queueItems) {
      await queueRepo.markProcessing(itemId);

      let processed = false;

      // Try primary first
      try {
        await primaryCB.execute(async () => {
          return unreliablePrimary.call(async () => 'primary');
        });
        processed = true;
      } catch (error) {
        primaryFailures++;
        // Fall back to backup
        try {
          await backupCB.execute(async () => {
            return unreliableBackup.call(async () => 'backup');
          });
          backupSuccesses++;
          processed = true;
        } catch {
          // Both failed
        }
      }

      if (processed) {
        await queueRepo.markCompleted(itemId);
      } else {
        await queueRepo.markFailed(itemId, 'Both services failed');
      }
    }
  });

  const stats = await queueRepo.getStats();
  const passed = backupSuccesses > 0 && stats.completed > 0;

  logTest('Partial system failure handling', passed, duration, {
    primaryFailures,
    backupSuccesses,
    stats,
    primaryState: primaryCB.getState(),
    backupState: backupCB.getState(),
  });

  // Cleanup
  await cbRepo.delete('chaos-primary');
  await cbRepo.delete('chaos-backup');
}

/**
 * Test 8: Concurrent Chaos
 * Verifies system handles concurrent failures and retries
 */
async function testConcurrentChaos(): Promise<void> {
  console.log('\n🌀 Testing Concurrent Chaos...');

  const queueRepo = new QueueRepository();
  const retryService = new RetryStrategyService({
    maxAttempts: 3,
    baseDelayMs: 10,
    maxDelayMs: 50,
    backoffMultiplier: 2,
    jitterFactor: 0.2,
  });

  const messageIds = await createTestMessages(30);
  const queueItems: string[] = [];

  for (const msgId of messageIds) {
    const item = await queueRepo.enqueue(msgId, Math.floor(Math.random() * 4));
    queueItems.push(item.id);
  }

  let successCount = 0;
  let failCount = 0;

  const unreliable = new UnreliableService({ failureRate: 0.4 });

  const { duration } = await measureTime(async () => {
    // Process all items concurrently
    await Promise.all(
      queueItems.map(async (itemId) => {
        let attempts = 0;
        let processed = false;

        while (!processed && attempts < 3) {
          attempts++;

          try {
            await unreliable.call(async () => {
              await sleep(Math.random() * 20);
            });

            await queueRepo.markCompleted(itemId);
            successCount++;
            processed = true;
          } catch (error) {
            if (retryService.shouldRetry(attempts)) {
              const delay = retryService.calculateNextRetryDelay(attempts);
              await sleep(delay);
            } else {
              await queueRepo.markFailed(itemId, (error as Error).message);
              failCount++;
              processed = true;
            }
          }
        }
      })
    );
  });

  const stats = await queueRepo.getStats();
  const passed = successCount > 0 && (successCount + failCount) === 30;

  logTest('Concurrent chaos handling', passed, duration, {
    totalItems: 30,
    successCount,
    failCount,
    stats,
  });
}

/**
 * Test 9: Retry Budget Exhaustion
 * Verifies items move to DLQ after exhausting retries
 */
async function testRetryBudgetExhaustion(): Promise<void> {
  console.log('\n💸 Testing Retry Budget Exhaustion...');

  const queueRepo = new QueueRepository();
  const dlqRepo = new DeadLetterQueueRepository();
  const retryService = new RetryStrategyService({
    maxAttempts: 3,
    baseDelayMs: 10,
    maxDelayMs: 50,
    backoffMultiplier: 2,
    jitterFactor: 0.1,
  });

  const messageIds = await createTestMessages(5);
  const queueItems: { id: string; messageId: string }[] = [];

  for (const msgId of messageIds) {
    const item = await queueRepo.enqueue(msgId, PriorityLevel.NORMAL);
    queueItems.push({ id: item.id, messageId: msgId });
  }

  const unreliable = new UnreliableService();
  unreliable.setForceFail(true); // Always fail

  let dlqCount = 0;

  const { duration } = await measureTime(async () => {
    for (const queueItem of queueItems) {
      let attempts = 0;
      let exhausted = false;
      const errorHistory: Array<{ timestamp: Date; error: string; attempt: number }> = [];

      while (!exhausted) {
        attempts++;
        await queueRepo.incrementAttempts(queueItem.id);

        try {
          await unreliable.call(async () => 'success');
          await queueRepo.markCompleted(queueItem.id);
          exhausted = true;
        } catch (error) {
          errorHistory.push({
            timestamp: new Date(),
            error: (error as Error).message,
            attempt: attempts,
          });

          if (!retryService.shouldRetry(attempts)) {
            // Move to DLQ
            await dlqRepo.add({
              originalQueueId: queueItem.id,
              messageId: queueItem.messageId,
              reason: DLQReason.MAX_RETRIES_EXCEEDED,
              errorHistory,
              attempts,
              metadata: {},
            });

            await queueRepo.markFailed(queueItem.id, 'Max retries exceeded');
            dlqCount++;
            exhausted = true;
          } else {
            const delay = retryService.calculateNextRetryDelay(attempts);
            await sleep(delay);
          }
        }
      }
    }
  });

  const dlqStats = await (new DeadLetterQueueService(dlqRepo, queueRepo)).getStats();
  const passed = dlqCount === 5 && dlqStats.byReason[DLQReason.MAX_RETRIES_EXCEEDED] >= 5;

  logTest('Retry budget exhaustion to DLQ', passed, duration, {
    totalItems: 5,
    dlqCount,
    dlqStats,
  });
}

/**
 * Test 10: Circuit Breaker Half-Open State Validation
 * Verifies proper behavior in half-open state
 */
async function testCircuitBreakerHalfOpen(): Promise<void> {
  console.log('\n🔌 Testing Circuit Breaker Half-Open State...');

  const cbRepo = new CircuitBreakerRepository();
  const cb = new CircuitBreakerService('chaos-half-open-test', {
    failureThreshold: 3,
    resetTimeoutMs: 100,
    halfOpenRequests: 2,
  }, cbRepo);

  await cb.initialize();

  const unreliable = new UnreliableService();

  // Phase 1: Open the circuit
  unreliable.setForceFail(true);
  for (let i = 0; i < 5; i++) {
    try {
      await cb.execute(async () => unreliable.call(async () => 'test'));
    } catch {
      // Expected
    }
  }

  const stateAfterOpen = cb.getState();

  // Phase 2: Wait for reset timeout to enter half-open
  await sleep(150);

  // Phase 3: First half-open request succeeds
  unreliable.setForceSuccess(true);

  let halfOpenSuccess = 0;
  let halfOpenFail = 0;

  const { duration } = await measureTime(async () => {
    // Try multiple requests in half-open
    for (let i = 0; i < 5; i++) {
      try {
        await cb.execute(async () => unreliable.call(async () => 'success'));
        halfOpenSuccess++;
      } catch (error) {
        if (error instanceof CircuitOpenError) {
          // Expected when limit reached
        }
        halfOpenFail++;
      }
    }
  });

  const finalState = cb.getState();

  // Should have closed after successful half-open requests
  const passed = stateAfterOpen === 'OPEN' && finalState === 'CLOSED' && halfOpenSuccess >= 2;

  logTest('Circuit breaker half-open validation', passed, duration, {
    stateAfterOpen,
    finalState,
    halfOpenSuccess,
    halfOpenFail,
    stats: cb.getStats(),
  });

  // Cleanup
  await cbRepo.delete('chaos-half-open-test');
}

// ============================================================================
// Main Test Runner
// ============================================================================

async function runAllTests(): Promise<void> {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('              Chaos Engineering Tests for Queue System          ');
  console.log('═══════════════════════════════════════════════════════════════');

  const startTime = Date.now();

  try {
    // Cleanup before tests
    await cleanupTestData();

    await testRandomFailures();
    await cleanupTestData();

    await testCircuitBreakerCascade();

    await testRecoveryAfterRestoration();

    await testDLQOverflow();
    await cleanupTestData();

    await testPriorityStarvation();
    await cleanupTestData();

    await testThunderingHerdPrevention();

    await testPartialSystemFailure();
    await cleanupTestData();

    await testConcurrentChaos();
    await cleanupTestData();

    await testRetryBudgetExhaustion();
    await cleanupTestData();

    await testCircuitBreakerHalfOpen();

  } catch (error) {
    console.error('\n❌ Test suite error:', error);
  }

  // Final cleanup
  await cleanupTestData();

  const totalDuration = Date.now() - startTime;

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

  if (failed > 0) {
    console.log('\n  Failed tests:');
    testResults.filter(r => !r.passed).forEach(r => {
      console.log(`    - ${r.name}: ${r.error || 'assertion failed'}`);
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
