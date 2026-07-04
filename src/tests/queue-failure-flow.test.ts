/**
 * Queue Failure Flow Integration Test
 *
 * This test validates the complete queue failure flow including:
 * - Retry strategy with exponential backoff
 * - Circuit breaker state transitions
 * - Dead letter queue routing
 * - Priority escalation
 *
 * Run with: npx tsx src/tests/queue-failure-flow.test.ts
 */

import { QueueRepository } from '../repositories/queue.repository';
import { DeadLetterQueueRepository } from '../repositories/deadLetterQueue.repository';
import { CircuitBreakerRepository } from '../repositories/circuitBreaker.repository';
import { RetryStrategyService } from '../services/retryStrategy.service';
import { CircuitBreakerService, CircuitOpenError } from '../services/circuitBreaker.service';
import { DeadLetterQueueService } from '../services/deadLetterQueue.service';
import { PriorityEscalationService } from '../services/priorityEscalation.service';
import { MessageRepository } from '../repositories/message.repository';
import { QueueCleanupWorker } from '../workers/queueCleanup.worker';
import { DLQReason, DEFAULT_PRIORITY_CONFIG, DEFAULT_RETRY_CONFIG } from '../types/queue.types';
import { logger } from '../utils/logger';
import { nanoid } from 'nanoid';

// Test tracking
let testsPassed = 0;
let testsFailed = 0;

function logPass(testName: string, details?: Record<string, unknown>) {
  testsPassed++;
  logger.info(`[Test] ✓ ${testName}`, details || {});
}

function logFail(testName: string, error: unknown) {
  testsFailed++;
  logger.error(`[Test] ✗ ${testName}`, {
    error: error instanceof Error ? error.message : String(error),
  });
}

async function testRetryStrategy() {
  logger.info('[Test] === Testing Retry Strategy ===');

  try {
    const retryService = new RetryStrategyService({
      maxAttempts: 5,
      baseDelayMs: 100,
      maxDelayMs: 5000,
      backoffMultiplier: 2,
      jitterFactor: 0.1,
    });

    // Test 1: Calculate exponential backoff
    const delay1 = retryService.calculateNextRetryDelay(1);
    const delay2 = retryService.calculateNextRetryDelay(2);
    const delay3 = retryService.calculateNextRetryDelay(3);

    if (delay2 > delay1 && delay3 > delay2) {
      logPass('Exponential backoff increases with attempts', {
        delay1,
        delay2,
        delay3,
      });
    } else {
      throw new Error('Delays not increasing exponentially');
    }

    // Test 2: Max delay cap
    const maxDelay = retryService.calculateNextRetryDelay(10);
    if (maxDelay <= 5000 * 1.1) {
      // Allow 10% jitter
      logPass('Max delay cap respected', { maxDelay });
    } else {
      throw new Error(`Max delay exceeded: ${maxDelay}`);
    }

    // Test 3: Should retry logic
    if (retryService.shouldRetry(3)) {
      logPass('Should retry for attempt < max');
    } else {
      throw new Error('Should have allowed retry');
    }

    if (!retryService.shouldRetry(5)) {
      logPass('Should not retry when max attempts reached');
    } else {
      throw new Error('Should have blocked retry at max attempts');
    }

    // Test 4: Non-retryable errors
    const validationError = new Error('VALIDATION_ERROR: Invalid input');
    if (!retryService.shouldRetry(1, validationError)) {
      logPass('Non-retryable error detected');
    } else {
      throw new Error('Should have blocked retry for validation error');
    }

    // Test 5: Retry budget
    const budget = retryService.getRetryBudgetRemaining(3);
    if (budget === 2) {
      logPass('Retry budget calculated correctly', { budget });
    } else {
      throw new Error(`Wrong retry budget: ${budget}`);
    }

  } catch (error) {
    logFail('Retry Strategy', error);
  }
}

