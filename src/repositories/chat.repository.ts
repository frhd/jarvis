import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { chats } from '../db/schema';
import { Chat, NewChat } from '../types';
import { BaseRepository } from './base.repository';
import { IChatRepository } from '../interfaces/repositories';

export class ChatRepository
  extends BaseRepository<Chat, NewChat, typeof chats>
  implements IChatRepository
{
  protected table = chats;

  async findByTelegramId(telegramId: string): Promise<Chat | null> {
    return this.findOneWhere(eq(this.table.telegramId, telegramId));
  }

  async upsert(data: Omit<NewChat, 'id'>): Promise<Chat> {
    const existing = await this.findByTelegramId(data.telegramId);
    const now = new Date();

    if (existing) {
      const updated = await db
        .update(chats)
        .set({
          type: data.type,
          title: data.title ?? existing.title,
          username: data.username ?? existing.username,
          preferredLanguage: (data as any).preferredLanguage ?? existing.preferredLanguage,
          updatedAt: now,
        })
        .where(eq(chats.id, existing.id))
        .returning();

      return updated[0];
    }

    return this.create(data);
  }

  /**
   * Update chat's preferred language
   */
  async updatePreferredLanguage(chatId: string, language: string): Promise<Chat | null> {
    const updated = await db
      .update(chats)
      .set({
        preferredLanguage: language,
        updatedAt: new Date(),
      })
      .where(eq(chats.id, chatId))
      .returning();

    return updated[0] || null;
  }
}

// Singleton instance
export const chatRepository = new ChatRepository();
