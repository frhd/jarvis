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
   * Run a single cleanup pass
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
  }

  /**
   * Manually trigger a cleanup
   */
  async runManualCleanup(): Promise<number> {
    return this.dlqService.purgeOld(this.retentionMs);
  }
}
