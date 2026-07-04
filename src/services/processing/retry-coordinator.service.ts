/**
 * Retry Coordinator Service
 *
 * Coordinates retry logic and dead letter queue handling.
 * Extracted from ProcessorService to follow single responsibility principle.
 *
 * Key responsibilities:
 * - Determine if a failed message should be retried
 * - Calculate retry delays with exponential backoff
 * - Move messages to dead letter queue when retries are exhausted
 * - Track error history for diagnostics
 */

import type { QueueItem, ProcessingResult, ErrorRecord } from '../../types/index.js';
import { QueueRepository } from '../../repositories/queue.repository.js';
import { RetryStrategyService } from '../retryStrategy.service.js';
import { DeadLetterQueueService } from '../deadLetterQueue.service.js';
import { appConfig } from '../../config/index.js';
import { logger } from '../../utils/logger.js';

export type FailureAction =
  | { action: 'retry'; delayMs: number; nextRetryAt: Date }
  | { action: 'dead-letter' }
  | { action: 'failed' };

export interface RetryCoordinatorConfig {
  maxAttempts: number;
  errorHistoryMaxAgeMs: number;
  cleanupIntervalMs: number;
}

const DEFAULT_CONFIG: RetryCoordinatorConfig = {
  maxAttempts: 5,
  errorHistoryMaxAgeMs: 60 * 60 * 1000, // 1 hour
  cleanupIntervalMs: 5 * 60 * 1000, // 5 minutes
};

/**
 * RetryCoordinatorService
 *
 * Coordinates retry logic for failed message processing.
 * Tracks error history and handles dead letter queue routing.
 */
export class RetryCoordinatorService {
  private config: RetryCoordinatorConfig;
  private errorHistory: Map<string, ErrorRecord[]> = new Map();
  private cleanupIntervalId: NodeJS.Timeout | null = null;

  constructor(
    private queueRepository: QueueRepository,
    private retryStrategyService: RetryStrategyService | null,
    private deadLetterQueueService: DeadLetterQueueService | null,
    config?: Partial<RetryCoordinatorConfig>
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.startCleanupInterval();
  }

  /**
   * Handle a processing result for a queue item
   *
   * @param queueItem - The queue item that was processed
   * @param result - The processing result
   */
  async handleResult(queueItem: QueueItem, result: ProcessingResult): Promise<void> {
    if (result.success) {
      // Clear error history on success
      this.errorHistory.delete(queueItem.id);
      await this.queueRepository.markCompleted(queueItem.id);
      logger.info('[RetryCoordinator] Message completed', { messageId: queueItem.messageId });
    } else {
      await this.handleFailure(queueItem, result.error || 'Unknown error');
    }
  }

  /**
   * Handle a failed processing attempt
   *
   * @param queueItem - The queue item that failed
   * @param errorMessage - The error message
   * @returns The action taken (retry, dead-letter, or failed)
   */
  async handleFailure(queueItem: QueueItem, errorMessage: string): Promise<FailureAction> {
    // Track error history for this queue item
    const errors = this.errorHistory.get(queueItem.id) || [];
    errors.push({
      timestamp: new Date(),
      error: errorMessage,
      attempt: queueItem.attempts + 1,
    });
    this.errorHistory.set(queueItem.id, errors);

    // Increment attempts
    const newAttempts = await this.queueRepository.updateAttemptsWithError(queueItem.id, errorMessage);

    // Check if we should retry
    const shouldRetry = this.retryStrategyService
      ? this.retryStrategyService.shouldRetry(newAttempts, new Error(errorMessage))
      : newAttempts < this.config.maxAttempts;

    if (!shouldRetry) {
      return this.handleExhaustedRetries(queueItem, errors, errorMessage, newAttempts);
    }

    return this.scheduleRetry(queueItem, errorMessage, newAttempts);
  }

  /**
   * Handle exhausted retries - move to DLQ or mark as failed
   */
  private async handleExhaustedRetries(
    queueItem: QueueItem,
    errors: ErrorRecord[],
    errorMessage: string,
    attempts: number
  ): Promise<FailureAction> {
    // Clear error history
    this.errorHistory.delete(queueItem.id);

    // Move to dead letter queue if service is available
    if (this.deadLetterQueueService) {
      try {
        await this.deadLetterQueueService.moveToDeadLetter(
          queueItem.id,
          'MAX_RETRIES_EXCEEDED',
          errors
        );
        logger.error('[RetryCoordinator] Message moved to DLQ after max retries', {
          messageId: queueItem.messageId,
          attempts,
          error: errorMessage,
        });
        return { action: 'dead-letter' };
      } catch (dlqError) {
        logger.error('[RetryCoordinator] Failed to move message to DLQ', {
          messageId: queueItem.messageId,
          error: dlqError instanceof Error ? dlqError.message : 'Unknown error',
        });
        // Fallback: mark as failed
        await this.queueRepository.markFailed(queueItem.id, errorMessage);
        return { action: 'failed' };
      }
    } else {
      // No DLQ service - just mark as failed
      await this.queueRepository.markFailed(queueItem.id, errorMessage);
      logger.error('[RetryCoordinator] Message failed after max retries', {
        messageId: queueItem.messageId,
        attempts,
        error: errorMessage,
      });
      return { action: 'failed' };
    }
  }