async function testCircuitBreaker() {
  logger.info('[Test] === Testing Circuit Breaker ===');

  try {
    const cbRepo = new CircuitBreakerRepository();
    const cb = new CircuitBreakerService('test-service', {
      failureThreshold: 3,
      resetTimeoutMs: 100, // Short for testing
      halfOpenRequests: 2,
    }, cbRepo);

    await cb.initialize();

    // Test 1: Starts in CLOSED state
    if (cb.getState() === 'CLOSED') {
      logPass('Circuit breaker starts CLOSED');
    } else {
      throw new Error(`Wrong initial state: ${cb.getState()}`);
    }

    // Test 2: Execute success
    const result = await cb.execute(async () => 'success');
    if (result === 'success') {
      logPass('Successful execution works');
    } else {
      throw new Error('Execution failed');
    }

    // Test 3: Record failures until OPEN
    for (let i = 0; i < 3; i++) {
      try {
        await cb.execute(async () => {
          throw new Error('Test failure');
        });
      } catch {
        // Expected
      }
    }

    if (cb.getState() === 'OPEN') {
      logPass('Circuit opens after failure threshold', {
        failureThreshold: 3,
        state: cb.getState(),
      });
    } else {
      throw new Error(`Expected OPEN state, got: ${cb.getState()}`);
    }

    // Test 4: Reject calls when OPEN
    try {
      await cb.execute(async () => 'should not run');
      throw new Error('Should have thrown CircuitOpenError');
    } catch (error) {
      if (error instanceof CircuitOpenError) {
        logPass('Calls rejected when circuit is OPEN');
      } else {
        throw error;
      }
    }

    // Test 5: Reset
    await cb.reset();
    if (cb.getState() === 'CLOSED') {
      logPass('Manual reset works');
    } else {
      throw new Error('Reset failed');
    }

    // Cleanup
    await cbRepo.delete('test-service');

  } catch (error) {
    logFail('Circuit Breaker', error);
  }
}

async function testQueueWithRetry() {
  logger.info('[Test] === Testing Queue with Retry Scheduling ===');

  try {
    const queueRepo = new QueueRepository();

    // Create a test message ID
    const testMessageId = `test-msg-${nanoid()}`;

    // Test 1: Enqueue item
    const queueItem = await queueRepo.enqueue(testMessageId, 0);
    if (queueItem.id && queueItem.status === 'pending') {
      logPass('Item enqueued successfully', {
        id: queueItem.id,
        status: queueItem.status,
      });
    } else {
      throw new Error('Enqueue failed');
    }

    // Test 2: Schedule retry with nextRetryAt
    const nextRetry = new Date(Date.now() + 5000);
    await queueRepo.scheduleRetry(queueItem.id, nextRetry, 'Test error');
    const updated = await queueRepo.getById(queueItem.id);

    if (updated?.nextRetryAt && updated.lastError === 'Test error') {
      logPass('Retry scheduled with nextRetryAt', {
        nextRetryAt: updated.nextRetryAt,
        lastError: updated.lastError,
      });
    } else {
      throw new Error('Schedule retry failed');
    }

    // Test 3: getReadyForRetry (should not include item with future nextRetryAt)
    const readyItems = await queueRepo.getReadyForRetry();
    const itemInReady = readyItems.find(item => item.id === queueItem.id);
    if (!itemInReady) {
      logPass('Item with future nextRetryAt not in ready list');
    } else {
      throw new Error('Item should not be ready yet');
    }

    // Test 4: Update attempts with error
    const newAttempts = await queueRepo.updateAttemptsWithError(queueItem.id, 'New error');
    if (newAttempts === 1) {
      logPass('Attempts incremented', { newAttempts });
    } else {
      throw new Error(`Wrong attempt count: ${newAttempts}`);
    }

    // Cleanup: mark as completed
    await queueRepo.markCompleted(queueItem.id);

  } catch (error) {
    logFail('Queue with Retry', error);
  }
}

