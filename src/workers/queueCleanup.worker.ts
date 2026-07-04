import { QueueRepository } from '../repositories/queue.repository';
import { MetricsService } from '../services/metrics.service';
import { logger } from '../utils/logger';
import { METRIC_NAMES } from '../types/metrics.types';
import {
  QUEUE_CLEANUP_INTERVAL_MS,
  STUCK_JOB_THRESHOLD_MS,
  MS_PER_DAY,
  MS_PER_MINUTE,
} from '../config/constants';

/**
 * Worker that periodically cleans up old queue items and detects stuck messages.
 *
 * Items with status 'completed' or 'failed' that are older than the
 * retention period are purged to prevent unbounded growth.
 *
 * Messages stuck in 'processing' status for too long (crashed/timed out)
 * are detected and marked as failed to prevent memory leaks.
 */
export class QueueCleanupWorker {
  private timer: NodeJS.Timeout | null = null;
  private retentionMs: number;
  private stuckThresholdMs: number;
  private metricsService: MetricsService | null = null;

  constructor(
    private queueRepository: QueueRepository,
    retentionDays: number = 7,
    stuckThresholdMs: number = STUCK_JOB_THRESHOLD_MS // Default: 1 hour
  ) {
    this.retentionMs = retentionDays * MS_PER_DAY;
    this.stuckThresholdMs = stuckThresholdMs;
  }

  /**
   * Set the metrics service for recording stuck message metrics
   */
  setMetricsService(metricsService: MetricsService): void {
    this.metricsService = metricsService;
  }

  /**
   * Start the queue cleanup worker
   * @param intervalMs How often to check for old items (default: 1 hour)
   */
  start(intervalMs: number = QUEUE_CLEANUP_INTERVAL_MS): NodeJS.Timeout {
    logger.info('[QueueCleanupWorker] Starting with interval:', intervalMs, 'ms',
      'retention:', this.retentionMs / MS_PER_DAY, 'days'
    );

    this.timer = setInterval(async () => {
      await this.runCleanup();
    }, intervalMs);

    return this.timer;
  }

  /**
   * Stop the queue cleanup worker
   */
  stop(): void {
    if (this.timer) {
      logger.info('[QueueCleanupWorker] Stopping');
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Run a single cleanup pass (purge old entries + detect stuck messages + record metrics)
   */
  private async runCleanup(): Promise<void> {
    try {
      // First, record stuck message metrics (before cleanup)
      await this.recordStuckMessageMetrics();

      // Second, detect and fail stuck messages
      const stuckCount = await this.detectAndFailStuckMessages();
      if (stuckCount > 0) {
        logger.warn('[QueueCleanupWorker] Detected and failed stuck messages:', stuckCount);
      }

      // Then purge old completed/failed entries
      const purgedCount = await this.queueRepository.purgeOldEntries(this.retentionMs);
      if (purgedCount > 0) {
        logger.info('[QueueCleanupWorker] Purged old queue items:', purgedCount);
      }
    } catch (error) {
      logger.error('[QueueCleanupWorker] Error during cleanup:',
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  /**
   * Record stuck message metrics for monitoring and alerting
   */
  private async recordStuckMessageMetrics(): Promise<void> {
    if (!this.metricsService) {
      return;
    }

    try {
      const stats = await this.queueRepository.getStuckMessageStats(this.stuckThresholdMs);

      // Record gauge for current stuck message count
      this.metricsService.gauge(METRIC_NAMES.QUEUE_STUCK_MESSAGES, stats.count);

      // Record gauge for oldest stuck message age
      this.metricsService.gauge(METRIC_NAMES.QUEUE_STUCK_OLDEST_AGE_MINUTES, stats.oldestAgeMinutes);

      // Record histogram for age distribution (each bucket as a separate data point)
      for (const bucket of stats.ageDistribution) {
        for (let i = 0; i < bucket.count; i++) {
          this.metricsService.histogram(
            METRIC_NAMES.QUEUE_STUCK_AGE_MINUTES,
            bucket.ageMinutes,
            { bucket: String(bucket.ageMinutes) }
          );
        }
      }

      // Log if there are stuck messages
      if (stats.count > 0) {
        logger.debug('[QueueCleanupWorker] Stuck message metrics recorded:', {
          count: stats.count,
          oldestAgeMinutes: stats.oldestAgeMinutes,
          ageDistribution: stats.ageDistribution,
          byPriority: stats.byPriority,
        });
      }
    } catch (error) {
      logger.error('[QueueCleanupWorker] Error recording stuck message metrics:',
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  /**
   * Detect and fail messages stuck in 'processing' status.
   * These are messages that crashed or timed out during processing.
   * @returns Number of stuck messages that were marked as failed
   */
  async detectAndFailStuckMessages(): Promise<number> {
    try {
      const stuckMessages = await this.queueRepository.getStuckProcessingMessages(this.stuckThresholdMs);

      if (stuckMessages.length === 0) {
        return 0;
      }

      // Log details for monitoring
      const stuckIds = stuckMessages.map(m => m.id);
      const ageMinutes = stuckMessages.map(m => {
        const ageMs = Date.now() - m.createdAt.getTime();
        return Math.round(ageMs / MS_PER_MINUTE);
      });

      logger.warn('[QueueCleanupWorker] Found stuck messages:', {
        count: stuckMessages.length,
        ids: stuckIds,
        agesMinutes: ageMinutes,
        threshold: `${Math.round(this.stuckThresholdMs / MS_PER_MINUTE)} minutes`,
      });

      // Mark all stuck messages as failed
      const errorMessage = `Stuck message auto-cleanup: message was in 'processing' status for >${Math.round(this.stuckThresholdMs / MS_PER_MINUTE)} minutes without completion. Likely caused by crash, timeout, or OOM during processing.`;

      const failedCount = await this.queueRepository.batchMarkFailed(stuckIds, errorMessage);

      logger.info('[QueueCleanupWorker] Marked stuck messages as failed:', {
        count: failedCount,
        ids: stuckIds,
      });

      return failedCount;
    } catch (error) {
      logger.error('[QueueCleanupWorker] Error detecting stuck messages:',
        error instanceof Error ? error.message : 'Unknown error'
      );
      return 0;
    }
  }

  /**
   * Manually trigger a cleanup
   */
  async runManualCleanup(): Promise<number> {
    return this.queueRepository.purgeOldEntries(this.retentionMs);
  }
}
