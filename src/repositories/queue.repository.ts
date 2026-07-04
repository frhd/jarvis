import { eq, and, desc, asc, sql, lte, isNull, or } from 'drizzle-orm';
import { db } from '../db/client';
import { queue } from '../db/schema';
import { QueueItem, QueueStatus } from '../types';
import { nanoid } from 'nanoid';

export class QueueRepository {
  /**
   * Enqueue a message for processing.
   * Checks for existing active queue items to prevent duplicates.
   * @param messageId Message ID to enqueue
   * @param priority Priority level (higher = processed first)
   * @returns Queue item if created, or existing active item if duplicate
   */
  async enqueue(messageId: string, priority: number = 0): Promise<QueueItem> {
    // Check for existing active queue item (pending or processing)
    const existing = await this.findActiveByMessageId(messageId);
    if (existing) {
      return existing;
    }

    try {
      const inserted = await db
        .insert(queue)
        .values({
          id: nanoid(),
          messageId,
          status: 'pending',
          priority,
          attempts: 0,
          lastError: null,
          processedAt: null,
          version: 1,
          processingStartedAt: null,
          createdAt: new Date(),
        })
        .returning();

      return inserted[0];
    } catch (error) {
      // Handle race condition - another request may have inserted while we checked
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('UNIQUE constraint failed') || errorMessage.includes('SQLITE_CONSTRAINT')) {
        const existing = await this.findActiveByMessageId(messageId);
        if (existing) {
          return existing;
        }
      }
      throw error;
    }
  }

  /**
   * Find an active (pending or processing) queue item for a message.
   * Used for deduplication checks.
   */
  async findActiveByMessageId(messageId: string): Promise<QueueItem | null> {
    const result = await db
      .select()
      .from(queue)
      .where(
        and(
          eq(queue.messageId, messageId),
          or(
            eq(queue.status, 'pending'),
            eq(queue.status, 'processing')
          )
        )
      )
      .limit(1);

    return result[0] || null;
  }

  async dequeue(): Promise<QueueItem | null> {
    // Get next pending item: highest priority first, then oldest (FIFO within same priority)
    const result = await db
      .select()
      .from(queue)
      .where(eq(queue.status, 'pending'))
      .orderBy(desc(queue.priority), asc(queue.createdAt))
      .limit(1);

    return result[0] || null;
  }

  /**
   * Mark a queue item as processing with optimistic locking.
   * Uses version field to prevent race conditions.
   * @param id Queue item ID
   * @param expectedVersion Expected version for optimistic lock (optional, uses current if not provided)
   * @returns true if successfully marked, false if version mismatch (someone else took it)
   */
  async markProcessing(id: string, expectedVersion?: number): Promise<boolean> {
    // If no expected version, get current version first
    if (expectedVersion === undefined) {
      const current = await this.getById(id);
      if (!current) return false;
      expectedVersion = current.version;
    }

    const result = await db
      .update(queue)
      .set({
        status: 'processing',
        version: expectedVersion + 1,
        processingStartedAt: new Date(),
      })
      .where(
        and(
          eq(queue.id, id),
          eq(queue.version, expectedVersion),
          eq(queue.status, 'pending')
        )
      )
      .returning({ id: queue.id });

    return result.length > 0;
  }

  /**
   * Atomic dequeue: get next item and mark as processing in one operation.
   * Uses optimistic locking to prevent race conditions.
   * @returns Queue item if successfully dequeued, null if queue empty or lost race
   */
  async dequeueAtomic(): Promise<QueueItem | null> {
    // Get next pending item
    const item = await this.dequeue();
    if (!item) return null;

    // Try to mark as processing with optimistic lock
    const success = await this.markProcessing(item.id, item.version);
    if (!success) {
      // Lost race to another consumer, try again recursively
      return this.dequeueAtomic();
    }

    // Re-fetch to get updated item with new version
    return this.getById(item.id);
  }

  async markCompleted(id: string): Promise<void> {
    await db
      .update(queue)
      .set({
        status: 'completed',
        processedAt: new Date(),
      })
      .where(eq(queue.id, id));
  }

  async markFailed(id: string, error: string): Promise<void> {
    await db
      .update(queue)
      .set({
        status: 'failed',
        lastError: error,
        processedAt: new Date(),
      })
      .where(eq(queue.id, id));
  }

  async incrementAttempts(id: string): Promise<number> {
    const item = await db
      .select()
      .from(queue)
      .where(eq(queue.id, id))
      .limit(1);

    if (!item[0]) {
      throw new Error(`Queue item ${id} not found`);
    }

    const newAttempts = item[0].attempts + 1;

    await db
      .update(queue)
      .set({ attempts: newAttempts })
      .where(eq(queue.id, id));

    return newAttempts;
  }

  async getPendingRetries(): Promise<QueueItem[]> {
    // Get items that failed previously (attempts > 0) but are pending for retry
    return await db
      .select()
      .from(queue)
      .where(
        and(
          eq(queue.status, 'pending'),
          sql`${queue.attempts} > 0`
        )
      )
      .orderBy(desc(queue.priority), asc(queue.createdAt));
  }

  async getStats(): Promise<{
    pending: number;
    processing: number;
    completed: number;
    failed: number;
  }> {
    const results = await db
      .select({
        status: queue.status,
        count: sql<number>`count(*)`,
      })
      .from(queue)
      .groupBy(queue.status);

    const stats = {
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
    };

    for (const row of results) {
      if (row.status in stats) {
        stats[row.status as QueueStatus] = Number(row.count);
      }
    }

    return stats;
  }

  async updatePriority(
    id: string,
    priority: number,
    boostApplied: number,
    originalPriority?: number
  ): Promise<void> {
    const updateData: {
      priority: number;
      priorityBoostApplied: boolean;
      originalPriority?: number;
    } = {
      priority,
      priorityBoostApplied: boostApplied > 0,
    };

    // Only set originalPriority if provided and not already set
    if (originalPriority !== undefined) {
      updateData.originalPriority = originalPriority;
    }

    await db
      .update(queue)
      .set(updateData)
      .where(eq(queue.id, id));
  }

  async getStaleItems(olderThanMs: number): Promise<QueueItem[]> {
    const cutoffTime = new Date(Date.now() - olderThanMs);

    return await db
      .select()
      .from(queue)
      .where(
        and(
          eq(queue.status, 'pending'),
          sql`${queue.createdAt} < ${cutoffTime.getTime() / 1000}`
        )
      )
      .orderBy(asc(queue.createdAt));
  }

  async getById(id: string): Promise<QueueItem | null> {
    const result = await db
      .select()
      .from(queue)
      .where(eq(queue.id, id))
      .limit(1);

    return result[0] || null;
  }

  /**
   * Schedule a retry for a queue item
   * Sets status back to pending and sets the nextRetryAt time
   */
  async scheduleRetry(id: string, nextRetryAt: Date, error: string): Promise<void> {
    await db
      .update(queue)
      .set({
        status: 'pending',
        nextRetryAt,
        lastError: error,
      })
      .where(eq(queue.id, id));
  }

  /**
   * Get items that are ready for retry (nextRetryAt is in the past or null for new items)
   * Only returns pending items
   */
  async getReadyForRetry(): Promise<QueueItem[]> {
    const now = new Date();

    return await db
      .select()
      .from(queue)
      .where(
        and(
          eq(queue.status, 'pending'),
          or(
            isNull(queue.nextRetryAt),
            lte(queue.nextRetryAt, now)
          )
        )
      )
      .orderBy(desc(queue.priority), asc(queue.createdAt));
  }

  async updateAttemptsWithError(id: string, error: string): Promise<number> {
    const item = await db
      .select()
      .from(queue)
      .where(eq(queue.id, id))
      .limit(1);

    if (!item[0]) {
      throw new Error(`Queue item ${id} not found`);
    }

    const newAttempts = item[0].attempts + 1;

    await db
      .update(queue)
      .set({
        attempts: newAttempts,
        lastError: error,
      })
      .where(eq(queue.id, id));

    return newAttempts;
  }

  /**
   * Purge old completed and failed queue entries
   * @param retentionMs Retention period in milliseconds
   * @returns Number of deleted entries
   */
  async purgeOldEntries(retentionMs: number): Promise<number> {
    const cutoffTime = new Date(Date.now() - retentionMs);

    const result = await db
      .delete(queue)
      .where(
        and(
          or(
            eq(queue.status, 'completed'),
            eq(queue.status, 'failed')
          ),
          lte(queue.processedAt, cutoffTime)
        )
      )
      .returning({ id: queue.id });

    return result.length;
  }

  /**
   * Get stuck messages in 'processing' status that have been there too long
   * These are messages that crashed/timed out mid-processing
   * @param thresholdMs Time in milliseconds after which a processing message is considered stuck
   * @returns Array of stuck queue items
   */
  async getStuckProcessingMessages(thresholdMs: number): Promise<QueueItem[]> {
    const cutoffTime = new Date(Date.now() - thresholdMs);

    return await db
      .select()
      .from(queue)
      .where(
        and(
          eq(queue.status, 'processing'),
          lte(queue.createdAt, cutoffTime)
        )
      )
      .orderBy(asc(queue.createdAt));
  }

  /**
   * Mark multiple messages as failed in a batch operation
   * @param ids Array of queue item IDs to mark as failed
   * @param error Error message to set
   * @returns Number of items updated
   */
  async batchMarkFailed(ids: string[], error: string): Promise<number> {
    if (ids.length === 0) return 0;

    let updatedCount = 0;
    for (const id of ids) {
      await db
        .update(queue)
        .set({
          status: 'failed',
          lastError: error,
          processedAt: new Date(),
        })
        .where(eq(queue.id, id));
      updatedCount++;
    }

    return updatedCount;
  }

  /**
   * Reset a stuck message for retry
   * Changes status from 'processing' to 'pending', increments attempts, and schedules next retry
   * @param id Queue item ID
   * @param nextRetryAt Scheduled retry time
   * @param error Error message explaining the recovery
   * @returns New attempt count
   */
  async resetStuckForRetry(id: string, nextRetryAt: Date, error: string): Promise<number> {
    const item = await db
      .select()
      .from(queue)
      .where(eq(queue.id, id))
      .limit(1);

    if (!item[0]) {
      throw new Error(`Queue item ${id} not found`);
    }

    const newAttempts = item[0].attempts + 1;

    await db
      .update(queue)
      .set({
        status: 'pending',
        attempts: newAttempts,
        nextRetryAt,
        lastError: error,
      })
      .where(eq(queue.id, id));

    return newAttempts;
  }

  /**
   * Get stuck messages that are eligible for recovery by RetryWorker
   * These are messages in 'processing' status older than threshold, with attempts below max
   * @param thresholdMs Time in milliseconds after which a processing message is considered stuck
   * @param maxAttempts Maximum attempts before a stuck message should fail (not retry)
   * @returns Array of stuck queue items eligible for retry
   */
  async getStuckMessagesForRetry(thresholdMs: number, maxAttempts: number): Promise<QueueItem[]> {
    const cutoffTime = new Date(Date.now() - thresholdMs);

    return await db
      .select()
      .from(queue)
      .where(
        and(
          eq(queue.status, 'processing'),
          lte(queue.createdAt, cutoffTime),
          sql`${queue.attempts} < ${maxAttempts}`
        )
      )
      .orderBy(asc(queue.createdAt));
  }

  /**
   * Reset all processing messages to pending during shutdown
   * This prevents messages from being stuck after a clean shutdown
   * @returns Number of messages reset
   */
  async resetAllProcessingForShutdown(): Promise<number> {
    const processingMessages = await db
      .select()
      .from(queue)
      .where(eq(queue.status, 'processing'));

    if (processingMessages.length === 0) {
      return 0;
    }

    // Reset each message to pending with nextRetryAt = now for immediate retry on restart
    const now = new Date();
    for (const msg of processingMessages) {
      await db
        .update(queue)
        .set({
          status: 'pending',
          nextRetryAt: now,
          lastError: 'Interrupted by graceful shutdown',
        })
        .where(eq(queue.id, msg.id));
    }

    return processingMessages.length;
  }

  async getProcessingMessages(): Promise<QueueItem[]> {
    return await db
      .select()
      .from(queue)
      .where(eq(queue.status, 'processing'));
  }

  /**
   * Get detailed stuck message statistics for monitoring
   * Returns count and age distribution of stuck messages
   * @param thresholdMs Time in milliseconds after which a processing message is considered stuck
   * @returns Stuck message statistics with count, oldest age, and age distribution
   */
  async getStuckMessageStats(thresholdMs: number): Promise<{
    count: number;
    oldestAgeMinutes: number;
    ageDistribution: { ageMinutes: number; count: number }[];
    byPriority: { priority: number; count: number }[];
  }> {
    const cutoffTime = new Date(Date.now() - thresholdMs);
    const now = Date.now();

    const stuckMessages = await db
      .select()
      .from(queue)
      .where(
        and(
          eq(queue.status, 'processing'),
          lte(queue.createdAt, cutoffTime)
        )
      )
      .orderBy(asc(queue.createdAt));

    if (stuckMessages.length === 0) {
      return {
        count: 0,
        oldestAgeMinutes: 0,
        ageDistribution: [],
        byPriority: [],
      };
    }

    // Calculate age distribution in minute buckets
    const ageBuckets: Record<number, number> = {};
    const priorityBuckets: Record<number, number> = {};

    let oldestAgeMs = 0;
    for (const msg of stuckMessages) {
      const ageMs = now - msg.createdAt.getTime();
      oldestAgeMs = Math.max(oldestAgeMs, ageMs);

      // Bucket by 15-minute intervals
      const ageMinutes = Math.floor(ageMs / 60000);
      const bucket = Math.floor(ageMinutes / 15) * 15;
      ageBuckets[bucket] = (ageBuckets[bucket] || 0) + 1;

      // Bucket by priority
      const priority = msg.priority;
      priorityBuckets[priority] = (priorityBuckets[priority] || 0) + 1;
    }

    return {
      count: stuckMessages.length,
      oldestAgeMinutes: Math.round(oldestAgeMs / 60000),
      ageDistribution: Object.entries(ageBuckets)
        .map(([ageMinutes, count]) => ({ ageMinutes: Number(ageMinutes), count }))
        .sort((a, b) => a.ageMinutes - b.ageMinutes),
      byPriority: Object.entries(priorityBuckets)
        .map(([priority, count]) => ({ priority: Number(priority), count }))
        .sort((a, b) => b.priority - a.priority),
    };
  }
}