async function testDeadLetterQueueFlow() {
  logger.info('[Test] === Testing Dead Letter Queue Flow ===');

  try {
    const dlqRepo = new DeadLetterQueueRepository();
    const queueRepo = new QueueRepository();
    const dlqService = new DeadLetterQueueService(dlqRepo, queueRepo);

    // Test 1: Add item directly to DLQ
    const errorHistory = [
      { timestamp: new Date(), error: 'Error 1', attempt: 1 },
      { timestamp: new Date(), error: 'Error 2', attempt: 2 },
      { timestamp: new Date(), error: 'Error 3', attempt: 3 },
    ];

    const dlqItem = await dlqRepo.add({
      originalQueueId: `test-queue-${nanoid()}`,
      messageId: `test-msg-${nanoid()}`,
      reason: DLQReason.MAX_RETRIES_EXCEEDED,
      errorHistory,
      attempts: 3,
      metadata: { testField: 'test' },
    });

    if (dlqItem.id && dlqItem.errorHistory.length === 3) {
      logPass('Item added to DLQ', {
        id: dlqItem.id,
        errorCount: dlqItem.errorHistory.length,
      });
    } else {
      throw new Error('DLQ add failed');
    }

    // Test 2: Get stats
    const stats = await dlqService.getStats();
    if (stats.total >= 1 && stats.byReason[DLQReason.MAX_RETRIES_EXCEEDED] >= 1) {
      logPass('DLQ stats retrieved', {
        total: stats.total,
        byReason: stats.byReason,
      });
    } else {
      throw new Error('Stats incorrect');
    }

    // Test 3: Get by reason
    const itemsByReason = await dlqRepo.getByReason(DLQReason.MAX_RETRIES_EXCEEDED);
    if (itemsByReason.length >= 1) {
      logPass('Items retrieved by reason', { count: itemsByReason.length });
    } else {
      throw new Error('Get by reason failed');
    }

    // Test 4: Inspect item
    const inspected = await dlqService.inspectItem(dlqItem.id);
    if (inspected?.id === dlqItem.id) {
      logPass('Item inspection works');
    } else {
      throw new Error('Inspect failed');
    }

    // Test 5: Remove item
    const removed = await dlqRepo.remove(dlqItem.id);
    if (removed) {
      logPass('Item removed from DLQ');
    } else {
      throw new Error('Remove failed');
    }

  } catch (error) {
    logFail('Dead Letter Queue Flow', error);
  }
}

async function testPriorityEscalation() {
  logger.info('[Test] === Testing Priority Escalation ===');

  try {
    const queueRepo = new QueueRepository();
    const messageRepo = new MessageRepository();

    const escalationService = new PriorityEscalationService(
      queueRepo,
      messageRepo,
      {
        ...DEFAULT_PRIORITY_CONFIG,
        escalationRules: [
          { ageThresholdMs: 100, priorityBoost: 1, maxPriority: 10 }, // 100ms for testing
        ],
      }
    );

    // Create a test queue item
    const testMessageId = `test-msg-${nanoid()}`;
    const queueItem = await queueRepo.enqueue(testMessageId, 0);

    // Wait for it to become stale
    await new Promise(resolve => setTimeout(resolve, 200));

    // Test 1: Escalate stale items
    const escalatedCount = await escalationService.escalateStaleItems();
    if (escalatedCount >= 0) {
      logPass('Escalation ran successfully', { escalatedCount });
    } else {
      throw new Error('Escalation failed');
    }

    // Test 2: Manual priority override
    await escalationService.manualPriorityOverride(queueItem.id, 10);
    const updated = await queueRepo.getById(queueItem.id);

    if (updated?.priority === 10) {
      logPass('Manual priority override works', { priority: updated.priority });
    } else {
      throw new Error('Priority override failed');
    }

    // Cleanup
    await queueRepo.markCompleted(queueItem.id);

  } catch (error) {
    logFail('Priority Escalation', error);
  }
}

async function testStuckMessageDetection() {
  logger.info('[Test] === Testing Stuck Message Detection ===');

  try {
    const queueRepo = new QueueRepository();

    // Create a test message with a fake message ID (we need to simulate a stuck processing message)
    const testMessageId = `test-stuck-msg-${nanoid()}`;

    // Test 1: Enqueue and mark as processing
    const queueItem = await queueRepo.enqueue(testMessageId, 0);
    await queueRepo.markProcessing(queueItem.id);

    const processingItem = await queueRepo.getById(queueItem.id);
    if (processingItem?.status === 'processing') {
      logPass('Item marked as processing', { id: queueItem.id, status: processingItem.status });
    } else {
      throw new Error(`Expected processing status, got: ${processingItem?.status}`);
    }

    // Test 2: Create a cleanup worker with a very short stuck threshold (1ms for testing)
    const cleanupWorker = new QueueCleanupWorker(queueRepo, 7, 1); // 1ms threshold

    // Wait a tiny bit to ensure the message is "stuck"
    await new Promise(resolve => setTimeout(resolve, 10));

    // Test 3: Detect and fail stuck messages
    const stuckCount = await cleanupWorker.detectAndFailStuckMessages();
    if (stuckCount >= 1) {
      logPass('Stuck message detected and failed', { stuckCount });
    } else {
      throw new Error(`Expected at least 1 stuck message, got: ${stuckCount}`);
    }

    // Test 4: Verify the message is now failed
    const failedItem = await queueRepo.getById(queueItem.id);
    if (failedItem?.status === 'failed' && failedItem.lastError?.includes('Stuck message')) {
      logPass('Stuck message marked as failed with correct error', {
        status: failedItem.status,
        lastError: failedItem.lastError?.substring(0, 50) + '...',
      });
    } else {
      throw new Error(`Expected failed status with stuck error, got: ${failedItem?.status}, ${failedItem?.lastError}`);
    }

    // Test 5: Repository methods - getStuckProcessingMessages
    // Create another stuck message to test the repository method directly
    const testMessageId2 = `test-stuck-msg-2-${nanoid()}`;
    const queueItem2 = await queueRepo.enqueue(testMessageId2, 0);
    await queueRepo.markProcessing(queueItem2.id);

    await new Promise(resolve => setTimeout(resolve, 10));

    const stuckMessages = await queueRepo.getStuckProcessingMessages(1); // 1ms threshold
    if (stuckMessages.length >= 1) {
      logPass('Repository getStuckProcessingMessages works', { count: stuckMessages.length });
    } else {
      throw new Error('Expected stuck messages from repository');
    }

    // Cleanup: mark as failed
    await queueRepo.markFailed(queueItem2.id, 'Test cleanup');

  } catch (error) {
    logFail('Stuck Message Detection', error);
  }
}

