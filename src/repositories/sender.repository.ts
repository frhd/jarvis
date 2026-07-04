import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { senders } from '../db/schema';
import { Sender, NewSender } from '../types';
import { BaseRepository } from './base.repository';
import { ISenderRepository } from '../interfaces/repositories';

export class SenderRepository
  extends BaseRepository<Sender, NewSender, typeof senders>
  implements ISenderRepository
{
  protected table = senders;

  async findByTelegramId(telegramId: string): Promise<Sender | null> {
    return this.findOneWhere(eq(this.table.telegramId, telegramId));
  }

  async upsert(data: Omit<NewSender, 'id'>): Promise<Sender> {
    const existing = await this.findByTelegramId(data.telegramId);
    const now = new Date();

    if (existing) {
      const updated = await db
        .update(senders)
        .set({
          firstName: data.firstName ?? existing.firstName,
          lastName: data.lastName ?? existing.lastName,
          username: data.username ?? existing.username,
          phone: data.phone ?? existing.phone,
          displayName: data.displayName ?? existing.displayName,
          updatedAt: now,
        })
        .where(eq(senders.id, existing.id))
        .returning();

      return updated[0];
    }

    return this.create(data);
  }

  /**
   * Update displayName for a sender
   * Used when user explicitly provides their name
   */
  async updateDisplayName(senderId: string, displayName: string): Promise<Sender | null> {
    const now = new Date();
    const updated = await db
      .update(senders)
      .set({ displayName, updatedAt: now })
      .where(eq(senders.id, senderId))
      .returning();

    return updated[0] ?? null;
  }
}

