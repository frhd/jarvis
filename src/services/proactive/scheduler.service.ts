/**
 * Proactive Scheduler Service
 *
 * Core scheduler that manages timers and orchestrates proactive job execution.
 * Uses setTimeout (not setInterval) to wake at exactly the right time for the
 * next due job. Re-arms after every execution cycle.
 *
 * Design decisions:
 * - setTimeout over setInterval: recalculate wake time after each execution
 * - Max timer delay capped at 24h: re-arm if further out (JS timer precision)
 * - Quiet hours checked before execution, not at scheduling time
 * - Late-bound executor to break circular dependency with executor service
 */

import { calculateNextRunTime, isInQuietHours, getNextNonQuietTime } from './schedule-utils.js';
import { createLogger } from '../../utils/logger.js';
import type { ProactiveJob } from '../../types/index.js';
import type {
  ProactiveConfig,
  ProactiveJobStatus,
  ProactiveJobFilters,
  CreateProactiveJobInput,
  UpdateProactiveJobInput,
  SchedulerState,
} from '../../types/proactive.types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum setTimeout delay — cap at 24 hours and re-arm for longer waits */
const MAX_TIMER_DELAY = 24 * 60 * 60 * 1000; // 86 400 000 ms

// ---------------------------------------------------------------------------
// Interfaces (duck-typed for testability)
// ---------------------------------------------------------------------------

/**
 * Minimal interface for the job repository.
 * The concrete ProactiveJobRepository satisfies this structurally.
 */
export interface IJobRepository {
  findNextToRun(): Promise<ProactiveJob | null>;
  findDue(now?: Date): Promise<ProactiveJob[]>;
  findById(id: string): Promise<ProactiveJob | null>;
  findAll(filters?: ProactiveJobFilters): Promise<ProactiveJob[]>;
  findEnabled(): Promise<ProactiveJob[]>;
  create(input: Omit<ProactiveJob, 'id' | 'createdAt' | 'updatedAt'>): Promise<ProactiveJob>;
  update(
    id: string,
    updates: Partial<Omit<ProactiveJob, 'id' | 'createdAt'>>,
  ): Promise<ProactiveJob | null>;
  updateNextRunAt(id: string, nextRunAt: Date | null): Promise<void>;
  markExecuted(
    id: string,
    status: ProactiveJobStatus,
    nextRunAt: Date | null,
    error?: string,
  ): Promise<void>;
  claimForExecution(id: string): Promise<boolean>;
  resetStaleRunningJobs(): Promise<number>;
  delete(id: string): Promise<boolean>;
}

/**
 * Minimal interface for the executor service (late-bound).
 * The concrete ProactiveExecutorService (Phase 3) will satisfy this.
 */
export interface IProactiveExecutor {
  executeJob(job: ProactiveJob): Promise<{ status: 'ok' | 'error' | 'skipped'; error?: string }>;
}

// ---------------------------------------------------------------------------
// Scheduler configuration shape
// ---------------------------------------------------------------------------

export type SchedulerConfig = ProactiveConfig & {
  workerIntervalMs: number;
  runHistoryRetentionDays: number;
};

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

const logger = createLogger('proactive-scheduler');

// ---------------------------------------------------------------------------
// ProactiveSchedulerService
// ---------------------------------------------------------------------------

export class ProactiveSchedulerService {
  // -- Late-bound executor --------------------------------------------------
  private executor: IProactiveExecutor | null = null;

  // -- Late-bound run repository ----------------------------------------------
  private runRepository: {
    findStuckRuns(thresholdMs: number): Promise<import('../../types/index.js').ProactiveRun[]>;
    markStuckRunsAsFailed(runIds: string[]): Promise<number>;
  } | null = null;

  // -- Timer state ----------------------------------------------------------
  private timer: ReturnType<typeof setTimeout> | null = null;
  private isRunning: boolean = false;
  private isExecutingCycle: boolean = false;
  private nextWakeTime: Date | null = null;
  private enabledJobCount: number = 0;
  private lastTickAt: Date | null = null;

  constructor(
    private jobRepository: IJobRepository,
    private config: SchedulerConfig,
  ) {}

  // -------------------------------------------------------------------------
  // Executor setter (breaks circular dependency)
  // -------------------------------------------------------------------------

  /**
   * Set the executor service. Must be called before any jobs can execute.
   * Uses setter pattern to break the circular dependency between
   * scheduler and executor.
   */
  setExecutor(executor: IProactiveExecutor): void {
    this.executor = executor;
    logger.info('Executor service attached');
  }

