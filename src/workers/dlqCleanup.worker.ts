import { DeadLetterQueueService } from '../services/deadLetterQueue.service';
import { logger } from '../utils/logger';
import {
  DLQ_CLEANUP_INTERVAL_MS,
  MS_PER_DAY,
} from '../config/constants';

/**
 * Worker that periodically cleans up old dead letter queue items.
 *
 * Items older than the retention period are purged to prevent
 * unbounded growth of the DLQ.
 */
export class DLQCleanupWorker {
  private timer: NodeJS.Timeout | null = null;
  private retentionMs: number;

  constructor(
    private dlqService: DeadLetterQueueService,
    retentionDays: number = 7
  ) {
    this.retentionMs = retentionDays * MS_PER_DAY;
  }

  /**
   * Start the DLQ cleanup worker
   * @param intervalMs How often to check for old items (default: 1 hour)
   */
  start(intervalMs: number = DLQ_CLEANUP_INTERVAL_MS): NodeJS.Timeout {
    logger.info('[DLQCleanupWorker] Starting with interval:', intervalMs, 'ms',
      'retention:', this.retentionMs / MS_PER_DAY, 'days'
    );

    this.timer = setInterval(async () => {
      await this.runCleanup();
    }, intervalMs);

    return this.timer;
  }

  /**
   * Stop the DLQ cleanup worker
   */
  stop(): void {
    if (this.timer) {
      logger.info('[DLQCleanupWorker] Stopping');
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Run a single cleanup pass.
   *
   * Two complementary bounds are enforced:
   *  1. Age-based retention (purge items older than the retention window).
   *  2. Size cap (trim the oldest entries beyond the max-size cap) so a
   *     systematic failure cannot flood the DLQ unbounded within the window.
   */
  private async runCleanup(): Promise<void> {
    try {
      const purgedCount = await this.dlqService.purgeOld(this.retentionMs);

      if (purgedCount > 0) {
        logger.info('[DLQCleanupWorker] Purged old DLQ items:', purgedCount);
      }
    } catch (error) {
      logger.error('[DLQCleanupWorker] Error during cleanup:',
        error instanceof Error ? error.message : 'Unknown error'
      );
    }

    try {
      const trimmedCount = await this.dlqService.trimToMaxSize();

      if (trimmedCount > 0) {
        logger.info('[DLQCleanupWorker] Trimmed DLQ items over size cap:', trimmedCount);
      }
    } catch (error) {
      logger.error('[DLQCleanupWorker] Error during size-cap trim:',
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  /**
   * Manually trigger a cleanup (age-based purge followed by size-cap trim).
   */
  async runManualCleanup(): Promise<number> {
    const purgedCount = await this.dlqService.purgeOld(this.retentionMs);
    const trimmedCount = await this.dlqService.trimToMaxSize();
    return purgedCount + trimmedCount;
  }
}
