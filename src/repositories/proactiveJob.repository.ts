import { eq, and, desc, asc, lte, ne, isNull, or, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { proactiveJobs } from '../db/schema.js';
import { BaseRepository } from './base.repository.js';
import type {
  ProactiveJob,
  NewProactiveJob,
  ProactiveJobFilters,
  ProactiveScheduleType,
  ProactiveMessageType,
  ProactiveJobStatus,
} from '../types/index.js';

export class ProactiveJobRepository extends BaseRepository<ProactiveJob, NewProactiveJob, typeof proactiveJobs> {
  protected table = proactiveJobs;

  // Note: create() is inherited from BaseRepository which handles id, createdAt, updatedAt
  // Note: findById() is inherited from BaseRepository

  /**
   * Find a job by name
   */
  async findByName(name: string): Promise<ProactiveJob | null> {
    const result = await db
      .select()
      .from(proactiveJobs)
      .where(eq(proactiveJobs.name, name))
      .limit(1);

    return result[0] || null;
  }

  /**
   * Get all jobs with optional filters
   */
  async findAll(filters?: ProactiveJobFilters): Promise<ProactiveJob[]> {
    let query = db.select().from(proactiveJobs);

    const conditions = [];

    if (filters?.enabled !== undefined) {
      conditions.push(eq(proactiveJobs.enabled, filters.enabled));
    }

    if (filters?.messageType) {
      conditions.push(eq(proactiveJobs.messageType, filters.messageType));
    }

    if (filters?.scheduleType) {
      conditions.push(eq(proactiveJobs.scheduleType, filters.scheduleType));
    }

    if (filters?.targetChatId) {
      conditions.push(eq(proactiveJobs.targetChatId, filters.targetChatId));
    }

    if (filters?.targetSenderId) {
      conditions.push(eq(proactiveJobs.targetSenderId, filters.targetSenderId));
    }

    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query;
    }

    return await query.orderBy(asc(proactiveJobs.name));
  }

  /**
   * Get all enabled jobs
   */
  async findEnabled(): Promise<ProactiveJob[]> {
    return await db
      .select()
      .from(proactiveJobs)
      .where(eq(proactiveJobs.enabled, true))
      .orderBy(asc(proactiveJobs.nextRunAt));
  }

  /**
   * Get jobs that are due for execution
   * Returns enabled jobs where nextRunAt <= now
   */
  async findDue(now: Date = new Date()): Promise<ProactiveJob[]> {
    return await db
      .select()
      .from(proactiveJobs)
      .where(
        and(
          eq(proactiveJobs.enabled, true),
          lte(proactiveJobs.nextRunAt, now),
          or(
            isNull(proactiveJobs.lastStatus),
            ne(proactiveJobs.lastStatus, 'running')
          )
        )
      )
      .orderBy(asc(proactiveJobs.nextRunAt));
  }

  /**
   * Get the next job to run (earliest nextRunAt among enabled jobs)
   */
  async findNextToRun(): Promise<ProactiveJob | null> {
    const result = await db
      .select()
      .from(proactiveJobs)
      .where(
        and(
          eq(proactiveJobs.enabled, true),
          sql`${proactiveJobs.nextRunAt} IS NOT NULL`
        )
      )
      .orderBy(asc(proactiveJobs.nextRunAt))
      .limit(1);

    return result[0] || null;
  }

  /**
   * Update the next run time for a job
   * Uses inherited update() which handles updatedAt automatically
   */
  async updateNextRunAt(id: string, nextRunAt: Date | null): Promise<void> {
    await this.update(id, { nextRunAt } as Partial<NewProactiveJob>);
  }

  /**
   * Mark a job as executed
   * Uses inherited update() which handles updatedAt automatically
   */
  async markExecuted(
    id: string,
    status: ProactiveJobStatus,
    nextRunAt: Date | null,
    error?: string
  ): Promise<void> {
    await this.update(id, {
      lastRunAt: new Date(),
      lastStatus: status,
      lastError: error ?? null,
      nextRunAt,
    } as Partial<NewProactiveJob>);
  }

  /**
   * Enable or disable a job
   * Uses inherited update() which handles updatedAt automatically
   */
  async setEnabled(id: string, enabled: boolean): Promise<void> {
    await this.update(id, { enabled } as Partial<NewProactiveJob>);
  }

  /**
   * Atomically claim a job for execution by setting lastStatus='running'.
   * Returns true if the claim succeeded (job was not already running).
   * Uses a WHERE guard to prevent concurrent execution of the same job.
   */
  async claimForExecution(id: string): Promise<boolean> {
    const result = await db
      .update(proactiveJobs)
      .set({
        lastStatus: 'running',
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(proactiveJobs.id, id),
          or(
            isNull(proactiveJobs.lastStatus),
            ne(proactiveJobs.lastStatus, 'running')
          )
        )
      );

    return (result as unknown as { changes: number }).changes > 0;
  }

  /**
   * Reset any jobs stuck in 'running' status back to 'error'.
   * Called at startup to clear locks left by crashed processes.
   * Returns the number of jobs reset.
   */
  async resetStaleRunningJobs(): Promise<number> {
    const result = await db
      .update(proactiveJobs)
      .set({
        lastStatus: 'error',
        lastError: 'Process crashed while job was running',
        updatedAt: new Date(),
      })
      .where(eq(proactiveJobs.lastStatus, 'running'));

    return (result as unknown as { changes: number }).changes;
  }

  // Note: delete() is inherited from BaseRepository

  /**
   * Delete jobs that are marked for deletion after run
   */
  async deleteCompletedOneShots(): Promise<number> {
    const result = await db
      .delete(proactiveJobs)
      .where(
        and(
          eq(proactiveJobs.deleteAfterRun, true),
          sql`${proactiveJobs.lastRunAt} IS NOT NULL`
        )
      )
      .returning({ id: proactiveJobs.id });

    return result.length;
  }

  /**
   * Get job statistics
   */
  async getStats(): Promise<{
    total: number;
    enabled: number;
    disabled: number;
    byType: Record<ProactiveMessageType, number>;
    bySchedule: Record<ProactiveScheduleType, number>;
    byStatus: Record<ProactiveJobStatus | 'never_run', number>;
  }> {
    const jobs = await db.select().from(proactiveJobs);

    const stats = {
      total: jobs.length,
      enabled: 0,
      disabled: 0,
      byType: {} as Record<ProactiveMessageType, number>,
      bySchedule: {} as Record<ProactiveScheduleType, number>,
      byStatus: {} as Record<ProactiveJobStatus | 'never_run', number>,
    };

    for (const job of jobs) {
      // Count enabled/disabled
      if (job.enabled) {
        stats.enabled++;
      } else {
        stats.disabled++;
      }

      // Count by message type
      const msgType = job.messageType as ProactiveMessageType;
      stats.byType[msgType] = (stats.byType[msgType] || 0) + 1;

      // Count by schedule type
      const schedType = job.scheduleType as ProactiveScheduleType;
      stats.bySchedule[schedType] = (stats.bySchedule[schedType] || 0) + 1;

      // Count by last status
      if (job.lastStatus) {
        stats.byStatus[job.lastStatus] = (stats.byStatus[job.lastStatus] || 0) + 1;
      } else {
        stats.byStatus['never_run'] = (stats.byStatus['never_run'] || 0) + 1;
      }
    }

    return stats;
  }

  /**
   * Check if a job with the given name exists
   */
  async existsByName(name: string): Promise<boolean> {
    const result = await db
      .select({ id: proactiveJobs.id })
      .from(proactiveJobs)
      .where(eq(proactiveJobs.name, name))
      .limit(1);

    return result.length > 0;
  }

  /**
   * Get jobs targeting a specific chat
   */
  async findByTargetChat(chatId: string): Promise<ProactiveJob[]> {
    return await db
      .select()
      .from(proactiveJobs)
      .where(eq(proactiveJobs.targetChatId, chatId))
      .orderBy(asc(proactiveJobs.name));
  }

  /**
   * Get jobs targeting a specific sender
   */
  async findByTargetSender(senderId: string): Promise<ProactiveJob[]> {
    return await db
      .select()
      .from(proactiveJobs)
      .where(eq(proactiveJobs.targetSenderId, senderId))
      .orderBy(asc(proactiveJobs.name));
  }
}
