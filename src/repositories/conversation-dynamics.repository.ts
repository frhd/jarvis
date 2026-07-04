import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { conversationDynamics } from '../db/schema.js';
import { BaseRepository } from './base.repository.js';

export type ConversationDynamicsRow = typeof conversationDynamics.$inferSelect;
export type ConversationDynamicsInsert = typeof conversationDynamics.$inferInsert;

export class ConversationDynamicsRepository extends BaseRepository<
  ConversationDynamicsRow,
  ConversationDynamicsInsert,
  typeof conversationDynamics
> {
  protected table = conversationDynamics;

  /**
   * Find the dynamics record for a conversation.
   */
  async findByConversationId(conversationId: string): Promise<ConversationDynamicsRow | null> {
    const result = await db
      .select()
      .from(this.table)
      .where(eq(this.table.conversationId, conversationId))
      .limit(1);

    return (result[0] as ConversationDynamicsRow) ?? null;
  }

  /**
   * Create or update dynamics for a conversation.
   * Uses find-then-update pattern since conversationId has no unique constraint.
   */
  async upsert(data: ConversationDynamicsInsert): Promise<void> {
    const existing = await this.findByConversationId(data.conversationId);
    if (existing) {
      await this.update(existing.id, data);
    } else {
      const { id: _id, ...rest } = data;
      await this.create(rest as Omit<ConversationDynamicsInsert, 'id'>);
    }
  }
}

export const conversationDynamicsRepository = new ConversationDynamicsRepository();
