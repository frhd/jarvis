import { eq, and, sql, desc, gte, lte, inArray } from 'drizzle-orm';
import { db } from '../db/client';
import {
  experiments,
  experimentVariants,
  experimentAssignments,
  experimentEvents,
} from '../db/schema';
import { nanoid } from 'nanoid';
import type {
  Experiment,
  NewExperiment,
  ExperimentVariant,
  NewExperimentVariant,
  ExperimentAssignment,
  NewExperimentAssignment,
  ExperimentEvent,
  NewExperimentEvent,
  ExperimentStatus,
} from '../types';
import type { ExperimentResult } from '../types/analytics.types';
import { BaseRepository } from './base.repository.js';

export class ExperimentRepository extends BaseRepository<
  Experiment,
  NewExperiment,
  typeof experiments
> {
  protected table = experiments;
  /**
   * Create a new experiment
   */
  async createExperiment(
    experiment: Omit<NewExperiment, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<Experiment> {
    return this.create({
      name: experiment.name,
      description: experiment.description ?? null,
      status: experiment.status ?? 'draft',
      targetMetric: experiment.targetMetric,
      config: experiment.config ?? null,
      startDate: experiment.startDate ?? null,
      endDate: experiment.endDate ?? null,
    } as Omit<NewExperiment, 'id'>);
  }

  /**
   * Create a new variant for an experiment
   */
  async createVariant(
    variant: Omit<NewExperimentVariant, 'id' | 'createdAt'>
  ): Promise<ExperimentVariant> {
    const id = nanoid();

    const inserted = await db
      .insert(experimentVariants)
      .values({
        id,
        experimentId: variant.experimentId,
        name: variant.name,
        weight: variant.weight,
        config: variant.config ?? null,
        createdAt: new Date(),
      })
      .returning();

    return inserted[0];
  }

  /**
   * Create multiple variants for an experiment
   */
  async createVariants(
    variants: Omit<NewExperimentVariant, 'id' | 'createdAt'>[]
  ): Promise<ExperimentVariant[]> {
    if (variants.length === 0) return [];

    const values = variants.map((v) => ({
      id: nanoid(),
      experimentId: v.experimentId,
      name: v.name,
      weight: v.weight,
      config: v.config ?? null,
      createdAt: new Date(),
    }));

    const inserted = await db.insert(experimentVariants).values(values).returning();
    return inserted;
  }

  /**
   * Get experiment by ID
   */
  async getExperiment(id: string): Promise<Experiment | null> {
    return this.findById(id);
  }

  /**
   * Get all experiments
   */
  async getExperiments(status?: ExperimentStatus): Promise<Experiment[]> {
    if (status) {
      return db.select().from(experiments).where(eq(experiments.status, status));
    }
    return db.select().from(experiments);
  }

  /**
   * Get active (running) experiments
   */
  async getActiveExperiments(): Promise<Experiment[]> {
    return db.select().from(experiments).where(eq(experiments.status, 'running'));
  }

  /**
   * Get variants for an experiment
   */
  async getVariants(experimentId: string): Promise<ExperimentVariant[]> {
    return db
      .select()
      .from(experimentVariants)
      .where(eq(experimentVariants.experimentId, experimentId));
  }

  /**
   * Get a specific variant by ID
   */
  async getVariant(variantId: string): Promise<ExperimentVariant | null> {
    const result = await db
      .select()
      .from(experimentVariants)
      .where(eq(experimentVariants.id, variantId))
      .limit(1);

    return result[0] || null;
  }

  /**
   * Assign a user to a variant (weighted random selection)
   * Returns existing assignment if user is already assigned
   */
  async assignUser(experimentId: string, senderId: string): Promise<ExperimentAssignment> {
    // Check for existing assignment
    const existing = await this.getUserAssignment(experimentId, senderId);
    if (existing) {
      return existing;
    }

    // Get all variants for this experiment
    const variants = await this.getVariants(experimentId);
    if (variants.length === 0) {
      throw new Error(`No variants found for experiment ${experimentId}`);
    }

    // Validate weights sum to 100
    const totalWeight = variants.reduce((sum, v) => sum + v.weight, 0);
    if (totalWeight !== 100) {
      throw new Error(
        `Variant weights must sum to 100, got ${totalWeight} for experiment ${experimentId}`
      );
    }

    // Weighted random selection
    const random = Math.random() * 100;
    let cumulativeWeight = 0;
    let selectedVariant: ExperimentVariant | null = null;

    for (const variant of variants) {
      cumulativeWeight += variant.weight;
      if (random < cumulativeWeight) {
        selectedVariant = variant;
        break;
      }
    }

    // Fallback to last variant if rounding issues
    if (!selectedVariant) {
      selectedVariant = variants[variants.length - 1];
    }

    // Create assignment
    const inserted = await db
      .insert(experimentAssignments)
      .values({
        id: nanoid(),
        experimentId,
        senderId,
        variantId: selectedVariant.id,
        assignedAt: new Date(),
      })
      .returning();
    return inserted[0];
  }

  /**
   * Get user's assignment for an experiment
   */
  async getUserAssignment(
    experimentId: string,
    senderId: string
  ): Promise<ExperimentAssignment | null> {
    const result = await db
      .select()
      .from(experimentAssignments)
      .where(
        and(
          eq(experimentAssignments.experimentId, experimentId),
          eq(experimentAssignments.senderId, senderId)
        )
      )
      .limit(1);

    return result[0] || null;
  }

  /**
   * Get all assignments for an experiment
   */
  async getExperimentAssignments(experimentId: string): Promise<ExperimentAssignment[]> {
    return db
      .select()
      .from(experimentAssignments)
      .where(eq(experimentAssignments.experimentId, experimentId));
  }

  /**
   * Record an event for a user in an experiment
   */
  async recordEvent(
    event: Omit<NewExperimentEvent, 'id' | 'createdAt'>
  ): Promise<ExperimentEvent> {
    const id = nanoid();

    const inserted = await db
      .insert(experimentEvents)
      .values({
        id,
        experimentId: event.experimentId,
        variantId: event.variantId,
        senderId: event.senderId,
        eventType: event.eventType,
        value: event.value ?? null,
        metadata: event.metadata ?? null,
        createdAt: new Date(),
      })
      .returning();

    return inserted[0];
  }

  /**
   * Get events for an experiment
   */
  async getEvents(
    experimentId: string,
    options?: {
      variantId?: string;
      senderId?: string;
      eventType?: string;
      startTime?: Date;
      endTime?: Date;
      limit?: number;
    }
  ): Promise<ExperimentEvent[]> {
    const conditions = [eq(experimentEvents.experimentId, experimentId)];

    if (options?.variantId) {
      conditions.push(eq(experimentEvents.variantId, options.variantId));
    }
    if (options?.senderId) {
      conditions.push(eq(experimentEvents.senderId, options.senderId));
    }
    if (options?.eventType) {
      conditions.push(eq(experimentEvents.eventType, options.eventType));
    }
    if (options?.startTime) {
      conditions.push(gte(experimentEvents.createdAt, options.startTime));
    }
    if (options?.endTime) {
      conditions.push(lte(experimentEvents.createdAt, options.endTime));
    }

    let query = db
      .select()
      .from(experimentEvents)
      .where(and(...conditions))
      .orderBy(desc(experimentEvents.createdAt));

    if (options?.limit) {
      query = query.limit(options.limit) as typeof query;
    }

    return query;
  }

  /**
   * Get aggregated results for an experiment
   */
  async getExperimentResults(experimentId: string): Promise<ExperimentResult[]> {
    const variants = await this.getVariants(experimentId);
    const results: ExperimentResult[] = [];

    for (const variant of variants) {
      // Get all assignments for this variant
      const assignmentCount = await db
        .select({ count: sql<number>`count(*)` })
        .from(experimentAssignments)
        .where(
          and(
            eq(experimentAssignments.experimentId, experimentId),
            eq(experimentAssignments.variantId, variant.id)
          )
        );

      const sampleSize = Number(assignmentCount[0]?.count || 0);

      // Get conversion events (assuming 'conversion' is the event type)
      const conversionCount = await db
        .select({ count: sql<number>`count(*)` })
        .from(experimentEvents)
        .where(
          and(
            eq(experimentEvents.experimentId, experimentId),
            eq(experimentEvents.variantId, variant.id),
            eq(experimentEvents.eventType, 'conversion')
          )
        );

      const conversions = Number(conversionCount[0]?.count || 0);
      const conversionRate = sampleSize > 0 ? (conversions / sampleSize) * 100 : 0;

      // Get metric values
      const metricStats = await db
        .select({
          count: sql<number>`count(*)`,
          sum: sql<number>`sum(${experimentEvents.value})`,
          avg: sql<number>`avg(${experimentEvents.value})`,
        })
        .from(experimentEvents)
        .where(
          and(
            eq(experimentEvents.experimentId, experimentId),
            eq(experimentEvents.variantId, variant.id),
            sql`${experimentEvents.value} IS NOT NULL`
          )
        );

      const avgMetricValue = metricStats[0]?.avg ? Number(metricStats[0].avg) : null;
      const totalMetricValue = metricStats[0]?.sum ? Number(metricStats[0].sum) : null;

      results.push({
        experimentId,
        variantId: variant.id,
        variantName: variant.name,
        sampleSize,
        conversionCount: conversions,
        conversionRate,
        avgMetricValue,
        totalMetricValue,
        statisticalSignificance: null, // Calculated by service
        isWinner: false, // Calculated by service
      });
    }

    return results;
  }

  /**
   * Update experiment status
   */
  async updateExperimentStatus(
    experimentId: string,
    status: ExperimentStatus
  ): Promise<Experiment> {
    const updated = await db
      .update(experiments)
      .set({
        status,
        updatedAt: new Date(),
      })
      .where(eq(experiments.id, experimentId))
      .returning();

    if (updated.length === 0) {
      throw new Error(`Experiment ${experimentId} not found`);
    }

    return updated[0];
  }

  /**
   * Update experiment
   */
  async updateExperiment(
    experimentId: string,
    updates: Partial<Omit<NewExperiment, 'id'>>
  ): Promise<Experiment> {
    const updated = await this.update(experimentId, updates);

    if (!updated) {
      throw new Error(`Experiment ${experimentId} not found`);
    }

    return updated;
  }

  /**
   * Delete an experiment and all related data (cascade)
   */
  async deleteExperiment(experimentId: string): Promise<void> {
    await this.delete(experimentId);
  }

  /**
   * Get count of unique users in an experiment
   */
  async getUniqueUserCount(experimentId: string): Promise<number> {
    const result = await db
      .select({ count: sql<number>`count(DISTINCT ${experimentAssignments.senderId})` })
      .from(experimentAssignments)
      .where(eq(experimentAssignments.experimentId, experimentId));

    return Number(result[0]?.count || 0);
  }

  /**
   * Get count of events by type
   */
  async getEventCountByType(experimentId: string, eventType: string): Promise<number> {
    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(experimentEvents)
      .where(
        and(
          eq(experimentEvents.experimentId, experimentId),
          eq(experimentEvents.eventType, eventType)
        )
      );

    return Number(result[0]?.count || 0);
  }
}
