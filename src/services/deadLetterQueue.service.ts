import {
  DeadLetterQueueRepository,
  DeadLetterItemParsed,
} from '../repositories/deadLetterQueue.repository';
import { QueueRepository } from '../repositories/queue.repository';
import { MessageRepository } from '../repositories/message.repository';
import { ChatRepository } from '../repositories/chat.repository';
import { ErrorRecord, DLQStats, Message, Chat } from '../types';
import { logger } from '../utils/logger';

/**
 * Maximum number of entries the dead letter queue is allowed to retain.
 *
 * Age-based retention alone cannot bound the DLQ when a systematic failure
 * floods it with fresh entries faster than the retention window expires.
 * This size cap guarantees an upper bound: when exceeded, the OLDEST entries
 * beyond the cap are trimmed, keeping the newest `DLQ_MAX_ENTRIES`.
 */
export const DLQ_MAX_ENTRIES = 10_000;

/**
 * How often the opportunistic on-insert trim actually runs, expressed as
 * "trim after every Nth insert". Running the (relatively expensive) trim on
 * every insert would be wasteful, so it is sampled. The periodic cleanup
 * worker remains the authoritative enforcement path.
 */
export const DLQ_TRIM_INSERT_SAMPLE_INTERVAL = 100;

export class DeadLetterQueueService {
  /** Counts inserts since the last opportunistic trim (see sample interval). */
  private insertsSinceLastTrim = 0;
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

      // Opportunistically enforce the size cap. Sampled so we don't run the
      // trim on every insert, and best-effort so a trim failure never blocks
      // moving the item to the DLQ.
      this.insertsSinceLastTrim++;
      if (this.insertsSinceLastTrim >= DLQ_TRIM_INSERT_SAMPLE_INTERVAL) {
        this.insertsSinceLastTrim = 0;
        try {
          await this.trimToMaxSize();
        } catch (trimError) {
          logger.warn('[DLQ] Opportunistic trim failed after insert', {
            error: trimError instanceof Error ? trimError.message : 'Unknown error',
          });
        }
      }

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
   * Enforce the DLQ size cap by trimming the oldest entries beyond the cap.
   *
   * Keeps the newest `maxEntries` items and deletes the rest. Returns the
   * number of items trimmed (0 when the queue is within the cap).
   */
  async trimToMaxSize(maxEntries: number = DLQ_MAX_ENTRIES): Promise<number> {
    const trimmedCount = await this.dlqRepository.trimToMaxEntries(maxEntries);

    if (trimmedCount > 0) {
      logger.info('[DLQ] Trimmed dead letter items over size cap', {
        maxEntries,
        trimmedCount,
      });
    }

    return trimmedCount;
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
