import { SemanticCacheService } from '../services/semanticCache.service';
import { logger } from '../utils/logger';
import { CACHE_CLEANUP_INTERVAL_MS } from '../config/constants';

/**
 * Worker that periodically cleans up expired semantic cache entries.
 *
 * Expired entries are automatically removed based on their TTL
 * to prevent unbounded growth of the cache.
 */
export class CacheCleanupWorker {
  private timer: NodeJS.Timeout | null = null;

  constructor(private cacheService: SemanticCacheService) {}

  /**
   * Start the cache cleanup worker
   * @param intervalMs How often to check for expired entries (default: 1 hour)
   */
  start(intervalMs: number = CACHE_CLEANUP_INTERVAL_MS): NodeJS.Timeout {
    logger.info('[CacheCleanupWorker] Starting with interval:', intervalMs, 'ms');

    this.timer = setInterval(async () => {
      await this.runCleanup();
    }, intervalMs);

    return this.timer;
  }

  /**
   * Stop the cache cleanup worker
   */
  stop(): void {
    if (this.timer) {
      logger.info('[CacheCleanupWorker] Stopping');
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Run a single cleanup pass
   */
  private async runCleanup(): Promise<void> {
    try {
      const deletedCount = await this.cacheService.cleanup();

      if (deletedCount > 0) {
        logger.info('[CacheCleanupWorker] Deleted expired cache entries:', deletedCount);
      }
    } catch (error) {
      logger.error('[CacheCleanupWorker] Error during cleanup:',
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  /**
   * Manually trigger a cleanup
   */
  async runManualCleanup(): Promise<number> {
    return this.cacheService.cleanup();
  }
}
