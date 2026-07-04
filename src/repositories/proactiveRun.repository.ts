import { eq, and, desc, asc, lte, gte, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { proactiveRuns } from '../db/schema';
import type {
  ProactiveRun,
  NewProactiveRun,
  ProactiveRunFilters,
  ProactiveJobStatus,
  ProactiveDeliveryStatus,
  ProactiveTokenUsage,
} from '../types';
import { nanoid } from 'nanoid';

export class ProactiveRunRepository {
  /**
   * Create a new run record
   */
  async create(run: Omit<NewProactiveRun, 'id'>): Promise<ProactiveRun> {
    const inserted = await db
      .insert(proactiveRuns)
      .values({
        id: nanoid(),
        ...run,
      })
      .returning();

    return inserted[0];
  }

  /**
   * Start a new run (creates a record with just jobId and startedAt)
   */
  async startRun(jobId: string): Promise<ProactiveRun> {
    const inserted = await db
      .insert(proactiveRuns)
      .values({
        id: nanoid(),
        jobId,
        startedAt: new Date(),
        status: 'ok', // Will be updated on completion
      })
      .returning();

    return inserted[0];
  }

  /**
   * Complete a run with results
   */
  async completeRun(
    id: string,
    result: {
      status: ProactiveJobStatus;
      generatedMessage?: string;
      deliveryStatus?: ProactiveDeliveryStatus;
      error?: string;
      tokenUsage?: ProactiveTokenUsage;
    }
  ): Promise<ProactiveRun | null> {
    const updated = await db
      .update(proactiveRuns)
      .set({
        completedAt: new Date(),
        status: result.status,
        generatedMessage: result.generatedMessage || null,
        deliveryStatus: result.deliveryStatus || null,
        error: result.error || null,
        tokenUsage: result.tokenUsage ? JSON.stringify(result.tokenUsage) : null,
      })
      .where(eq(proactiveRuns.id, id))
      .returning();

    return updated[0] || null;
  }

  /**
   * Find a run by ID
   */
  async findById(id: string): Promise<ProactiveRun | null> {
    const result = await db
      .select()
      .from(proactiveRuns)
      .where(eq(proactiveRuns.id, id))
      .limit(1);

    return result[0] || null;
  }

  /**
   * Find runs by job ID
   */
  async findByJobId(jobId: string, limit: number = 100): Promise<ProactiveRun[]> {
    return await db
      .select()
      .from(proactiveRuns)
      .where(eq(proactiveRuns.jobId, jobId))
      .orderBy(desc(proactiveRuns.startedAt))
      .limit(limit);
  }

  /**
   * Find runs with optional filters
   */
  async findAll(filters?: ProactiveRunFilters, limit: number = 100): Promise<ProactiveRun[]> {
    let query = db.select().from(proactiveRuns);

    const conditions = [];

    if (filters?.jobId) {
      conditions.push(eq(proactiveRuns.jobId, filters.jobId));
    }

    if (filters?.status) {
      conditions.push(eq(proactiveRuns.status, filters.status));
    }

    if (filters?.deliveryStatus) {
      conditions.push(eq(proactiveRuns.deliveryStatus, filters.deliveryStatus));
    }

    if (filters?.startAfter) {
      conditions.push(gte(proactiveRuns.startedAt, filters.startAfter));
    }

    if (filters?.startBefore) {
      conditions.push(lte(proactiveRuns.startedAt, filters.startBefore));
    }

    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query;
    }

    return await query
      .orderBy(desc(proactiveRuns.startedAt))
      .limit(limit);
  }

  /**
   * Get the most recent run for a job
   */
  async findLastRunForJob(jobId: string): Promise<ProactiveRun | null> {
    const result = await db
      .select()
      .from(proactiveRuns)
      .where(eq(proactiveRuns.jobId, jobId))
      .orderBy(desc(proactiveRuns.startedAt))
      .limit(1);

    return result[0] || null;
  }

  /**
   * Get run statistics for a job
   */
  async getStatsForJob(jobId: string): Promise<{
    totalRuns: number;
    successfulRuns: number;
    failedRuns: number;
    skippedRuns: number;
    avgDurationMs: number;
    totalTokens: number;
    lastRunAt: Date | null;
  }> {
    const runs = await db
      .select()
      .from(proactiveRuns)
      .where(eq(proactiveRuns.jobId, jobId));

    const stats = {
      totalRuns: runs.length,
      successfulRuns: 0,
      failedRuns: 0,
      skippedRuns: 0,
      avgDurationMs: 0,
      totalTokens: 0,
      lastRunAt: null as Date | null,
    };

    if (runs.length === 0) {
      return stats;
    }

    let totalDuration = 0;
    let durationCount = 0;

    for (const run of runs) {
      // Count by status
      if (run.status === 'ok') {
        stats.successfulRuns++;
      } else if (run.status === 'error') {
        stats.failedRuns++;
      } else if (run.status === 'skipped') {
        stats.skippedRuns++;
      }

      // Calculate duration
      if (run.completedAt && run.startedAt) {
        totalDuration += run.completedAt.getTime() - run.startedAt.getTime();
        durationCount++;
      }

      // Sum tokens
      if (run.tokenUsage) {
        try {
          const usage = JSON.parse(run.tokenUsage) as ProactiveTokenUsage;
          stats.totalTokens += usage.totalTokens || 0;
        } catch {
          // Ignore JSON parse errors
        }
      }

      // Track last run
      if (!stats.lastRunAt || run.startedAt > stats.lastRunAt) {
        stats.lastRunAt = run.startedAt;
      }
    }

    if (durationCount > 0) {
      stats.avgDurationMs = Math.round(totalDuration / durationCount);
    }

    return stats;
  }

  /**
   * Get global run statistics
   */
  async getGlobalStats(since?: Date): Promise<{
    totalRuns: number;
    successfulRuns: number;
    failedRuns: number;
    skippedRuns: number;
    totalTokens: number;
    runsToday: number;
    runsThisWeek: number;
  }> {
    let query = db.select().from(proactiveRuns);

    if (since) {
      query = query.where(gte(proactiveRuns.startedAt, since)) as typeof query;
    }

    const runs = await query;

    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(startOfDay);
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());

    const stats = {
      totalRuns: runs.length,
      successfulRuns: 0,
      failedRuns: 0,
      skippedRuns: 0,
      totalTokens: 0,
      runsToday: 0,
      runsThisWeek: 0,
    };

    for (const run of runs) {
      // Count by status
      if (run.status === 'ok') {
        stats.successfulRuns++;
      } else if (run.status === 'error') {
        stats.failedRuns++;
      } else if (run.status === 'skipped') {
        stats.skippedRuns++;
      }

      // Sum tokens
      if (run.tokenUsage) {
        try {
          const usage = JSON.parse(run.tokenUsage) as ProactiveTokenUsage;
          stats.totalTokens += usage.totalTokens || 0;
        } catch {
          // Ignore JSON parse errors
        }
      }

      // Count runs today and this week
      if (run.startedAt >= startOfDay) {
        stats.runsToday++;
      }
      if (run.startedAt >= startOfWeek) {
        stats.runsThisWeek++;
      }
    }

    return stats;
  }

  /**
   * Delete runs older than a retention period
   */
  async deleteOldRuns(retentionDays: number): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);

    const result = await db
      .delete(proactiveRuns)
      .where(lte(proactiveRuns.startedAt, cutoff))
      .returning({ id: proactiveRuns.id });

    return result.length;
  }

  /**
   * Delete all runs for a job
   */
  async deleteByJobId(jobId: string): Promise<number> {
    const result = await db
      .delete(proactiveRuns)
      .where(eq(proactiveRuns.jobId, jobId))
      .returning({ id: proactiveRuns.id });

    return result.length;
  }

  /**
   * Find runs that appear stuck (started but not completed within threshold)
   */
  async findStuckRuns(thresholdMs: number): Promise<ProactiveRun[]> {
    const cutoff = new Date(Date.now() - thresholdMs);

    return await db
      .select()
      .from(proactiveRuns)
      .where(
        and(
          lte(proactiveRuns.startedAt, cutoff),
          sql`${proactiveRuns.completedAt} IS NULL`
        )
      )
      .orderBy(asc(proactiveRuns.startedAt));
  }

  /**
   * Mark stuck runs as failed
   */
  async markStuckRunsAsFailed(runIds: string[]): Promise<number> {
    if (runIds.length === 0) return 0;

    const results = await db
      .update(proactiveRuns)
      .set({
        completedAt: new Date(),
        status: 'error',
        error: 'Job exceeded stuck job threshold - marked as failed',
      })
      .where(sql`id IN (${sql.join(runIds.map(id => sql`${id}`), sql`, `)}`);

    return results.changes;
  }

  /**
   * Get recent failed runs (for monitoring/alerting)
   */
  async getRecentFailures(limit: number = 10): Promise<ProactiveRun[]> {
    return await db
      .select()
      .from(proactiveRuns)
      .where(eq(proactiveRuns.status, 'error'))
      .orderBy(desc(proactiveRuns.startedAt))
      .limit(limit);
  }

  /**
   * Count runs in a time window (for rate limiting)
   */
  async countRunsSince(jobId: string, since: Date): Promise<number> {
    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(proactiveRuns)
      .where(
        and(
          eq(proactiveRuns.jobId, jobId),
          gte(proactiveRuns.startedAt, since)
        )
      );

    return result[0]?.count || 0;
  }
}
