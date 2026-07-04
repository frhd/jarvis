import { memoryRepository } from '../repositories/memory.repository';
import { embeddingRepository } from '../repositories/embedding.repository';
import { logger } from '../utils/logger';
import { appConfig } from '../config';
import {
  CLEANUP_MESSAGE_RETENTION_DAYS,
  CLEANUP_MEMORY_RETENTION_DAYS,
  CLEANUP_PREFERENCE_RETENTION_DAYS,
  MEMORY_CLEANUP_INTERVAL_MS,
  MEMORY_CLEANUP_FETCH_LIMIT,
} from '../config/constants';

/**
 * Worker that periodically cleans up old embeddings and memories
 * to prevent memory leaks from accumulating data.
 *
 * This addresses the memory leak issue where embeddings and memories
 * grow unbounded, causing the process to hit the memory limit.
 */
export class MemoryCleanupWorker {
  private timer: NodeJS.Timeout | null = null;

  constructor() {}

  /**
   * Start the memory cleanup worker
   * @param intervalMs How often to run cleanup (default: 1 hour)
   */
  start(intervalMs: number = MEMORY_CLEANUP_INTERVAL_MS): NodeJS.Timeout {
    logger.info('[MemoryCleanupWorker] Starting with interval:', intervalMs, 'ms');

    this.timer = setInterval(async () => {
      await this.runCleanup();
    }, intervalMs);

    return this.timer;
  }

  /**
   * Stop the memory cleanup worker
   */
  stop(): void {
    if (this.timer) {
      logger.info('[MemoryCleanupWorker] Stopping');
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Run a single cleanup pass
   */
  private async runCleanup(): Promise<void> {
    try {
      const results = await this.cleanupOldEmbeddings();
      const memoryResults = await this.cleanupOldMemories();
      const orphanedResults = await this.cleanupOrphanedEmbeddings();

      if (results.deleted > 0 || memoryResults.deleted > 0 || orphanedResults.deleted > 0) {
        logger.info('[MemoryCleanupWorker] Cleanup completed', {
          oldEmbeddings: results.deleted,
          oldMemories: memoryResults.deleted,
          orphanedEmbeddings: orphanedResults.deleted,
        });
      } else {
        logger.debug('[MemoryCleanupWorker] No cleanup needed');
      }
    } catch (error) {
      logger.error('[MemoryCleanupWorker] Error during cleanup:',
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  /**
   * Clean up old embeddings to prevent unbounded growth
   * @returns Cleanup results
   */
  private async cleanupOldEmbeddings(): Promise<{ deleted: number; totalRemaining: number }> {
    try {
      // Get current stats before cleanup
      const statsBefore = await embeddingRepository.getStats();

      // Delete embeddings older than 90 days for message cache (messages are less important)
      const deletedMessages = await embeddingRepository.deleteOlderThan(CLEANUP_MESSAGE_RETENTION_DAYS, 'message');

      // Delete embeddings older than 180 days for memory and preference (keep these longer)
      const deletedMemories = await embeddingRepository.deleteOlderThan(CLEANUP_MEMORY_RETENTION_DAYS, 'memory');
      const deletedPreferences = await embeddingRepository.deleteOlderThan(CLEANUP_PREFERENCE_RETENTION_DAYS, 'preference');

      const totalDeleted = deletedMessages + deletedMemories + deletedPreferences;

      // Get stats after cleanup
      const statsAfter = await embeddingRepository.getStats();

      logger.debug('[MemoryCleanupWorker] Old embeddings cleaned', {
        deletedMessages,
        deletedMemories,
        deletedPreferences,
        totalDeleted,
        beforeCount: statsBefore.total,
        afterCount: statsAfter.total,
        oldestBefore: statsBefore.oldestAgeDays,
        oldestAfter: statsAfter.oldestAgeDays,
      });

      return { deleted: totalDeleted, totalRemaining: statsAfter.total };
    } catch (error) {
      logger.error('[MemoryCleanupWorker] Failed to clean old embeddings',
        error instanceof Error ? error.message : 'Unknown error'
      );
      return { deleted: 0, totalRemaining: 0 };
    }
  }

  /**
   * Clean up old archived memories
   * @returns Cleanup results
   */
  private async cleanupOldMemories(): Promise<{ deleted: number }> {
    try {
      const archiveDays = appConfig.memory.archiveAfterDays || 90;
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - archiveDays);

      // Delete archived memories older than the archive threshold
      // These are already archived and won't be used, so we can safely delete them
      const deleted = await memoryRepository.deleteArchivedOlderThan(cutoffDate);

      logger.debug('[MemoryCleanupWorker] Old memories cleaned', {
        deleted,
        archiveDays,
      });

      return { deleted };
    } catch (error) {
      logger.error('[MemoryCleanupWorker] Failed to clean old memories',
        error instanceof Error ? error.message : 'Unknown error'
      );
      return { deleted: 0 };
    }
  }

  /**
   * Clean up orphaned embeddings (embeddings for deleted sources)
   * @returns Cleanup results
   */
  private async cleanupOrphanedEmbeddings(): Promise<{ deleted: number }> {
    try {
      // Get all valid memory IDs
      const allMemories = await memoryRepository.findAll(MEMORY_CLEANUP_FETCH_LIMIT);
      const validMemoryIds = new Set(allMemories.map(m => m.id));

      // Get all valid message IDs (from recent messages only, to keep it efficient)
      // For now, we'll just clean orphaned memory embeddings
      const deleted = await embeddingRepository.deleteOrphaned(validMemoryIds, 'memory');

      logger.debug('[MemoryCleanupWorker] Orphaned embeddings cleaned', {
        deleted,
      });

      return { deleted };
    } catch (error) {
      logger.error('[MemoryCleanupWorker] Failed to clean orphaned embeddings',
        error instanceof Error ? error.message : 'Unknown error'
      );
      return { deleted: 0 };
    }
  }

  /**
   * Manually trigger a cleanup pass
   */
  async runManualCleanup(): Promise<{
    oldEmbeddings: number;
    oldMemories: number;
    orphanedEmbeddings: number;
  }> {
    const embeddingsResult = await this.cleanupOldEmbeddings();
    const memoryResult = await this.cleanupOldMemories();
    const orphanedResult = await this.cleanupOrphanedEmbeddings();

    return {
      oldEmbeddings: embeddingsResult.deleted,
      oldMemories: memoryResult.deleted,
      orphanedEmbeddings: orphanedResult.deleted,
    };
  }

  /**
   * Get memory cleanup statistics
   */
  async getCleanupStats(): Promise<{
    embeddingsTotal: number;
    embeddingsByType: Record<string, number>;
    embeddingsOldestAgeDays: number | null;
    memoriesTotal: number;
    memoriesActive: number;
    memoriesArchived: number;
  }> {
    const embeddingStats = await embeddingRepository.getStats();
    const memoryTotal = await memoryRepository.getCount();
    const memoryActive = await memoryRepository.getActiveCount();
    const memoryArchived = await memoryRepository.getArchivedCount();

    return {
      embeddingsTotal: embeddingStats.total,
      embeddingsByType: embeddingStats.byType,
      embeddingsOldestAgeDays: embeddingStats.oldestAgeDays,
      memoriesTotal: memoryTotal,
      memoriesActive: memoryActive,
      memoriesArchived: memoryArchived,
    };
  }
}

// Singleton instance
export const memoryCleanupWorker = new MemoryCleanupWorker();
