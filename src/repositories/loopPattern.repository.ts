import { eq, and, desc, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '../db/client.js';
import { loopPatterns, loopDetections } from '../db/schema.js';
import { BaseRepository } from './base.repository.js';

export type LoopPattern = typeof loopPatterns.$inferSelect;
export type NewLoopPattern = typeof loopPatterns.$inferInsert;
export type LoopDetection = typeof loopDetections.$inferSelect;
export type NewLoopDetection = typeof loopDetections.$inferInsert;

export class LoopPatternRepository extends BaseRepository<
  LoopPattern,
  NewLoopPattern,
  typeof loopPatterns
> {
  protected table = loopPatterns;
  /**
   * Create a new loop pattern
   */
  async createPattern(pattern: Omit<NewLoopPattern, 'id'>): Promise<LoopPattern> {
    return this.create({
      patternHash: pattern.patternHash,
      pattern: pattern.pattern,
      loopType: pattern.loopType,
      frequency: pattern.frequency ?? 1,
      avgDurationMs: pattern.avgDurationMs,
      avgMessageCount: pattern.avgMessageCount ?? 0,
      resolutionStrategy: pattern.resolutionStrategy,
      confidence: pattern.confidence ?? 0.5,
      metadata: pattern.metadata ?? null,
      lastOccurredAt: pattern.lastOccurredAt ?? new Date(),
      isActive: pattern.isActive ?? true,
    } as Omit<NewLoopPattern, 'id'>);
  }

  /**
   * Find pattern by ID
   */
  async findPatternById(id: string): Promise<LoopPattern | null> {
    return this.findById(id);
  }

  /**
   * Find pattern by hash
   */
  async findPatternByHash(hash: string): Promise<LoopPattern | null> {
    const result = await db
      .select()
      .from(loopPatterns)
      .where(eq(loopPatterns.patternHash, hash))
      .limit(1);

    return result[0] || null;
  }

  /**
   * Find active patterns by type
   */
  async findPatternsByType(
    loopType: LoopPattern['loopType'],
    limit: number = 50
  ): Promise<LoopPattern[]> {
    return await db
      .select()
      .from(loopPatterns)
      .where(
        and(
          eq(loopPatterns.loopType, loopType),
          eq(loopPatterns.isActive, true)
        )
      )
      .orderBy(desc(loopPatterns.frequency))
      .limit(limit);
  }

  /**
   * Get all active patterns
   */
  async findActivePatterns(limit: number = 100): Promise<LoopPattern[]> {
    return await db
      .select()
      .from(loopPatterns)
      .where(eq(loopPatterns.isActive, true))
      .orderBy(desc(loopPatterns.frequency), desc(loopPatterns.lastOccurredAt))
      .limit(limit);
  }

  /**
   * Get top patterns by frequency
   */
  async findTopPatterns(limit: number = 20): Promise<LoopPattern[]> {
    return await db
      .select()
      .from(loopPatterns)
      .where(eq(loopPatterns.isActive, true))
      .orderBy(desc(loopPatterns.frequency))
      .limit(limit);
  }

  /**
   * Update pattern (increment frequency, update avg duration)
   */
  async updatePattern(
    id: string,
    updates: Partial<Omit<LoopPattern, 'id' | 'createdAt'>>
  ): Promise<LoopPattern | null> {
    return this.update(id, updates as Partial<NewLoopPattern>);
  }

  /**
   * Increment pattern frequency
   */
  async incrementFrequency(id: string): Promise<void> {
    await db
      .update(loopPatterns)
      .set({
        frequency: sql`${loopPatterns.frequency} + 1`,
        lastOccurredAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(loopPatterns.id, id));
  }

  /**
   * Update average metrics (duration and message count)
   */
  async updateAverages(
    id: string,
    newDurationMs: number,
    newMessageCount: number
  ): Promise<void> {
    const pattern = await this.findPatternById(id);
    if (!pattern) return;

    // Calculate new averages using incremental mean formula
    const newFrequency = pattern.frequency + 1;
    const newAvgDuration = Math.round(
      (pattern.avgDurationMs * pattern.frequency + newDurationMs) / newFrequency
    );
    const newAvgMessageCount = Math.round(
      (pattern.avgMessageCount * pattern.frequency + newMessageCount) / newFrequency
    );

    await db
      .update(loopPatterns)
      .set({
        frequency: newFrequency,
        avgDurationMs: newAvgDuration,
        avgMessageCount: newAvgMessageCount,
        lastOccurredAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(loopPatterns.id, id));
  }

  /**
   * Deactivate pattern
   */
  async deactivatePattern(id: string): Promise<void> {
    await db
      .update(loopPatterns)
      .set({
        isActive: false,
        updatedAt: new Date(),
      })
      .where(eq(loopPatterns.id, id));
  }

  /**
   * Delete pattern
   */
  async deletePattern(id: string): Promise<boolean> {
    return this.delete(id);
  }

  /**
   * Create a loop detection record
   */
  async createDetection(detection: Omit<NewLoopDetection, 'id'>): Promise<LoopDetection> {
    const inserted = await db
      .insert(loopDetections)
      .values({
        id: nanoid(),
        patternId: detection.patternId,
        chatId: detection.chatId,
        senderId: detection.senderId ?? null,
        messageIds: detection.messageIds,
        messageCount: detection.messageCount,
        durationMs: detection.durationMs,
        wasResolved: detection.wasResolved ?? false,
        resolutionAction: detection.resolutionAction ?? null,
        userFeedback: detection.userFeedback ?? null,
        detectedAt: new Date(),
      })
      .returning();

    return inserted[0];
  }

  /**
   * Find detections by pattern
   */
  async findDetectionsByPattern(
    patternId: string,
    limit: number = 50
  ): Promise<LoopDetection[]> {
    return await db
      .select()
      .from(loopDetections)
      .where(eq(loopDetections.patternId, patternId))
      .orderBy(desc(loopDetections.detectedAt))
      .limit(limit);
  }

  /**
   * Find detections by chat
   */
  async findDetectionsByChat(
    chatId: string,
    limit: number = 50
  ): Promise<LoopDetection[]> {
    return await db
      .select()
      .from(loopDetections)
      .where(eq(loopDetections.chatId, chatId))
      .orderBy(desc(loopDetections.detectedAt))
      .limit(limit);
  }

  /**
   * Find detections by sender
   */
  async findDetectionsBySender(
    senderId: string,
    limit: number = 50
  ): Promise<LoopDetection[]> {
    return await db
      .select()
      .from(loopDetections)
      .where(eq(loopDetections.senderId, senderId))
      .orderBy(desc(loopDetections.detectedAt))
      .limit(limit);
  }

  /**
   * Update detection resolution
   */
  async updateDetectionResolution(
    id: string,
    resolutionAction: string,
    userFeedback?: number
  ): Promise<LoopDetection | null> {
    const updated = await db
      .update(loopDetections)
      .set({
        wasResolved: true,
        resolutionAction,
        userFeedback: userFeedback ?? null,
      })
      .where(eq(loopDetections.id, id))
      .returning();

    return updated[0] || null;
  }

  /**
   * Get statistics for a pattern
   */
  async getPatternStats(patternId: string): Promise<{
    totalDetections: number;
    resolvedCount: number;
    avgResolutionTime: number;
    avgUserFeedback: number;
  }> {
    const detections = await this.findDetectionsByPattern(patternId, 1000);

    const totalDetections = detections.length;
    const resolvedCount = detections.filter((d) => d.wasResolved).length;
    const avgResolutionTime =
      detections.length > 0
        ? Math.round(
            detections.reduce((sum, d) => sum + d.durationMs, 0) / detections.length
          )
        : 0;

    const feedbackDetections = detections.filter((d) => d.userFeedback !== null);
    const avgUserFeedback =
      feedbackDetections.length > 0
        ? feedbackDetections.reduce((sum, d) => sum + (d.userFeedback || 0), 0) /
          feedbackDetections.length
        : 0;

    return {
      totalDetections,
      resolvedCount,
      avgResolutionTime,
      avgUserFeedback,
    };
  }

  /**
   * Get overall loop statistics
   */
  async getOverallStats(): Promise<{
    totalPatterns: number;
    activePatterns: number;
    totalDetections: number;
    resolvedDetections: number;
    topLoopTypes: Array<{ type: string; count: number }>;
  }> {
    const allPatterns = await db.select().from(loopPatterns);
    const activePatterns = allPatterns.filter((p) => p.isActive);
    const allDetections = await db.select().from(loopDetections);
    const resolvedDetections = allDetections.filter((d) => d.wasResolved);

    // Count by loop type
    const typeCounts: Record<string, number> = {};
    for (const pattern of activePatterns) {
      typeCounts[pattern.loopType] = (typeCounts[pattern.loopType] || 0) + pattern.frequency;
    }

    const topLoopTypes = Object.entries(typeCounts)
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count);

    return {
      totalPatterns: allPatterns.length,
      activePatterns: activePatterns.length,
      totalDetections: allDetections.length,
      resolvedDetections: resolvedDetections.length,
      topLoopTypes,
    };
  }
}

export const loopPatternRepository = new LoopPatternRepository();
