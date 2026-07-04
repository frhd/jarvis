import { eq, and, desc, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { memories } from '../db/schema.js';
import { BaseRepository } from './base.repository.js';
import type { IMemoryRepository } from '../interfaces/repositories.js';
import type { Memory, NewMemory } from '../types/index.js';

// Re-export types for backward compatibility
export type { Memory, NewMemory };

export class MemoryRepository extends BaseRepository<Memory, NewMemory, typeof memories> implements IMemoryRepository {
  protected table = memories;

  /**
   * Find memories by type
   */
  async findByType(
    memoryType: 'fact' | 'preference' | 'event' | 'relationship',
    limit: number = 50
  ): Promise<Memory[]> {
    return await db
      .select()
      .from(memories)
      .where(eq(memories.memoryType, memoryType))
      .orderBy(desc(memories.lastAccessedAt), desc(memories.createdAt))
      .limit(limit);
  }

  /**
   * Find memories for a unified user
   */
  async findByUserId(userId: string, limit: number = 50): Promise<Memory[]> {
    return await db
      .select()
      .from(memories)
      .where(eq(memories.userId, userId))
      .orderBy(desc(memories.lastAccessedAt), desc(memories.createdAt))
      .limit(limit);
  }

  /**
   * Find memories for a unified conversation
   */
  async findByConversationId(conversationId: string, limit: number = 50): Promise<Memory[]> {
    return await db
      .select()
      .from(memories)
      .where(eq(memories.conversationId, conversationId))
      .orderBy(desc(memories.lastAccessedAt), desc(memories.createdAt))
      .limit(limit);
  }

  /**
   * Find active (non-archived) memories for a unified user
   */
  async findActiveForUser(userId: string, limit: number = 50): Promise<Memory[]> {
    return await db
      .select()
      .from(memories)
      .where(
        and(
          eq(memories.userId, userId),
          eq(memories.isArchived, false)
        )
      )
      .orderBy(desc(memories.lastAccessedAt), desc(memories.createdAt))
      .limit(limit);
  }

  /**
   * Find memories scoped to both user and conversation
   */
  async findByUserAndConversation(userId: string, conversationId: string, limit: number = 50): Promise<Memory[]> {
    return await db
      .select()
      .from(memories)
      .where(
        and(
          eq(memories.userId, userId),
          eq(memories.conversationId, conversationId)
        )
      )
      .orderBy(desc(memories.lastAccessedAt), desc(memories.createdAt))
      .limit(limit);
  }

  // ===========================================
  // Legacy methods for backward compatibility
  // These are used by consolidation and data privacy services
  // ===========================================

  /**
   * @internal Legacy method - use findByUserId instead
   */
  async findBySenderId(senderId: string, limit: number = 50): Promise<Memory[]> {
    return await db
      .select()
      .from(memories)
      .where(eq(memories.senderId, senderId))
      .orderBy(desc(memories.lastAccessedAt), desc(memories.createdAt))
      .limit(limit);
  }

  /**
   * @internal Legacy method - use findByConversationId instead
   */
  async findByChatId(chatId: string, limit: number = 50): Promise<Memory[]> {
    return await db
      .select()
      .from(memories)
      .where(eq(memories.chatId, chatId))
      .orderBy(desc(memories.lastAccessedAt), desc(memories.createdAt))
      .limit(limit);
  }

  /**
   * @internal Legacy method - use findActiveForUser instead
   */
  async findActiveForSender(senderId: string, limit: number = 50): Promise<Memory[]> {
    return await db
      .select()
      .from(memories)
      .where(
        and(
          eq(memories.senderId, senderId),
          eq(memories.isArchived, false)
        )
      )
      .orderBy(desc(memories.lastAccessedAt), desc(memories.createdAt))
      .limit(limit);
  }

  /**
   * Record access (increment accessCount, update lastAccessedAt)
   */
  async recordAccess(id: string): Promise<void> {
    await db
      .update(memories)
      .set({
        accessCount: sql`${memories.accessCount} + 1`,
        lastAccessedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(memories.id, id));
  }

  /**
   * Archive a memory
   * Uses inherited update() which handles updatedAt automatically
   */
  async archive(id: string): Promise<void> {
    await this.update(id, { isArchived: true } as Partial<NewMemory>);
  }

  /**
   * Find all memories (up to limit)
   */
  async findAll(limit: number = 1000): Promise<Memory[]> {
    return await db
      .select()
      .from(memories)
      .orderBy(desc(memories.createdAt))
      .limit(limit);
  }

  /**
   * Bulk archive memories older than date
   */
  async archiveOlderThan(olderThanTimestamp: Date): Promise<number> {
    const result = await db
      .update(memories)
      .set({
        isArchived: true,
        updatedAt: new Date(),
      })
      .where(
        and(
          sql`${memories.createdAt} < ${olderThanTimestamp.getTime() / 1000}`,
          eq(memories.isArchived, false)
        )
      )
      .returning();

    return result.length;
  }

  /**
   * Get total count of memories
   */
  async getCount(): Promise<number> {
    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(memories);
    return result[0]?.count ?? 0;
  }

  /**
   * Get count of active (non-archived) memories
   */
  async getActiveCount(): Promise<number> {
    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(memories)
      .where(eq(memories.isArchived, false));
    return result[0]?.count ?? 0;
  }

  /**
   * Get count of archived memories
   */
  async getArchivedCount(): Promise<number> {
    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(memories)
      .where(eq(memories.isArchived, true));
    return result[0]?.count ?? 0;
  }

  /**
   * Delete archived memories older than specified date
   * Used by memory cleanup worker to prevent unbounded growth
   * @param olderThanDate Delete archived memories older than this date
   * @returns Number of memories deleted
   */
  async deleteArchivedOlderThan(olderThanDate: Date): Promise<number> {
    const result = await db
      .delete(memories)
      .where(
        and(
          eq(memories.isArchived, true),
          sql`${memories.createdAt} < ${olderThanDate.getTime() / 1000}`
        )
      )
      .returning();

    return result.length;
  }

  /**
   * Get statistics about memories for monitoring
   */
  async getStats(): Promise<{
    total: number;
    active: number;
    archived: number;
    oldestAgeDays: number | null;
  }> {
    const total = await this.getCount();
    const active = await this.getActiveCount();
    const archived = await this.getArchivedCount();

    // Get oldest memory
    const oldestResult = await db
      .select({ createdAt: memories.createdAt })
      .from(memories)
      .orderBy(memories.createdAt)
      .limit(1);

    let oldestAgeDays: number | null = null;
    if (oldestResult.length > 0) {
      const ageMs = Date.now() - new Date(oldestResult[0].createdAt).getTime();
      oldestAgeDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));
    }

    return { total, active, archived, oldestAgeDays };
  }

  /**
   * Clean up orphaned user_id references in memories.
   * Sets user_id to NULL for memories that reference non-existent users,
   * allowing them to fall back to legacy senderId/chatId lookups.
   * @returns Number of memories cleaned up
   */
  async cleanupOrphanedUserIds(): Promise<number> {
    const result = await db
      .update(memories)
      .set({ userId: null })
      .where(sql`${memories.userId} IS NOT NULL AND ${memories.userId} NOT IN (SELECT id FROM users)`);

    return result.changes;
  }
}

export const memoryRepository = new MemoryRepository();
