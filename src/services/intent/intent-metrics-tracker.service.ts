/**
 * Intent Metrics Tracker
 * Collects and reports metrics for intent classification operations.
 */

import { logger } from '../../utils/logger.js';

/** Default metrics logging interval in milliseconds */
export const DEFAULT_METRICS_LOG_INTERVAL_MS = 300_000; // 5 minutes in milliseconds
/** Default in-flight cleanup interval in milliseconds */
export const DEFAULT_IN_FLIGHT_CLEANUP_INTERVAL_MS = 60_000; // 1 minute in milliseconds
/** Default stale threshold for in-flight requests in milliseconds */
export const DEFAULT_IN_FLIGHT_STALE_THRESHOLD_MS = 300_000; // 5 minutes in milliseconds

/**
 * Metrics tracked for intent classification.
 */
export interface IntentMetrics {
  patternClassifications: number;
  llmClassifications: number;
  fallbackClassifications: number;
  timeoutCount: number;
  deduplicatedRequests: number;
  totalTimeoutDurationMs: number;
  cacheHits: number;
  cacheMisses: number;
  timeoutWarnings: number;
  staleInFlightCleanups: number;
}

/**
 * Snapshot of metrics for logging/reporting.
 */
export interface IntentMetricsSnapshot extends IntentMetrics {
  total: number;
  avgTimeoutMs: number;
  cacheHitRate: string;
}

/**
 * Creates an initial metrics object with all values zeroed.
 */
export function createInitialMetrics(): IntentMetrics {
  return {
    patternClassifications: 0,
    llmClassifications: 0,
    fallbackClassifications: 0,
    timeoutCount: 0,
    deduplicatedRequests: 0,
    totalTimeoutDurationMs: 0,
    cacheHits: 0,
    cacheMisses: 0,
    timeoutWarnings: 0,
    staleInFlightCleanups: 0,
  };
}

/**
 * Service for tracking and reporting intent classification metrics.
 */
export class IntentMetricsTracker {
  private metrics: IntentMetrics;
  private logInterval: NodeJS.Timeout | null = null;

  constructor(
    private readonly logIntervalMs: number = DEFAULT_METRICS_LOG_INTERVAL_MS,
    initialMetrics?: IntentMetrics
  ) {
    this.metrics = initialMetrics ?? createInitialMetrics();
  }

  /**
   * Get current metrics snapshot.
   */
  getMetrics(): IntentMetrics {
    return { ...this.metrics };
  }

  /**
   * Get a computed snapshot with derived values (total, averages, rates).
   */
  getSnapshot(): IntentMetricsSnapshot {
    const total = this.metrics.patternClassifications +
      this.metrics.llmClassifications +
      this.metrics.fallbackClassifications;

    const avgTimeoutMs = this.metrics.timeoutCount > 0
      ? Math.round(this.metrics.totalTimeoutDurationMs / this.metrics.timeoutCount)
      : 0;

    const cacheTotal = this.metrics.cacheHits + this.metrics.cacheMisses;
    const cacheHitRate = cacheTotal > 0
      ? ((this.metrics.cacheHits / cacheTotal) * 100).toFixed(1) + '%'
      : '0%';

    return {
      ...this.metrics,
      total,
      avgTimeoutMs,
      cacheHitRate,
    };
  }

  /**
   * Increment a metric by a value (default 1).
   */
  increment(metric: keyof IntentMetrics, value: number = 1): void {
    this.metrics[metric] = (this.metrics[metric] as number) + value;
  }

  /**
   * Record a timeout with its duration for averaging.
   */
  recordTimeout(durationMs: number): void {
    this.metrics.timeoutCount++;
    this.metrics.totalTimeoutDurationMs += durationMs;
  }

  /**
   * Record cache hit.
   */
  recordCacheHit(): void {
    this.metrics.cacheHits++;
  }

  /**
   * Record cache miss.
   */
  recordCacheMiss(): void {
    this.metrics.cacheMisses++;
  }

  /**
   * Start periodic metrics logging.
   */
  startPeriodicLogging(): void {
    if (this.logInterval) {
      return;
    }

    this.logInterval = setInterval(() => {
      this.logMetrics();
    }, this.logIntervalMs);
  }

  /**
   * Stop periodic metrics logging.
   */
  stopPeriodicLogging(): void {
    if (this.logInterval) {
      clearInterval(this.logInterval);
      this.logInterval = null;
    }
  }

  /**
   * Log current metrics to the logger.
   */
  logMetrics(): void {
    const snapshot = this.getSnapshot();

    if (snapshot.total === 0) {
      return;
    }

    logger.info('Intent classification metrics', {
      total: snapshot.total,
      pattern: this.metrics.patternClassifications,
      patternPct: ((this.metrics.patternClassifications / snapshot.total) * 100).toFixed(1) + '%',
      llm: this.metrics.llmClassifications,
      llmPct: ((this.metrics.llmClassifications / snapshot.total) * 100).toFixed(1) + '%',
      fallback: this.metrics.fallbackClassifications,
      fallbackPct: ((this.metrics.fallbackClassifications / snapshot.total) * 100).toFixed(1) + '%',
      timeouts: this.metrics.timeoutCount,
      avgTimeoutMs: snapshot.avgTimeoutMs,
      timeoutWarnings: this.metrics.timeoutWarnings,
      deduplicated: this.metrics.deduplicatedRequests,
      cacheHits: this.metrics.cacheHits,
      cacheMisses: this.metrics.cacheMisses,
      cacheHitRate: snapshot.cacheHitRate,
      staleCleanups: this.metrics.staleInFlightCleanups,
    });
  }

  /**
   * Reset all metrics to zero.
   */
  reset(): void {
    this.metrics = createInitialMetrics();
  }

  /**
   * Cleanup resources.
   */
  destroy(): void {
    this.stopPeriodicLogging();
  }
}
