import {
  DeadLetterQueueRepository,
  DeadLetterItemParsed,
} from '../repositories/deadLetterQueue.repository';
import { QueueRepository } from '../repositories/queue.repository';
import { MessageRepository } from '../repositories/message.repository';
import { ChatRepository } from '../repositories/chat.repository';
import { ErrorRecord, DLQStats, Message, Chat } from '../types';
import { logger } from '../utils/logger';

export class DeadLetterQueueService {
  constructor(
    private dlqRepository: DeadLetterQueueRepository,
    private queueRepository: QueueRepository,
    private messageRepository?: MessageRepository,
    private chatRepository?: ChatRepository
  ) {}

  /**
   * Move a queue item to the dead letter queue
   * Removes the item from the main queue and adds it to DLQ
   */
  async moveToDeadLetter(
    queueItemId: string,
    reason: string,
    errorHistory: ErrorRecord[]
  ): Promise<DeadLetterItemParsed> {
    try {
      // Get the queue item by ID
      const queueItem = await this.queueRepository.getById(queueItemId);
      if (!queueItem) {
        throw new Error(`Queue item ${queueItemId} not found`);
      }

      logger.info('[DLQ] Moving item to dead letter queue', {
        queueItemId,
        messageId: queueItem.messageId,
        reason,
        attempts: queueItem.attempts,
      });

      // Create the dead letter item
      const dlqItem = await this.dlqRepository.add({
        originalQueueId: queueItemId,
        messageId: queueItem.messageId,
        reason,
        errorHistory,
        attempts: queueItem.attempts,
        metadata: {
          priority: queueItem.priority,
          lastError: queueItem.lastError,
          processedAt: queueItem.processedAt,
        },
        lastAttemptAt: new Date(),
      });

      // Mark the queue item as failed (it will be removed by cleanup jobs)
      await this.queueRepository.markFailed(queueItemId, `Moved to DLQ: ${reason}`);

      logger.info('[DLQ] Item moved to dead letter queue', {
        queueItemId,
        dlqItemId: dlqItem.id,
        messageId: queueItem.messageId,
      });

      return dlqItem;
    } catch (error) {
      logger.error('[DLQ] Failed to move item to dead letter queue', {
        queueItemId,
        reason,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Reprocess a dead letter item
   * Moves the item back to the main queue for retry
   */
  async reprocessItem(dlqItemId: string): Promise<boolean> {
    try {
      const dlqItem = await this.dlqRepository.getById(dlqItemId);

      if (!dlqItem) {
        logger.warn('[DLQ] Dead letter item not found', { dlqItemId });
        return false;
      }

      logger.info('[DLQ] Reprocessing dead letter item', {
        dlqItemId,
        messageId: dlqItem.messageId,
      });

      // Re-enqueue the message with normal priority
      await this.queueRepository.enqueue(dlqItem.messageId, 0);

      // Update attempts counter
      await this.dlqRepository.updateAttempts(dlqItemId, dlqItem.attempts + 1);

      logger.info('[DLQ] Item requeued for processing', {
        dlqItemId,
        messageId: dlqItem.messageId,
      });

      return true;
    } catch (error) {
      logger.error('[DLQ] Failed to reprocess dead letter item', {
        dlqItemId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false;
    }
  }

  /**
   * Reprocess all items in the dead letter queue
   * Returns the number of successfully reprocessed items
   */
  async reprocessAll(): Promise<{ success: number; failed: number }> {
    logger.info('[DLQ] Reprocessing all dead letter items');

    const allItems = await this.dlqRepository.getAll({ limit: 1000 });
    let success = 0;
    let failed = 0;

    for (const item of allItems) {
      const result = await this.reprocessItem(item.id);
      if (result) {
        success++;
      } else {
        failed++;
      }
    }

    logger.info('[DLQ] Reprocessing complete', {
      total: allItems.length,
      success,
      failed,
    });

    return { success, failed };
  }

  /**
   * Inspect a dead letter item with full details including related message and chat
   */
  async inspectItem(dlqItemId: string): Promise<
    | (DeadLetterItemParsed & {
        message?: Message;
        chat?: Chat;
      })
    | null
  > {
    const dlqItem = await this.dlqRepository.getById(dlqItemId);

    if (!dlqItem) {
      return null;
    }

    const result: DeadLetterItemParsed & { message?: Message; chat?: Chat } = {
      ...dlqItem,
    };

    // Fetch related message if repository is available
    if (this.messageRepository) {
      try {
        const message = await this.messageRepository.findById(dlqItem.messageId);
        if (message) {
          result.message = message;

          // Fetch related chat if repository is available
          if (this.chatRepository) {
            try {
              const chat = await this.chatRepository.findById(message.chatId);
              if (chat) {
                result.chat = chat;
              }
            } catch (error) {
              logger.warn('[DLQ] Failed to fetch chat for inspection', {
                dlqItemId,
                chatId: message.chatId,
                error: error instanceof Error ? error.message : 'Unknown error',
              });
            }
          }
        }
      } catch (error) {
        logger.warn('[DLQ] Failed to fetch message for inspection', {
          dlqItemId,
          messageId: dlqItem.messageId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return result;
  }

  /**
   * Get statistics about the dead letter queue
   */
  async getStats(): Promise<DLQStats> {
    const stats = await this.dlqRepository.getStats();

    // Calculate additional metrics
    const allItems = await this.dlqRepository.getAll({ limit: 1000 });

    let oldestItemAge: number | undefined;
    if (allItems.length > 0) {
      const oldestItem = allItems[allItems.length - 1];
      oldestItemAge = Date.now() - oldestItem.createdAt.getTime();
    }

    // Count items from the last hour
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    const recentFailures = allItems.filter(
      (item) => item.createdAt.getTime() > oneHourAgo
    ).length;

    return {
      total: stats.total,
      byReason: stats.byReason,
      oldestItemAge,
      recentFailures,
    };
  }

  /**
   * Purge items older than the specified age
   * Returns the number of items purged
   */
  async purgeOld(maxAgeMs: number): Promise<number> {
    logger.info('[DLQ] Purging old dead letter items', {
      maxAgeMs,
      maxAgeHours: maxAgeMs / (1000 * 60 * 60),
    });

    const purgedCount = await this.dlqRepository.purgeOlderThan(maxAgeMs);

    logger.info('[DLQ] Purge complete', { purgedCount });

    return purgedCount;
  }

  /**
   * Get all items by reason
   */
  async getItemsByReason(reason: string): Promise<DeadLetterItemParsed[]> {
    return this.dlqRepository.getByReason(reason);
  }

  /**
   * Get all items with pagination
   */
  async getAllItems(options?: { limit?: number; offset?: number }): Promise<DeadLetterItemParsed[]> {
    return this.dlqRepository.getAll(options);
  }

  /**
   * Remove an item from the dead letter queue
   */
  async removeItem(dlqItemId: string): Promise<boolean> {
    logger.info('[DLQ] Removing dead letter item', { dlqItemId });

    const removed = await this.dlqRepository.remove(dlqItemId);

    if (removed) {
      logger.info('[DLQ] Item removed', { dlqItemId });
    } else {
      logger.warn('[DLQ] Item not found', { dlqItemId });
    }

    return removed;
  }
}
