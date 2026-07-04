import { RetryConfig, DEFAULT_RETRY_CONFIG } from '../types/queue.types';
import { logger } from '../utils/logger';

/**
 * RetryStrategyService
 *
 * Calculates retry delays with exponential backoff and jitter.
 * Implements intelligent retry strategies to prevent thundering herd problems
 * and provide graceful degradation under load.
 *
 * Algorithm:
 * 1. Exponential backoff: delay = baseDelay * (backoffMultiplier ^ attempt)
 * 2. Add jitter: delay = delay * (1 + random * jitterFactor)
 * 3. Cap at maxDelayMs to prevent excessive delays
 *
 * Example with default config:
 * - Attempt 1: 1s * 2^1 = 2s ± 0.25s → ~1.5-2.5s
 * - Attempt 2: 1s * 2^2 = 4s ± 1s → ~3-5s
 * - Attempt 3: 1s * 2^3 = 8s ± 2s → ~6-10s
 * - Attempt 4: 1s * 2^4 = 16s ± 4s → ~12-20s
 * - Attempt 5: 1s * 2^5 = 32s ± 8s → ~24-40s (capped at maxDelayMs)
 */
export class RetryStrategyService {
  private config: RetryConfig;

  constructor(config?: Partial<RetryConfig>) {
    this.config = {
      ...DEFAULT_RETRY_CONFIG,
      ...config,
    };

    logger.info('[RetryStrategy] Service initialized', {
      maxAttempts: this.config.maxAttempts,
      baseDelayMs: this.config.baseDelayMs,
      maxDelayMs: this.config.maxDelayMs,
      backoffMultiplier: this.config.backoffMultiplier,
      jitterFactor: this.config.jitterFactor,
    });
  }

  /**
   * Calculate the delay before the next retry attempt
   *
   * @param attemptNumber - The attempt number (1-based)
   * @returns Delay in milliseconds
   */
  calculateNextRetryDelay(attemptNumber: number): number {
    if (attemptNumber < 1) {
      logger.warn('[RetryStrategy] Invalid attempt number', { attemptNumber });
      attemptNumber = 1;
    }

    // Exponential backoff: baseDelay * (multiplier ^ attempt)
    const exponentialDelay = this.config.baseDelayMs * Math.pow(this.config.backoffMultiplier, attemptNumber);

    // Add jitter to prevent thundering herd
    // Jitter is calculated as: delay * (1 + random(-jitterFactor, +jitterFactor))
    const jitterRange = exponentialDelay * this.config.jitterFactor;
    const jitter = (Math.random() * 2 - 1) * jitterRange; // Random value between -jitterRange and +jitterRange
    const delayWithJitter = exponentialDelay + jitter;

    // Cap at maxDelayMs
    const finalDelay = Math.min(delayWithJitter, this.config.maxDelayMs);

    // Ensure delay is not negative
    const clampedDelay = Math.max(finalDelay, 0);

    logger.debug('[RetryStrategy] Calculated retry delay', {
      attemptNumber,
      exponentialDelay,
      jitter,
      delayWithJitter,
      finalDelay: clampedDelay,
      maxDelayMs: this.config.maxDelayMs,
    });

    return Math.round(clampedDelay);
  }

  /**
   * Calculate when to retry next (absolute time)
   *
   * @param attemptNumber - The attempt number (1-based)
   * @returns Date object representing when to retry
   */
  calculateNextRetryTime(attemptNumber: number): Date {
    const delayMs = this.calculateNextRetryDelay(attemptNumber);
    const nextRetryTime = new Date(Date.now() + delayMs);

    logger.debug('[RetryStrategy] Calculated next retry time', {
      attemptNumber,
      delayMs,
      nextRetryTime,
    });

    return nextRetryTime;
  }

  /**
   * Determine if a retry should be attempted
   *
   * @param attemptNumber - The current attempt number (1-based)
   * @param error - Optional error object for error-specific logic
   * @returns True if retry should be attempted
   */
  shouldRetry(attemptNumber: number, error?: Error): boolean {
    // Basic retry budget check
    if (attemptNumber >= this.config.maxAttempts) {
      logger.info('[RetryStrategy] Max attempts reached', {
        attemptNumber,
        maxAttempts: this.config.maxAttempts,
      });
      return false;
    }

    // Error-specific logic (can be extended)
    if (error) {
      // Don't retry certain error types (can be extended)
      const nonRetryableErrors = [
        'VALIDATION_ERROR',
        'INVALID_INPUT',
        'PERMISSION_DENIED',
        'NOT_FOUND',
      ];

      const errorMessage = error.message || '';
      const isNonRetryable = nonRetryableErrors.some((type) =>
        errorMessage.toUpperCase().includes(type)
      );

      if (isNonRetryable) {
        logger.info('[RetryStrategy] Non-retryable error detected', {
          attemptNumber,
          errorMessage,
        });
        return false;
      }
    }

    logger.debug('[RetryStrategy] Retry approved', {
      attemptNumber,
      maxAttempts: this.config.maxAttempts,
      remainingAttempts: this.config.maxAttempts - attemptNumber,
    });

    return true;
  }

  /**
   * Get the number of retry attempts remaining
   *
   * @param currentAttempts - Number of attempts already made
   * @returns Number of remaining retry attempts
   */
  getRetryBudgetRemaining(currentAttempts: number): number {
    const remaining = Math.max(0, this.config.maxAttempts - currentAttempts);

    logger.debug('[RetryStrategy] Retry budget remaining', {
      currentAttempts,
      maxAttempts: this.config.maxAttempts,
      remaining,
    });

    return remaining;
  }

  /**
   * Get the current retry configuration
   *
   * @returns Current RetryConfig
   */
  getConfig(): RetryConfig {
    return { ...this.config };
  }

  /**
   * Update the retry configuration
   *
   * @param config - Partial configuration to update
   */
  updateConfig(config: Partial<RetryConfig>): void {
    const oldConfig = { ...this.config };
    this.config = {
      ...this.config,
      ...config,
    };

    logger.info('[RetryStrategy] Configuration updated', {
      oldConfig,
      newConfig: this.config,
    });
  }

  /**
   * Calculate total delay across all retry attempts
   *
   * @param maxAttempts - Maximum number of attempts to calculate for
   * @returns Object with total delay and breakdown
   */
  calculateTotalRetryTime(maxAttempts?: number): {
    totalDelayMs: number;
    averageDelayMs: number;
    delays: number[];
  } {
    const attempts = maxAttempts ?? this.config.maxAttempts;
    const delays: number[] = [];
    let totalDelayMs = 0;

    for (let i = 1; i <= attempts; i++) {
      const delay = this.calculateNextRetryDelay(i);
      delays.push(delay);
      totalDelayMs += delay;
    }

    const averageDelayMs = totalDelayMs / attempts;

    logger.debug('[RetryStrategy] Calculated total retry time', {
      attempts,
      totalDelayMs,
      averageDelayMs,
      delays,
    });

    return {
      totalDelayMs,
      averageDelayMs,
      delays,
    };
  }
}