  /**
   * Set the run repository for stuck job detection.
   * Must be called before stuck job detection can work.
   */
  setRunRepository(runRepository: {
    findStuckRuns(thresholdMs: number): Promise<import('../../types/index.js').ProactiveRun[]>;
    markStuckRunsAsFailed(runIds: string[]): Promise<number>;
  }): void {
    this.runRepository = runRepository;
    logger.info('Run repository attached for stuck job detection');
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Start the scheduler. Loads enabled jobs and arms the first timer.
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Scheduler is already running');
      return;
    }

    this.isRunning = true;
    logger.info('Proactive scheduler started');

    await this.armTimer();
  }

  /**
   * Stop the scheduler. Clears any pending timer.
   */
  stop(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    this.isRunning = false;
    this.nextWakeTime = null;

    logger.info('Proactive scheduler stopped');
  }

  // -------------------------------------------------------------------------
  // Timer management
  // -------------------------------------------------------------------------

  /**
   * Arm (or re-arm) the timer for the next due job.
   *
   * Finds the earliest enabled job with a nextRunAt, calculates the delay,
   * and sets a timeout. If the job is already past due, fires immediately.
   * Caps the delay at MAX_TIMER_DELAY to avoid JS timer drift on very
   * long waits.
   */
  private async armTimer(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    // Clear any existing timer
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    const nextJob = await this.jobRepository.findNextToRun();

    if (!nextJob || !nextJob.nextRunAt) {
      this.nextWakeTime = null;
      this.enabledJobCount = 0;
      logger.debug('No scheduled jobs — timer idle');
      return;
    }

    const now = Date.now();
    const targetTime = nextJob.nextRunAt.getTime();
    let delay = targetTime - now;

    if (delay <= 0) {
      // Job is already due — execute immediately on next microtask
      logger.debug('Job already due, executing immediately', {
        jobId: nextJob.id,
        jobName: nextJob.name,
      });
      this.nextWakeTime = new Date();
      // Use setTimeout(0) to avoid deep recursion
      this.timer = setTimeout(() => this.onTimer(), 0);
      return;
    }

    // Cap at MAX_TIMER_DELAY; we will re-arm after the timer fires
    const actualDelay = Math.min(delay, MAX_TIMER_DELAY);
    this.nextWakeTime = new Date(now + actualDelay);

    this.timer = setTimeout(() => this.onTimer(), actualDelay);

    logger.debug('Timer armed', {
      jobId: nextJob.id,
      jobName: nextJob.name,
      nextRunAt: nextJob.nextRunAt.toISOString(),
      delayMs: actualDelay,
      capped: delay > MAX_TIMER_DELAY,
    });
  }

  /**
   * Timer callback — find all due jobs, execute them sequentially,
   * then re-arm for the next cycle.
   */
  private async onTimer(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    // Re-entrancy guard: skip if a previous cycle is still executing
    if (this.isExecutingCycle) {
      logger.warn('Skipping timer cycle — previous cycle still executing');
      return;
    }

    this.isExecutingCycle = true;
    this.lastTickAt = new Date();

    try {
      const dueJobs = await this.jobRepository.findDue();

      if (dueJobs.length === 0) {
        logger.debug('Timer fired but no due jobs found');
        await this.armTimer();
        return;
      }

      logger.info('Processing due jobs', { count: dueJobs.length });

      for (const job of dueJobs) {
        await this.executeOrSkip(job);
      }

      // Detect stuck jobs (placeholder for Phase 4 worker)
      await this.detectStuckJobs();
    } catch (error) {
      logger.error('Error in scheduler timer cycle', { error });
    } finally {
      this.isExecutingCycle = false;
    }

    // Always re-arm, even after errors
    await this.armTimer();
  }

  // -------------------------------------------------------------------------
  // Job execution
  // -------------------------------------------------------------------------

  /**
   * Execute a single job, or skip it if quiet hours apply.
   * Handles next-run calculation and DB updates.
   */
  private async executeOrSkip(job: ProactiveJob): Promise<void> {
    const tz = job.timezone || this.config.defaultTimezone;

    // -- Quiet hours gate ---------------------------------------------------
    if (this.config.respectQuietHours) {
      const now = new Date();
      if (isInQuietHours(now, this.config.quietHoursStart, this.config.quietHoursEnd, tz)) {
        const nextNonQuiet = getNextNonQuietTime(this.config.quietHoursEnd, tz);

        await this.jobRepository.updateNextRunAt(job.id, nextNonQuiet);

        logger.info('Job skipped due to quiet hours', {
          jobId: job.id,
          jobName: job.name,
          quietEnd: this.config.quietHoursEnd,
          nextRunAt: nextNonQuiet.toISOString(),
        });
        return;
      }
    }

    // -- Executor check -----------------------------------------------------
    if (!this.executor) {
      logger.error('No executor attached — cannot run job', {
        jobId: job.id,
        jobName: job.name,
      });
      return;
    }

    // -- Database-level execution lock --------------------------------------
    const claimed = await this.jobRepository.claimForExecution(job.id);
    if (!claimed) {
      logger.warn('Job already running — skipping duplicate execution', {
        jobId: job.id,
        jobName: job.name,
      });
      return;
    }

    // -- Update nextRunAt BEFORE execution (prevents re-execution on crash) --
    const nextRun = calculateNextRunTime(
      job.scheduleType,
      job.scheduleValue,
      tz,
    );
    await this.jobRepository.updateNextRunAt(job.id, nextRun);

    // -- Execute ------------------------------------------------------------
    let result: { status: 'ok' | 'error' | 'skipped'; error?: string };
    try {
      result = await this.executor.executeJob(job);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Job execution threw an exception', {
        jobId: job.id,
        jobName: job.name,
        error: errorMessage,
      });
      result = { status: 'error', error: errorMessage };
    }

    // -- Post-execution status update ---------------------------------------
    if (job.deleteAfterRun && result.status === 'ok') {
      await this.jobRepository.delete(job.id);
      logger.info('Job deleted after successful run (deleteAfterRun)', {
        jobId: job.id,
        jobName: job.name,
      });
    } else {
      await this.jobRepository.markExecuted(
        job.id,
        result.status as ProactiveJobStatus,
        nextRun,
        result.error,
      );

      logger.info('Job execution complete', {
        jobId: job.id,
        jobName: job.name,
        status: result.status,
        nextRunAt: nextRun?.toISOString() ?? null,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Stuck job detection (placeholder)
  // -------------------------------------------------------------------------

  /**
   * Detect jobs that appear stuck (running too long).
   *
   * Queries proactiveRuns for runs that started > stuckJobThresholdMs ago
   * and have not completed. Marks them as failed and logs the result.
   */
  private async detectStuckJobs(): Promise<void> {
    if (!this.runRepository) {
      return; // No run repository attached, skip detection
    }

    const stuckRuns = await this.runRepository.findStuckRuns(
      this.config.stuckJobThresholdMs,
    );

    if (stuckRuns.length === 0) {
      return; // No stuck jobs
    }

    const runIds = stuckRuns.map((r) => r.id);
    const jobIdSet = new Set(stuckRuns.map((r) => r.jobId));

    logger.warn('Found stuck proactive jobs', {
      count: stuckRuns.length,
      jobIds: Array.from(jobIdSet),
      runIds,
    });

    const markedCount = await this.runRepository.markStuckRunsAsFailed(runIds);

    logger.info('Marked stuck runs as failed', {
      count: markedCount,
    });
  }

  // -------------------------------------------------------------------------
  // Job CRUD
  // -------------------------------------------------------------------------

  /**
   * Create a new proactive job, calculate its first nextRunAt, and
   * re-arm the timer if the new job is sooner than the current wake.
   */
  async addJob(input: CreateProactiveJobInput): Promise<ProactiveJob> {
    const tz = input.timezone || this.config.defaultTimezone;

    // Calculate initial nextRunAt
    const nextRunAt = calculateNextRunTime(
      input.scheduleType,
      input.scheduleValue,
      tz,
    );

    // Build the create payload — spread input and add computed fields
    const job = await this.jobRepository.create({
      name: input.name,
      description: input.description ?? null,
      enabled: input.enabled ?? true,
      scheduleType: input.scheduleType,
      scheduleValue: input.scheduleValue,
      timezone: tz,
      targetChatId: input.targetChatId ?? null,
      targetSenderId: input.targetSenderId ?? null,
      messageType: input.messageType,
      messageTemplate: input.messageTemplate ?? null,
      contextConfig: input.contextConfig ? JSON.stringify(input.contextConfig) : null,
      deleteAfterRun: input.deleteAfterRun ?? false,
      nextRunAt,
      lastRunAt: null,
      lastStatus: null,
      lastError: null,
    });

    logger.info('Job created', {
      jobId: job.id,
      jobName: job.name,
      nextRunAt: nextRunAt?.toISOString() ?? null,
    });

    // Re-arm timer — the new job might be sooner than the current wake
    if (this.isRunning) {
      await this.armTimer();
    }

    return job;
  }

  /**
   * Update an existing job. If the schedule changed, recalculate nextRunAt.
   */
  async updateJob(
    id: string,
    input: UpdateProactiveJobInput,
  ): Promise<ProactiveJob | null> {
    const existing = await this.jobRepository.findById(id);
    if (!existing) {
      return null;
    }

    // Build update payload
    const updates: Partial<Omit<ProactiveJob, 'id' | 'createdAt'>> = {};

    if (input.name !== undefined) updates.name = input.name;
    if (input.description !== undefined) updates.description = input.description;
    if (input.enabled !== undefined) updates.enabled = input.enabled;
    if (input.scheduleType !== undefined) updates.scheduleType = input.scheduleType;
    if (input.scheduleValue !== undefined) updates.scheduleValue = input.scheduleValue;
    if (input.timezone !== undefined) updates.timezone = input.timezone;
    if (input.targetChatId !== undefined) updates.targetChatId = input.targetChatId;
    if (input.targetSenderId !== undefined) updates.targetSenderId = input.targetSenderId;
    if (input.messageType !== undefined) updates.messageType = input.messageType;
    if (input.messageTemplate !== undefined) updates.messageTemplate = input.messageTemplate;
    if (input.contextConfig !== undefined) {
      updates.contextConfig = input.contextConfig ? JSON.stringify(input.contextConfig) : null;
    }
    if (input.deleteAfterRun !== undefined) updates.deleteAfterRun = input.deleteAfterRun;

    // Recalculate nextRunAt if schedule parameters changed
    const scheduleChanged =
      input.scheduleType !== undefined ||
      input.scheduleValue !== undefined ||
      input.timezone !== undefined;

    if (scheduleChanged) {
      const type = input.scheduleType ?? existing.scheduleType;
      const value = input.scheduleValue ?? existing.scheduleValue;
      const tz = input.timezone ?? existing.timezone ?? this.config.defaultTimezone;

      updates.nextRunAt = calculateNextRunTime(type, value, tz);
    }

    const updated = await this.jobRepository.update(id, updates);

    if (updated) {
      logger.info('Job updated', {
        jobId: id,
        scheduleChanged,
        nextRunAt: updated.nextRunAt?.toISOString() ?? null,
      });
    }

    // Re-arm timer — schedule may have changed
    if (this.isRunning) {
      await this.armTimer();
    }

    return updated;
  }

  /**
   * Remove a job by ID.
   */
  async removeJob(id: string): Promise<boolean> {
    const deleted = await this.jobRepository.delete(id);

    if (deleted) {
      logger.info('Job removed', { jobId: id });
    }

    // Re-arm timer — the removed job may have been the next wake target
    if (this.isRunning) {
      await this.armTimer();
    }

    return deleted;
  }

  // -------------------------------------------------------------------------
  // Immediate execution
  // -------------------------------------------------------------------------

  /**
   * Execute a job immediately, bypassing quiet hours.
   * Calculates the next run time and updates the DB afterwards.
   */
  async runNow(id: string): Promise<void> {
    const job = await this.jobRepository.findById(id);
    if (!job) {
      throw new Error(`Job not found: ${id}`);
    }

    if (!this.executor) {
      throw new Error('No executor attached — cannot run job');
    }

    logger.info('Running job immediately (runNow)', {
      jobId: job.id,
      jobName: job.name,
    });

    let result: { status: 'ok' | 'error' | 'skipped'; error?: string };
    try {
      result = await this.executor.executeJob(job);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      result = { status: 'error', error: errorMessage };
    }

    const tz = job.timezone || this.config.defaultTimezone;
    const nextRun = calculateNextRunTime(job.scheduleType, job.scheduleValue, tz);

    if (job.deleteAfterRun && result.status === 'ok') {
      await this.jobRepository.delete(job.id);
      logger.info('Job deleted after runNow (deleteAfterRun)', {
        jobId: job.id,
        jobName: job.name,
      });
    } else {
      await this.jobRepository.markExecuted(
        job.id,
        result.status as ProactiveJobStatus,
        nextRun,
        result.error,
      );
    }

    // Re-arm timer
    if (this.isRunning) {
      await this.armTimer();
    }
  }

  // -------------------------------------------------------------------------
  // Query
  // -------------------------------------------------------------------------

  /**
   * List jobs with optional filters.
   */
  async listJobs(filters?: ProactiveJobFilters): Promise<ProactiveJob[]> {
    return this.jobRepository.findAll(filters);
  }

  // -------------------------------------------------------------------------
  // State inspection
  // -------------------------------------------------------------------------

  /**
   * Return the current scheduler state for health checks and dashboards.
   */
  getState(): SchedulerState {
    return {
      isRunning: this.isRunning,
      nextWakeTime: this.nextWakeTime,
      activeJobCount: 0, // Tracked properly once Phase 4 worker is implemented
      lastTickAt: this.lastTickAt,
    };
  }
}

export default ProactiveSchedulerService;
