import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { therapistModeConfig } from '../db/schema.js';
import { BaseRepository } from './base.repository.js';

export type TherapistModeConfigRow = typeof therapistModeConfig.$inferSelect;
export type TherapistModeConfigInsert = typeof therapistModeConfig.$inferInsert;

export class TherapistModeRepository extends BaseRepository<
  TherapistModeConfigRow,
  TherapistModeConfigInsert,
  typeof therapistModeConfig
> {
  protected table = therapistModeConfig;

  /**
   * Find therapist mode config by conversation ID.
   */
  async findByConversationId(conversationId: string): Promise<TherapistModeConfigRow | null> {
    const result = await db
      .select()
      .from(this.table)
      .where(eq(this.table.conversationId, conversationId))
      .limit(1);

    return result[0] ?? null;
  }

  /**
   * Upsert therapist mode config for a conversation.
   * Finds existing record and updates it, or creates a new one.
   */
  async upsert(data: TherapistModeConfigInsert): Promise<void> {
    const existing = await this.findByConversationId(data.conversationId);
    if (existing) {
      const { id: _id, ...rest } = data;
      await this.update(existing.id, rest);
    } else {
      const { id: _id, ...rest } = data;
      await this.create(rest);
    }
  }

  /**
   * Enable or disable therapist mode for a conversation.
   */
  async setEnabled(conversationId: string, enabled: boolean): Promise<void> {
    const existing = await this.findByConversationId(conversationId);
    if (existing) {
      await this.update(existing.id, { enabled });
    }
  }

  /**
   * Update intervention tracking fields for a conversation.
   */
  async updateIntervention(params: {
    conversationId: string;
    lastInterventionAt: Date;
    interventionsCount: number;
  }): Promise<void> {
    const { conversationId, lastInterventionAt, interventionsCount } = params;
    const existing = await this.findByConversationId(conversationId);
    if (existing) {
      await this.update(existing.id, { lastInterventionAt, interventionsCount });
    }
  }
}

export const therapistModeRepository = new TherapistModeRepository();
