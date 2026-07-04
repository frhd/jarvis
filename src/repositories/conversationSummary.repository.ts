import { eq, desc } from 'drizzle-orm';
import { db } from '../db/client.js';
import { conversationSummaries } from '../db/schema.js';
import { BaseRepository } from './base.repository.js';

export type ConversationSummary = typeof conversationSummaries.$inferSelect;
export type NewConversationSummary = typeof conversationSummaries.$inferInsert;

export class ConversationSummaryRepository extends BaseRepository<
  ConversationSummary,
  NewConversationSummary,
  typeof conversationSummaries
> {
  protected table = conversationSummaries;

  /**
   * Find summaries for a chat
   */
  async findByChatId(chatId: string, limit: number = 10): Promise<ConversationSummary[]> {
    return await db
      .select()
      .from(this.table)
      .where(eq(this.table.chatId, chatId))
      .orderBy(desc(this.table.createdAt))
      .limit(limit);
  }

  /**
   * Get the most recent summary for a chat
   */
  async findLatestByChatId(chatId: string): Promise<ConversationSummary | null> {
    const result = await db
      .select()
      .from(this.table)
      .where(eq(this.table.chatId, chatId))
      .orderBy(desc(this.table.createdAt))
      .limit(1);

    return result[0] || null;
  }

  /**
   * Delete all summaries for a chat
   */
  async deleteByChatId(chatId: string): Promise<number> {
    const result = await db
      .delete(this.table)
      .where(eq(this.table.chatId, chatId))
      .returning();

    return result.length;
  }
}

export const conversationSummaryRepository = new ConversationSummaryRepository();