  /**
   * Schedule a retry with exponential backoff
   */
  private async scheduleRetry(
    queueItem: QueueItem,
    errorMessage: string,
    attempts: number
  ): Promise<FailureAction> {
    if (this.retryStrategyService) {
      const nextRetryAt = this.retryStrategyService.calculateNextRetryTime(attempts);
      await this.queueRepository.scheduleRetry(queueItem.id, nextRetryAt, errorMessage);

      const delayMs = nextRetryAt.getTime() - Date.now();

      logger.warn('[RetryCoordinator] Message failed, scheduled for retry', {
        messageId: queueItem.messageId,
        attempts,
        nextRetryAt: nextRetryAt.toISOString(),
        delayMs,
        error: errorMessage,
      });

      return { action: 'retry', delayMs, nextRetryAt };
    } else {
      // No retry strategy - immediate retry (legacy behavior)
      logger.warn('[RetryCoordinator] Message failed, will retry', {
        messageId: queueItem.messageId,
        attempts,
        error: errorMessage,
      });

      return { action: 'retry', delayMs: 0, nextRetryAt: new Date() };
    }
  }

  /**
   * Get error history for a queue item
   */
  getErrorHistory(queueItemId: string): ErrorRecord[] | undefined {
    return this.errorHistory.get(queueItemId);
  }

  /**
   * Get current error history size for monitoring
   */
  getErrorHistorySize(): number {
    return this.errorHistory.size;
  }

  /**
   * Clear error history for a specific queue item
   */
  clearErrorHistory(queueItemId: string): void {
    this.errorHistory.delete(queueItemId);
  }

  /**
   * Start the periodic cleanup interval for stale error history
   */
  private startCleanupInterval(): void {
    this.cleanupIntervalId = setInterval(() => {
      this.cleanupStaleErrorHistory().catch((error) => {
        logger.error('[RetryCoordinator] Error history cleanup failed', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      });
    }, this.config.cleanupIntervalMs);

    // Don't keep the process running if this is the only active timer
    if (this.cleanupIntervalId.unref) {
      this.cleanupIntervalId.unref();
    }
  }

  /**
   * Clean up stale error history entries
   */
  private async cleanupStaleErrorHistory(): Promise<void> {
    const queueItemIds = Array.from(this.errorHistory.keys());

    if (queueItemIds.length === 0) {
      return;
    }

    logger.debug('[RetryCoordinator] Starting error history cleanup', {
      totalEntries: queueItemIds.length,
    });

    const now = Date.now();
    let removedCount = 0;

    for (const queueItemId of queueItemIds) {
      const errors = this.errorHistory.get(queueItemId);
      if (!errors || errors.length === 0) {
        this.errorHistory.delete(queueItemId);
        removedCount++;
        continue;
      }

      // Check if entry is older than max age
      const latestError = errors[errors.length - 1];
      const ageMs = now - latestError.timestamp.getTime();

      if (ageMs > this.config.errorHistoryMaxAgeMs) {
        this.errorHistory.delete(queueItemId);
        removedCount++;
        logger.debug('[RetryCoordinator] Removed old error history', {
          queueItemId,
          ageHours: (ageMs / (60 * 60 * 1000)).toFixed(2),
        });
        continue;
      }

      // Check if queue item still exists and is in processing status
      try {
        const queueItem = await this.queueRepository.getById(queueItemId);

        if (!queueItem || queueItem.status !== 'processing') {
          this.errorHistory.delete(queueItemId);
          removedCount++;
          logger.debug('[RetryCoordinator] Removed error history for non-processing item', {
            queueItemId,
            status: queueItem?.status || 'not_found',
          });
        }
      } catch (error) {
        // If we can't query the item, remove it to be safe
        this.errorHistory.delete(queueItemId);
        removedCount++;
        logger.warn('[RetryCoordinator] Removed error history for unqueryable item', {
          queueItemId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    if (removedCount > 0) {
      logger.info('[RetryCoordinator] Error history cleanup completed', {
        removedEntries: removedCount,
        remainingEntries: this.errorHistory.size,
      });
    }
  }

  /**
   * Stop the cleanup interval and clear all error history
   */
  stop(): void {
    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId);
      this.cleanupIntervalId = null;
    }

    const errorHistorySize = this.errorHistory.size;
    this.errorHistory.clear();

    logger.info('[RetryCoordinator] Service stopped', {
      errorHistoryCleared: errorHistorySize,
    });
  }
}
