import { eq, and } from 'drizzle-orm';
import { db } from '../db/client.js';
import { userPreferences } from '../db/schema.js';
import { BaseRepository } from './base.repository.js';

export type UserPreference = typeof userPreferences.$inferSelect;
export type NewUserPreference = typeof userPreferences.$inferInsert;

export class UserPreferenceRepository extends BaseRepository<
  UserPreference,
  NewUserPreference,
  typeof userPreferences
> {
  protected table = userPreferences;
  /**
   * Create or update preference (upsert behavior - only update if new confidence >= existing)
   */
  async upsert(
    preference: Omit<NewUserPreference, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<UserPreference> {
    // Check if preference already exists
    const existing = await this.findByKey(
      preference.senderId,
      preference.category,
      preference.key
    );

    if (existing) {
      // Only update if new confidence is >= existing confidence
      const newConfidence = preference.confidence ?? 100;
      if (newConfidence >= existing.confidence) {
        const updated = await db
          .update(userPreferences)
          .set({
            value: preference.value,
            confidence: newConfidence,
            sourceMessageIds: preference.sourceMessageIds ?? existing.sourceMessageIds,
            updatedAt: new Date(),
          })
          .where(eq(userPreferences.id, existing.id))
          .returning();

        return updated[0];
      }
      // Return existing if new confidence is lower
      return existing;
    }

    // Create new preference
    return await this.create({
      senderId: preference.senderId,
      category: preference.category,
      key: preference.key,
      value: preference.value,
      confidence: preference.confidence ?? 100,
      sourceMessageIds: preference.sourceMessageIds ?? null,
    });
  }

  /**
   * Find all preferences for a sender
   */
  async findBySenderId(senderId: string): Promise<UserPreference[]> {
    return await this.findManyWhere(eq(this.table.senderId, senderId));
  }

  /**
   * Find preferences by category
   */
  async findByCategory(
    senderId: string,
    category: 'communication' | 'interests' | 'behavior' | 'context'
  ): Promise<UserPreference[]> {
    return await this.findManyWhere(
      and(
        eq(this.table.senderId, senderId),
        eq(this.table.category, category)
      )!
    );
  }

  /**
   * Find specific preference
   */
  async findByKey(
    senderId: string,
    category: 'communication' | 'interests' | 'behavior' | 'context',
    key: string
  ): Promise<UserPreference | null> {
    return await this.findOneWhere(
      and(
        eq(this.table.senderId, senderId),
        eq(this.table.category, category),
        eq(this.table.key, key)
      )!
    );
  }

  /**
   * Get all preferences as structured object
   * Returns a nested object: { category: { key: value } }
   * Example: { communication: { formality: 'casual', language: 'en' }, interests: { topics: ['tech', 'movies'] } }
   */
  async getPreferencesMap(senderId: string): Promise<Record<string, Record<string, unknown>>> {
    const preferences = await this.findBySenderId(senderId);

    const map: Record<string, Record<string, unknown>> = {};

    for (const pref of preferences) {
      if (!map[pref.category]) {
        map[pref.category] = {};
      }

      try {
        // Parse JSON value
        map[pref.category][pref.key] = JSON.parse(pref.value);
      } catch (error) {
        // If parsing fails, store as string
        map[pref.category][pref.key] = pref.value;
      }
    }

    return map;
  }

  /**
   * Update preference value
   * Note: This is a specialized update that differs from base update
   */
  async updateValue(
    id: string,
    value: string,
    confidence?: number
  ): Promise<UserPreference | null> {
    const updateData: Partial<NewUserPreference> = {
      value,
    };

    if (confidence !== undefined) {
      updateData.confidence = confidence;
    }

    return await this.update(id, updateData);
  }

  /**
   * Delete all preferences for sender
   */
  async deleteBySenderId(senderId: string): Promise<number> {
    const result = await db
      .delete(this.table)
      .where(eq(this.table.senderId, senderId))
      .returning();

    return result.length;
  }
}

export const userPreferenceRepository = new UserPreferenceRepository();
