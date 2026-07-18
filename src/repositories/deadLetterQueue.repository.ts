import { eq, sql, desc, lt, notInArray } from 'drizzle-orm';
import { db } from '../db/client';
import { deadLetterQueue } from '../db/schema';
import { ErrorRecord, DeadLetterItem, NewDeadLetterItem } from '../types';
import { BaseRepository } from './base.repository.js';
import { createLogger } from '../utils/logger.js';

export interface AddDeadLetterItemInput {
  originalQueueId: string;
  messageId: string;
  reason: string;
  errorHistory: ErrorRecord[];
  attempts?: number;
  metadata?: Record<string, unknown> | null;
  lastAttemptAt?: Date;
  createdAt?: Date;
}

export interface DeadLetterItemParsed {
  id: string;
  originalQueueId: string;
  messageId: string;
  reason: string;
  errorHistory: ErrorRecord[];
  attempts: number;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  lastAttemptAt: Date | null;
}

const logger = createLogger('DLQRepository');

export class DeadLetterQueueRepository extends BaseRepository<
  DeadLetterItem,
  NewDeadLetterItem,
  typeof deadLetterQueue
> {
  protected table = deadLetterQueue;

  /**
   * Add an item to the dead letter queue
   */
  async add(item: AddDeadLetterItemInput): Promise<DeadLetterItemParsed> {
    const id = this.generateId();
    const now = new Date();

    const inserted = await db
      .insert(this.table)
      .values({
        id,
        originalQueueId: item.originalQueueId,
        messageId: item.messageId,
        reason: item.reason,
        errorHistory: JSON.stringify(item.errorHistory),
        attempts: item.attempts ?? 0,
        metadata: item.metadata ? JSON.stringify(item.metadata) : null,
        createdAt: item.createdAt ?? now,
        lastAttemptAt: item.lastAttemptAt ?? now,
      })
      .returning();

    return this.parseItem(inserted[0]);
  }

  /**
   * Get a dead letter item by ID
   */
  async getById(id: string): Promise<DeadLetterItemParsed | null> {
    const result = await this.findById(id);
    return result ? this.parseItem(result) : null;
  }

  /**
   * Get a dead letter item by message ID
   */
  async getByMessageId(messageId: string): Promise<DeadLetterItemParsed | null> {
    const result = await this.findOneWhere(eq(this.table.messageId, messageId));
    return result ? this.parseItem(result) : null;
  }

  /**
   * Get all dead letter items with optional pagination
   */
  async getAll(options?: { limit?: number; offset?: number }): Promise<DeadLetterItemParsed[]> {
    const results = await this.findMany(options);
    return results.map((item) => this.parseItem(item));
  }

  /**
   * Get dead letter items by reason
   */
  async getByReason(reason: string): Promise<DeadLetterItemParsed[]> {
    const results = await db
      .select()
      .from(this.table)
      .where(eq(this.table.reason, reason))
      .orderBy(desc(this.table.createdAt));

    return results.map((item) => this.parseItem(item));
  }

  /**
   * Remove an item from the dead letter queue
   */
  async remove(id: string): Promise<boolean> {
    return this.delete(id);
  }

  /**
   * Update the attempts count for a dead letter item
   */
  async updateAttempts(id: string, attempts: number): Promise<void> {
    await this.update(id, {
      attempts,
      lastAttemptAt: new Date(),
    });
  }

  /**
   * Get statistics about the dead letter queue
   */
  async getStats(): Promise<{ total: number; byReason: Record<string, number> }> {
    // Get total count using inherited method
    const total = await this.count();

    // Get count by reason
    const reasonResults = await db
      .select({
        reason: this.table.reason,
        count: sql<number>`count(*)`,
      })
      .from(this.table)
      .groupBy(this.table.reason);

    const byReason: Record<string, number> = {};
    for (const row of reasonResults) {
      byReason[row.reason] = Number(row.count);
    }

    return { total, byReason };
  }

  /**
   * Get items older than a specified age (in milliseconds)
   */
  async getOlderThan(ageMs: number): Promise<DeadLetterItemParsed[]> {
    const cutoffTime = new Date(Date.now() - ageMs);

    const results = await db
      .select()
      .from(this.table)
      .where(lt(this.table.createdAt, cutoffTime))
      .orderBy(desc(this.table.createdAt));

    return results.map((item) => this.parseItem(item));
  }

  /**
   * Purge items older than a specified age (in milliseconds)
   * Returns the number of items deleted
   */
  async purgeOlderThan(ageMs: number): Promise<number> {
    const cutoffTime = new Date(Date.now() - ageMs);

    const result = await db
      .delete(this.table)
      .where(lt(this.table.createdAt, cutoffTime))
      .returning();

    return result.length;
  }

  /**
   * Trim the dead letter queue to a maximum number of entries.
   *
   * Keeps the newest `maxEntries` items (by createdAt) and deletes the
   * oldest ones beyond the cap. This bounds DLQ growth when a systematic
   * failure floods it faster than age-based retention can reclaim.
   *
   * Returns the number of items deleted (0 if the cap is not exceeded).
   */
  async trimToMaxEntries(maxEntries: number): Promise<number> {
    if (maxEntries < 0) {
      return 0;
    }

    // Subquery selecting the ids of the newest `maxEntries` items to keep.
    const keepIds = db
      .select({ id: this.table.id })
      .from(this.table)
      .orderBy(desc(this.table.createdAt))
      .limit(maxEntries);

    const result = await db
      .delete(this.table)
      .where(notInArray(this.table.id, keepIds))
      .returning();

    return result.length;
  }

  /**
   * Parse a raw dead letter item from the database
   * Handles JSON parsing of errorHistory and metadata
   */
  private parseItem(raw: DeadLetterItem): DeadLetterItemParsed {
    let errorHistory: ErrorRecord[] = [];
    let metadata: Record<string, unknown> | null = null;

    // Safely parse errorHistory
    if (raw.errorHistory) {
      try {
        const parsed = JSON.parse(raw.errorHistory);
        errorHistory = Array.isArray(parsed) ? parsed : [];
      } catch (error) {
        logger.error('Failed to parse errorHistory', error);
        errorHistory = [];
      }
    }

    // Safely parse metadata
    if (raw.metadata) {
      try {
        const parsed = JSON.parse(raw.metadata);
        metadata = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
      } catch (error) {
        logger.error('Failed to parse metadata', error);
        metadata = null;
      }
    }

    return {
      id: raw.id,
      originalQueueId: raw.originalQueueId,
      messageId: raw.messageId,
      reason: raw.reason,
      errorHistory,
      attempts: raw.attempts,
      metadata,
      createdAt: raw.createdAt,
      lastAttemptAt: raw.lastAttemptAt,
    };
  }
}
