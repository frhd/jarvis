/**
 * Joke History Repository
 *
 * Manages joke history for anti-repetition tracking.
 * Provides methods to query recent jokes, check for duplicates, and get user statistics.
 */

import { eq, and, desc, sql, inArray } from 'drizzle-orm';
import { createHash } from 'crypto';
import { db } from '../db/client.js';
import { jokeHistory } from '../db/schema.js';
import { BaseRepository } from './base.repository.js';
import type {
  JokeHistoryRecord,
  NewJokeHistoryRecord,
  JokeStyle,
  JokeCategory,
  UserReaction,
  JokeStats,
} from '../types/index.js';

/**
 * Normalizes joke content for consistent hashing
 */
function normalizeJokeContent(content: string): string {
  return content
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')      // Collapse whitespace
    .replace(/[^\w\s]/g, '');   // Remove punctuation
}

/**
 * Generates SHA-256 hash of joke content for deduplication
 */
export function hashJokeContent(content: string): string {
  const normalized = normalizeJokeContent(content);
  return createHash('sha256').update(normalized).digest('hex');
}

export class JokeHistoryRepository extends BaseRepository<
  JokeHistoryRecord,
  NewJokeHistoryRecord,
  typeof jokeHistory
> {
  protected table = jokeHistory;

  /**
   * Create a new joke history entry with automatic hash generation
   */
  async createEntry(data: {
    senderId: string | null;
    chatId: string;
    jokeContent: string;
    style: JokeStyle;
    categoryId: string;
    userReaction?: UserReaction | null;
  }): Promise<JokeHistoryRecord> {
    const id = this.generateId();
    const jokeHash = hashJokeContent(data.jokeContent);
    const now = new Date();

    const inserted = await db
      .insert(this.table)
      .values({
        id,
        senderId: data.senderId,
        chatId: data.chatId,
        jokeContent: data.jokeContent,
        jokeHash,
        style: data.style,
        categoryId: data.categoryId,
        userReaction: data.userReaction ?? null,
        createdAt: now,
      })
      .returning();

    return inserted[0];
  }

  /**
   * Find recent jokes for a specific sender (for anti-repetition)
   */
  async findRecentBySender(
    senderId: string | null,
    limit = 50
  ): Promise<JokeHistoryRecord[]> {
    if (!senderId) {
      return [];
    }

    return db
      .select()
      .from(this.table)
      .where(eq(this.table.senderId, senderId))
      .orderBy(desc(this.table.createdAt))
      .limit(limit);
  }

  /**
   * Find recent jokes for a specific chat
   */
  async findRecentByChat(
    chatId: string,
    limit = 50
  ): Promise<JokeHistoryRecord[]> {
    return db
      .select()
      .from(this.table)
      .where(eq(this.table.chatId, chatId))
      .orderBy(desc(this.table.createdAt))
      .limit(limit);
  }

  /**
   * Check if a joke hash already exists for a sender
   */
  async hashExistsForSender(
    senderId: string | null,
    jokeHash: string
  ): Promise<boolean> {
    if (!senderId) {
      return false;
    }

    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(this.table)
      .where(
        and(
          eq(this.table.senderId, senderId),
          eq(this.table.jokeHash, jokeHash)
        )
      );

    return (result[0]?.count ?? 0) > 0;
  }

  /**
   * Check if multiple joke hashes exist for a sender (batch check)
   */
  async hashesExistForSender(
    senderId: string | null,
    jokeHashes: string[]
  ): Promise<Set<string>> {
    if (!senderId || jokeHashes.length === 0) {
      return new Set();
    }

    const results = await db
      .select({ jokeHash: this.table.jokeHash })
      .from(this.table)
      .where(
        and(
          eq(this.table.senderId, senderId),
          inArray(this.table.jokeHash, jokeHashes)
        )
      );

    return new Set(results.map((r) => r.jokeHash));
  }

  /**
   * Get all unique joke hashes for a sender (for exclusion list)
   */
  async getJokeHashesForSender(
    senderId: string | null,
    limit = 100
  ): Promise<string[]> {
    if (!senderId) {
      return [];
    }

    const results = await db
      .select({ jokeHash: this.table.jokeHash })
      .from(this.table)
      .where(eq(this.table.senderId, senderId))
      .orderBy(desc(this.table.createdAt))
      .limit(limit);

    return results.map((r) => r.jokeHash);
  }

  /**
   * Update user reaction for a joke
   */
  async updateReaction(
    jokeId: string,
    reaction: UserReaction
  ): Promise<JokeHistoryRecord | null> {
    const updated = await db
      .update(this.table)
      .set({ userReaction: reaction })
      .where(eq(this.table.id, jokeId))
      .returning();

    return updated[0] ?? null;
  }

  /**
   * Get joke statistics for a user
   */
  async getStats(senderId: string | null): Promise<JokeStats> {
    const emptyStats: JokeStats = {
      totalJokes: 0,
      jokesByStyle: {
        dad_joke: 0,
        punny: 0,
        clever: 0,
        one_liner: 0,
        absurdist: 0,
        story: 0,
        mixed: 0,
      },
      jokesByCategory: {
        general: 0,
        tech: 0,
        science: 0,
        wordplay: 0,
      },
      reactionsByType: {
        laughed: 0,
        groaned: 0,
        meh: 0,
        requested_more: 0,
      },
      lastJokeAt: null,
      favoriteStyle: null,
      favoriteCategory: null,
    };

    if (!senderId) {
      return emptyStats;
    }

    // Get total count
    const totalResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(this.table)
      .where(eq(this.table.senderId, senderId));

    const totalJokes = totalResult[0]?.count ?? 0;

    if (totalJokes === 0) {
      return emptyStats;
    }

    // Get jokes by style
    const styleResults = await db
      .select({
        style: this.table.style,
        count: sql<number>`count(*)`,
      })
      .from(this.table)
      .where(eq(this.table.senderId, senderId))
      .groupBy(this.table.style);

    const jokesByStyle = { ...emptyStats.jokesByStyle };
    for (const row of styleResults) {
      if (row.style) {
        jokesByStyle[row.style as JokeStyle] = row.count;
      }
    }

    // Get jokes by category
    const categoryResults = await db
      .select({
        categoryId: this.table.categoryId,
        count: sql<number>`count(*)`,
      })
      .from(this.table)
      .where(eq(this.table.senderId, senderId))
      .groupBy(this.table.categoryId);

    const jokesByCategory = { ...emptyStats.jokesByCategory };
    for (const row of categoryResults) {
      if (row.categoryId && row.categoryId in jokesByCategory) {
        jokesByCategory[row.categoryId as JokeCategory] = row.count;
      }
    }

    // Get reactions by type
    const reactionResults = await db
      .select({
        userReaction: this.table.userReaction,
        count: sql<number>`count(*)`,
      })
      .from(this.table)
      .where(
        and(
          eq(this.table.senderId, senderId),
          sql`${this.table.userReaction} IS NOT NULL`
        )
      )
      .groupBy(this.table.userReaction);

    const reactionsByType = { ...emptyStats.reactionsByType };
    for (const row of reactionResults) {
      if (row.userReaction) {
        reactionsByType[row.userReaction as UserReaction] = row.count;
      }
    }

    // Get last joke date
    const lastJokeResult = await db
      .select({ createdAt: this.table.createdAt })
      .from(this.table)
      .where(eq(this.table.senderId, senderId))
      .orderBy(desc(this.table.createdAt))
      .limit(1);

    const lastJokeAt = lastJokeResult[0]?.createdAt ?? null;

    // Calculate favorite style (style with most positive reactions)
    const positiveReactionStyles = await db
      .select({
        style: this.table.style,
        count: sql<number>`count(*)`,
      })
      .from(this.table)
      .where(
        and(
          eq(this.table.senderId, senderId),
          sql`${this.table.userReaction} IN ('laughed', 'requested_more')`
        )
      )
      .groupBy(this.table.style)
      .orderBy(desc(sql`count(*)`))
      .limit(1);

    const favoriteStyle = (positiveReactionStyles[0]?.style as JokeStyle) ?? null;

    // Calculate favorite category
    const positiveReactionCategories = await db
      .select({
        categoryId: this.table.categoryId,
        count: sql<number>`count(*)`,
      })
      .from(this.table)
      .where(
        and(
          eq(this.table.senderId, senderId),
          sql`${this.table.userReaction} IN ('laughed', 'requested_more')`
        )
      )
      .groupBy(this.table.categoryId)
      .orderBy(desc(sql`count(*)`))
      .limit(1);

    const favoriteCategory = (positiveReactionCategories[0]?.categoryId as JokeCategory) ?? null;

    return {
      totalJokes,
      jokesByStyle,
      jokesByCategory,
      reactionsByType,
      lastJokeAt,
      favoriteStyle,
      favoriteCategory,
    };
  }

  /**
   * Clean up old joke history (data retention)
   */
  async deleteOlderThan(days: number): Promise<number> {
    const cutoffTimestamp = Math.floor(Date.now() / 1000) - days * 24 * 60 * 60;

    const result = await db
      .delete(this.table)
      .where(sql`unixepoch(${this.table.createdAt}) < ${cutoffTimestamp}`)
      .returning();

    return result.length;
  }
}

// Singleton instance
export const jokeHistoryRepository = new JokeHistoryRepository();