async function testStuckMessageRecoveryForRetry() {
  logger.info('[Test] === Testing Stuck Message Recovery for Retry ===');

  try {
    const queueRepo = new QueueRepository();

    // Create a test message to simulate stuck processing
    const testMessageId = `test-recovery-${nanoid()}`;

    // Test 1: Enqueue and mark as processing (simulating stuck state)
    const queueItem = await queueRepo.enqueue(testMessageId, 5);
    await queueRepo.markProcessing(queueItem.id);

    const processingItem = await queueRepo.getById(queueItem.id);
    if (processingItem?.status === 'processing') {
      logPass('Recovery: Item marked as processing', { id: queueItem.id });
    } else {
      throw new Error(`Expected processing status, got: ${processingItem?.status}`);
    }

    // Wait a tiny bit to simulate stuck time
    await new Promise(resolve => setTimeout(resolve, 10));

    // Test 2: Get stuck messages for retry (with attempts < max)
    const stuckForRetry = await queueRepo.getStuckMessagesForRetry(1, 3); // 1ms threshold, max 3 retries
    const foundItem = stuckForRetry.find(item => item.id === queueItem.id);
    if (foundItem) {
      logPass('Recovery: Stuck message found for retry', {
        id: foundItem.id,
        attempts: foundItem.attempts
      });
    } else {
      throw new Error('Stuck message not found for retry');
    }

    // Test 3: Reset stuck message for retry
    const nextRetryAt = new Date(Date.now() + 1000);
    const newAttempts = await queueRepo.resetStuckForRetry(
      queueItem.id,
      nextRetryAt,
      'Recovered from stuck state for testing'
    );

    if (newAttempts === 1) {
      logPass('Recovery: Attempts incremented correctly', { newAttempts });
    } else {
      throw new Error(`Expected 1 attempt, got: ${newAttempts}`);
    }

    // Test 4: Verify the message is now pending (not processing)
    const recoveredItem = await queueRepo.getById(queueItem.id);
    if (recoveredItem?.status === 'pending' &&
        recoveredItem.nextRetryAt &&
        recoveredItem.lastError?.includes('Recovered')) {
      logPass('Recovery: Message status reset to pending with retry scheduled', {
        status: recoveredItem.status,
        nextRetryAt: recoveredItem.nextRetryAt,
        lastError: recoveredItem.lastError?.substring(0, 40) + '...',
      });
    } else {
      throw new Error(`Expected pending status, got: ${recoveredItem?.status}`);
    }

    // Test 5: Simulate multiple recovery attempts - should eventually fail
    // Reset to processing again and set attempts = 2
    await queueRepo.markProcessing(queueItem.id);
    await queueRepo.resetStuckForRetry(queueItem.id, nextRetryAt, 'Recovery attempt 2');
    await queueRepo.markProcessing(queueItem.id);
    await queueRepo.resetStuckForRetry(queueItem.id, nextRetryAt, 'Recovery attempt 3');

    const highAttemptItem = await queueRepo.getById(queueItem.id);
    if (highAttemptItem?.attempts === 3) {
      logPass('Recovery: Attempt count tracks multiple recoveries', {
        attempts: highAttemptItem.attempts,
      });
    } else {
      throw new Error(`Expected 3 attempts, got: ${highAttemptItem?.attempts}`);
    }

    // Test 6: Message with high attempts should NOT be in getStuckMessagesForRetry (max=3)
    await queueRepo.markProcessing(queueItem.id);
    await new Promise(resolve => setTimeout(resolve, 10));

    const stuckButExceeded = await queueRepo.getStuckMessagesForRetry(1, 3);
    const shouldNotFind = stuckButExceeded.find(item => item.id === queueItem.id);
    if (!shouldNotFind) {
      logPass('Recovery: Message exceeding max retries excluded from recovery');
    } else {
      throw new Error('Message with max attempts should not be in recovery list');
    }

    // Cleanup
    await queueRepo.markFailed(queueItem.id, 'Test cleanup - exceeded max retries');

  } catch (error) {
    logFail('Stuck Message Recovery for Retry', error);
  }
}

