import { createLogger } from '../utils/logger.js';

const logger = createLogger('proactive-worker');

interface IJobRepository {
  deleteCompletedOneShots(): Promise<number>;
}

interface IRunRepository {
  findStuckRuns(thresholdMs: number): Promise<Array<{ id: string; jobId: string; startedAt: Date }>>;
  completeRun(id: string, result: { status: string; error?: string; durationMs?: number }): Promise<unknown>;
  deleteOldRuns(retentionDays: number): Promise<number>;
}

interface ProactiveWorkerConfig {
  stuckJobThresholdMs: number;
  runHistoryRetentionDays: number;
}

export class ProactiveWorker {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private jobRepo: IJobRepository,
    private runRepo: IRunRepository,
    private config: ProactiveWorkerConfig
  ) {}

  start(intervalMs: number): NodeJS.Timeout {
    logger.info('[ProactiveWorker] Starting proactive worker with interval:', intervalMs, 'ms');

    this.timer = setInterval(() => {
      void this.tick();
    }, intervalMs);

    return this.timer;
  }

  /** Exposed for testing — runs a single tick cycle */
  async tick(): Promise<void> {
    // NOTE: Jobs are executed by ProactiveSchedulerService's timer, not here.
    // This worker only handles cleanup tasks (stuck runs, old runs, one-shot deletion).
    try {
      await this.cleanupStuckRuns();
    } catch (error) {
      logger.error('[ProactiveWorker] Error cleaning up stuck runs:', error);
    }

    try {
      await this.cleanupOldRuns();
    } catch (error) {
      logger.error('[ProactiveWorker] Error cleaning up old runs:', error);
    }

    try {
      await this.deleteCompletedOneShots();
    } catch (error) {
      logger.error('[ProactiveWorker] Error deleting completed one-shots:', error);
    }
  }

  stop(): void {
    if (this.timer) {
      logger.info('[ProactiveWorker] Stopping proactive worker');
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Clean up stuck runs that are running too long without completing
   */
  private async cleanupStuckRuns(): Promise<void> {
    const stuckRuns = await this.runRepo.findStuckRuns(this.config.stuckJobThresholdMs);

    if (stuckRuns.length === 0) {
      return;
    }

    logger.warn('[ProactiveWorker] Found stuck runs:', {
      count: stuckRuns.length,
      thresholdMs: this.config.stuckJobThresholdMs,
    });

    for (const run of stuckRuns) {
      try {
        const runtimeMs = Date.now() - new Date(run.startedAt).getTime();
        const runtimeMinutes = Math.round(runtimeMs / 60000);

        await this.runRepo.completeRun(run.id, {
          status: 'error',
          error: `Stuck run exceeded threshold (${runtimeMinutes} minutes)`,
          durationMs: runtimeMs,
        });

        logger.warn('[ProactiveWorker] Cleaned up stuck run:', {
          runId: run.id,
          jobId: run.jobId,
          runtimeMinutes,
        });
      } catch (error) {
        logger.error('[ProactiveWorker] Error cleaning up stuck run:', {
          runId: run.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  }

  /**
   * Clean up old run history based on retention policy
   */
  private async cleanupOldRuns(): Promise<void> {
    const deleted = await this.runRepo.deleteOldRuns(this.config.runHistoryRetentionDays);

    if (deleted > 0) {
      logger.info('[ProactiveWorker] Cleaned up old runs:', {
        deleted,
        retentionDays: this.config.runHistoryRetentionDays,
      });
    }
  }

  /**
   * Delete completed one-shot jobs
   */
  private async deleteCompletedOneShots(): Promise<void> {
    const deleted = await this.jobRepo.deleteCompletedOneShots();

    if (deleted > 0) {
      logger.info('[ProactiveWorker] Deleted completed one-shot jobs:', {
        deleted,
      });
    }
  }
}
