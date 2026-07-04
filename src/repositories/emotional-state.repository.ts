/**
 * EmotionalStateRepository - Manages dyad emotional state records per user per conversation.
 *
 * Supports find-by-conversation-and-user and upsert (find-then-update-or-create) operations.
 */

import { eq, and } from 'drizzle-orm';
import { db } from '../db/client.js';
import { dyadEmotionalStates } from '../db/schema.js';
import { BaseRepository } from './base.repository.js';

export type DyadEmotionalStateRow = typeof dyadEmotionalStates.$inferSelect;
export type DyadEmotionalStateInsert = typeof dyadEmotionalStates.$inferInsert;

export class EmotionalStateRepository extends BaseRepository<
  DyadEmotionalStateRow,
  DyadEmotionalStateInsert,
  typeof dyadEmotionalStates
> {
  protected table = dyadEmotionalStates;

  /**
   * Find the emotional state record for a specific user in a specific conversation.
   *
   * @param conversationId - The unified conversation ID
   * @param userId - The unified user ID
   * @returns The emotional state row or null if not found
   */
  async findByConversationAndUser(
    conversationId: string,
    userId: string
  ): Promise<DyadEmotionalStateRow | null> {
    const result = await db
      .select()
      .from(this.table)
      .where(
        and(
          eq(this.table.conversationId, conversationId),
          eq(this.table.userId, userId)
        )
      )
      .limit(1);

    return (result[0] as DyadEmotionalStateRow) ?? null;
  }

  /**
   * Upsert an emotional state record.
   * If a record already exists for the given conversationId+userId, updates it.
   * Otherwise, creates a new record.
   *
   * @param data - The emotional state data to insert or update
   */
  async upsert(data: DyadEmotionalStateInsert): Promise<void> {
    const existing = await this.findByConversationAndUser(
      data.conversationId,
      data.userId
    );

    if (existing) {
      const { id: _id, ...updateData } = data;
      await this.update(existing.id, updateData);
    } else {
      const { id: _id, ...createData } = data;
      await this.create(createData);
    }
  }
}