async function testGracefulShutdownQueueReset() {
  logger.info('[Test] === Testing Graceful Shutdown Queue Reset ===');

  try {
    const queueRepo = new QueueRepository();

    // Create multiple test messages in processing state to simulate in-flight messages
    const testMessages = [
      `test-shutdown-1-${nanoid()}`,
      `test-shutdown-2-${nanoid()}`,
      `test-shutdown-3-${nanoid()}`,
    ];

    const queueItems = [];
    for (const msgId of testMessages) {
      const item = await queueRepo.enqueue(msgId, 0);
      await queueRepo.markProcessing(item.id);
      queueItems.push(item);
    }

    // Test 1: Verify all items are in processing
    const processingBefore = await queueRepo.getProcessingMessages();
    const ourProcessing = processingBefore.filter(p =>
      queueItems.some(q => q.id === p.id)
    );

    if (ourProcessing.length === 3) {
      logPass('Shutdown: All test messages in processing state', { count: ourProcessing.length });
    } else {
      throw new Error(`Expected 3 processing, got: ${ourProcessing.length}`);
    }

    // Test 2: Simulate graceful shutdown - reset all processing to pending
    const resetCount = await queueRepo.resetAllProcessingForShutdown();
    if (resetCount >= 3) {
      logPass('Shutdown: Reset processing messages for shutdown', { resetCount });
    } else {
      throw new Error(`Expected at least 3 reset, got: ${resetCount}`);
    }

    // Test 3: Verify all items are now pending with correct metadata
    for (const item of queueItems) {
      const updated = await queueRepo.getById(item.id);
      if (updated?.status !== 'pending') {
        throw new Error(`Expected pending status, got: ${updated?.status}`);
      }
      if (!updated.lastError?.includes('shutdown')) {
        throw new Error(`Expected shutdown error message, got: ${updated.lastError}`);
      }
      if (!updated.nextRetryAt) {
        throw new Error('Expected nextRetryAt to be set for immediate retry');
      }
    }
    logPass('Shutdown: All messages reset to pending with correct metadata');

    // Test 4: Verify messages are ready for immediate retry after restart
    const readyForRetry = await queueRepo.getReadyForRetry();
    const ourReady = readyForRetry.filter(r =>
      queueItems.some(q => q.id === r.id)
    );

    if (ourReady.length === 3) {
      logPass('Shutdown: All messages ready for immediate retry on restart', { count: ourReady.length });
    } else {
      throw new Error(`Expected 3 ready for retry, got: ${ourReady.length}`);
    }

    // Cleanup
    for (const item of queueItems) {
      await queueRepo.markCompleted(item.id);
    }

  } catch (error) {
    logFail('Graceful Shutdown Queue Reset', error);
  }
}

async function runAllTests() {
  logger.info('[Test] ========================================');
  logger.info('[Test] Queue Failure Flow Integration Tests');
  logger.info('[Test] ========================================');

  await testRetryStrategy();
  await testCircuitBreaker();
  await testQueueWithRetry();
  await testDeadLetterQueueFlow();
  await testPriorityEscalation();
  await testStuckMessageDetection();
  await testStuckMessageRecoveryForRetry();
  await testGracefulShutdownQueueReset();

  logger.info('[Test] ========================================');
  logger.info(`[Test] Results: ${testsPassed} passed, ${testsFailed} failed`);
  logger.info('[Test] ========================================');

  if (testsFailed > 0) {
    process.exit(1);
  }
}

// Run tests
runAllTests()
  .then(() => {
    logger.info('[Test] Test suite completed');
    process.exit(0);
  })
  .catch((error) => {
    logger.error('[Test] Test suite crashed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    process.exit(1);
  });
