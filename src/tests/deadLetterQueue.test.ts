/**
 * Dead Letter Queue Test
 *
 * This is a simple validation script to test the DLQ repository and service.
 * Run with: npx tsx src/tests/deadLetterQueue.test.ts
 */

import { DeadLetterQueueRepository } from '../repositories/deadLetterQueue.repository';
import { QueueRepository } from '../repositories/queue.repository';
import { MessageRepository } from '../repositories/message.repository';
import { ChatRepository } from '../repositories/chat.repository';
import { DeadLetterQueueService } from '../services/deadLetterQueue.service';
import { DLQReason, ErrorRecord } from '../types';
import { logger } from '../utils/logger';

async function testDeadLetterQueue() {
  logger.info('[Test] Starting Dead Letter Queue tests');

  try {
    // Initialize repositories
    const dlqRepository = new DeadLetterQueueRepository();
    const queueRepository = new QueueRepository();
    const messageRepository = new MessageRepository();
    const chatRepository = new ChatRepository();

    // Initialize service
    const dlqService = new DeadLetterQueueService(
      dlqRepository,
      queueRepository,
      messageRepository,
      chatRepository
    );

    logger.info('[Test] ✓ Repositories and service initialized');

    // Test 1: Add item to DLQ
    logger.info('[Test] Test 1: Adding item to DLQ');
    const errorHistory: ErrorRecord[] = [
      {
        timestamp: new Date(),
        error: 'Test error 1',
        attempt: 1,
      },
      {
        timestamp: new Date(),
        error: 'Test error 2',
        attempt: 2,
      },
    ];

    const dlqItem = await dlqRepository.add({
      originalQueueId: 'test-queue-id-1',
      messageId: 'test-message-id-1',
      reason: DLQReason.MAX_RETRIES_EXCEEDED,
      errorHistory,
      attempts: 5,
      metadata: {
        testField: 'test value',
        priority: 1,
      },
    });

    logger.info('[Test] ✓ Item added to DLQ', {
      id: dlqItem.id,
      reason: dlqItem.reason,
      errorCount: dlqItem.errorHistory.length,
    });

    // Test 2: Get item by ID
    logger.info('[Test] Test 2: Getting item by ID');
    const retrieved = await dlqRepository.getById(dlqItem.id);

    if (retrieved && retrieved.id === dlqItem.id) {
      logger.info('[Test] ✓ Item retrieved successfully', {
        id: retrieved.id,
        errorHistory: retrieved.errorHistory,
      });
    } else {
      throw new Error('Failed to retrieve item');
    }

    // Test 3: Get stats
    logger.info('[Test] Test 3: Getting DLQ stats');
    const stats = await dlqService.getStats();
    logger.info('[Test] ✓ Stats retrieved', {
      total: stats.total,
      byReason: stats.byReason,
      recentFailures: stats.recentFailures,
    });

    // Test 4: Get by reason
    logger.info('[Test] Test 4: Getting items by reason');
    const itemsByReason = await dlqRepository.getByReason(DLQReason.MAX_RETRIES_EXCEEDED);
    logger.info('[Test] ✓ Items by reason retrieved', {
      count: itemsByReason.length,
      reason: DLQReason.MAX_RETRIES_EXCEEDED,
    });

    // Test 5: Get all items
    logger.info('[Test] Test 5: Getting all items');
    const allItems = await dlqRepository.getAll({ limit: 10 });
    logger.info('[Test] ✓ All items retrieved', {
      count: allItems.length,
    });

    // Test 6: Update attempts
    logger.info('[Test] Test 6: Updating attempts');
    await dlqRepository.updateAttempts(dlqItem.id, 6);
    const updated = await dlqRepository.getById(dlqItem.id);
    if (updated && updated.attempts === 6) {
      logger.info('[Test] ✓ Attempts updated successfully', {
        attempts: updated.attempts,
      });
    } else {
      throw new Error('Failed to update attempts');
    }

    // Test 7: Inspect item (without actual message/chat for now)
    logger.info('[Test] Test 7: Inspecting item');
    const inspected = await dlqService.inspectItem(dlqItem.id);
    if (inspected) {
      logger.info('[Test] ✓ Item inspected', {
        id: inspected.id,
        hasMessage: !!inspected.message,
        hasChat: !!inspected.chat,
      });
    } else {
      throw new Error('Failed to inspect item');
    }

    // Test 8: Remove item
    logger.info('[Test] Test 8: Removing item');
    const removed = await dlqRepository.remove(dlqItem.id);
    if (removed) {
      logger.info('[Test] ✓ Item removed successfully');
    } else {
      throw new Error('Failed to remove item');
    }

    // Verify removal
    const shouldBeNull = await dlqRepository.getById(dlqItem.id);
    if (!shouldBeNull) {
      logger.info('[Test] ✓ Removal verified');
    } else {
      throw new Error('Item still exists after removal');
    }

    logger.info('[Test] ========================================');
    logger.info('[Test] ✓ All tests passed!');
    logger.info('[Test] ========================================');
  } catch (error) {
    logger.error('[Test] ✗ Test failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });
    process.exit(1);
  }
}

// Run tests
testDeadLetterQueue()
  .then(() => {
    logger.info('[Test] Test suite completed');
    process.exit(0);
  })
  .catch((error) => {
    logger.error('[Test] Test suite failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    process.exit(1);
  });
