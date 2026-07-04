import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { chatFilters } from '../db/schema';
import { ChatFilter, NewChatFilter, FilterType } from '../types';
import { BaseRepository } from './base.repository';

export class ChatFilterRepository extends BaseRepository<
  ChatFilter,
  NewChatFilter,
  typeof chatFilters
> {
  protected table = chatFilters;

  async findByTelegramChatId(telegramChatId: string): Promise<ChatFilter | null> {
    return this.findOneWhere(eq(this.table.telegramChatId, telegramChatId));
  }

  async getAllFilters(): Promise<ChatFilter[]> {
    return this.findMany({ limit: 1000 });
  }

  async addFilter(
    telegramChatId: string,
    type: FilterType,
    priority: number = 0
  ): Promise<ChatFilter> {
    const existing = await this.findByTelegramChatId(telegramChatId);

    if (existing) {
      const updated = await db
        .update(chatFilters)
        .set({
          filterType: type,
          priority,
        })
        .where(eq(chatFilters.id, existing.id))
        .returning();

      return updated[0];
    }

    return this.create({
      telegramChatId,
      filterType: type,
      priority,
    });
  }

  async removeFilter(telegramChatId: string): Promise<void> {
    await db
      .delete(chatFilters)
      .where(eq(chatFilters.telegramChatId, telegramChatId));
  }

  async isAllowed(telegramChatId: string): Promise<{ allowed: boolean; priority: number }> {
    const filter = await this.findByTelegramChatId(telegramChatId);

    if (!filter) {
      return { allowed: true, priority: 0 };
    }

    return {
      allowed: filter.filterType === 'allow',
      priority: filter.priority,
    };
  }
}
