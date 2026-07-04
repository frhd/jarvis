import { MetricsRepository } from '../repositories/metrics.repository';
import { MetricType, MetricPeriod, MetricEvent } from '../types';
import { logger } from '../utils/logger';
import { getErrorMessage, Timing } from '../utils/index.js';
import {
  METRICS_DEFAULT_FLUSH_INTERVAL_MS,
  METRICS_DEFAULT_RETENTION_DAYS,
  METRICS_DEFAULT_AGGREGATION_INTERVAL_MS,
  METRICS_QUEUE_OVERFLOW_LIMIT,
  METRICS_QUEUE_FLUSH_THRESHOLD,
} from '../config/constants.js';

// Pending metrics use simplified format before DB insertion
interface PendingMetric {
  name: string;
  type: MetricType;
  value: number;
  tags: string | null;
  timestamp: Date;
}

interface MetricStats {
  count: number;
  sum: number;
  min: number;
  max: number;
  avg: number;
}

export class MetricsService {
  private pendingMetrics: PendingMetric[] = [];
  private flushInterval: NodeJS.Timeout | null = null;
  private aggregationInterval: NodeJS.Timeout | null = null;
  private readonly flushIntervalMs: number;
  private readonly retentionDays: number;
  private readonly enabled: boolean;

  constructor(
    private metricsRepo: MetricsRepository,
    config?: {
      enabled?: boolean;
      flushIntervalMs?: number;
      retentionDays?: number;
    }
  ) {
    this.enabled = config?.enabled ?? true;
    this.flushIntervalMs = config?.flushIntervalMs ?? METRICS_DEFAULT_FLUSH_INTERVAL_MS;
    this.retentionDays = config?.retentionDays ?? METRICS_DEFAULT_RETENTION_DAYS;

    if (this.enabled) {
      this.startFlushInterval();
      logger.info('[Metrics] Service initialized', {
        flushIntervalMs: this.flushIntervalMs,
        retentionDays: this.retentionDays,
      });
    } else {
      logger.info('[Metrics] Service disabled via configuration');
    }
  }

  /**
   * Record a metric of a specific type
   */
  private recordMetricOfType(
    type: MetricType,
    name: string,
    value: number,
    tags?: Record<string, string>
  ): void {
    if (!this.enabled) return;
    this.recordMetric({
      name,
      type,
      value,
      tags: tags ? JSON.stringify(tags) : null,
      timestamp: new Date(),
    });
  }

  /**
   * Record a timing metric with optional error tagging
   */
  private recordTiming(
    name: string,
    duration: number,
    tags?: Record<string, string>,
    hasError = false
  ): void {
    this.histogram(name, duration, {
      ...tags,
      ...(hasError && { error: 'true' }),
    });
  }

  /**
   * Increment a counter metric
   */
  increment(name: string, tags?: Record<string, string>, value: number = 1): void {
    this.recordMetricOfType('counter', name, value, tags);
  }

  /**
   * Set a gauge value
   */
  gauge(name: string, value: number, tags?: Record<string, string>): void {
    this.recordMetricOfType('gauge', name, value, tags);
  }

  /**
   * Record a histogram value
   */
  histogram(name: string, value: number, tags?: Record<string, string>): void {
    this.recordMetricOfType('histogram', name, value, tags);
  }

  /**
   * Time an async operation and record the duration
   */
  async timing<T>(
    name: string,
    fn: () => Promise<T>,
    tags?: Record<string, string>
  ): Promise<T> {
    if (!this.enabled) {
      return fn();
    }

    const timer = new Timing();
    try {
      const result = await fn();
      this.recordTiming(name, timer.elapsed(), tags);
      return result;
    } catch (error) {
      this.recordTiming(name, timer.elapsed(), tags, true);
      throw error;
    }
  }

  /**
   * Time a sync operation and record the duration
   */
  timingSync<T>(name: string, fn: () => T, tags?: Record<string, string>): T {
    if (!this.enabled) {
      return fn();
    }

    const timer = new Timing();
    try {
      const result = fn();
      this.recordTiming(name, timer.elapsed(), tags);
      return result;
    } catch (error) {
      this.recordTiming(name, timer.elapsed(), tags, true);
      throw error;
    }
  }

  /**
   * Get metric statistics for a specific metric name
   */
  async getStats(
    name: string,
    from?: number,
    to?: number
  ): Promise<MetricStats | null> {
    if (!this.enabled) return null;

    // Ensure pending metrics are flushed before querying
    await this.flush();

    return this.metricsRepo.getStats(name, from, to);
  }

  /**
   * Convenience method for response time statistics
   */
  async getResponseTimeStats(from?: number, to?: number): Promise<MetricStats | null> {
    return this.getStats('response_time_ms', from, to);
  }

  /**
   * Convenience method for cache statistics
   */
  async getCacheStats(from?: number, to?: number): Promise<{
    hits: MetricStats | null;
    misses: MetricStats | null;
    hitRate: number | null;
  }> {
    const [hits, misses] = await Promise.all([
      this.getStats('cache_hit', from, to),
      this.getStats('cache_miss', from, to),
    ]);

    let hitRate: number | null = null;
    if (hits && misses) {
      const totalHits = hits.sum;
      const totalMisses = misses.sum;
      const total = totalHits + totalMisses;
      hitRate = total > 0 ? (totalHits / total) * 100 : 0;
    }

    return { hits, misses, hitRate };
  }

  /**
   * Convenience method for token usage statistics
   */
  async getTokenUsageStats(from?: number, to?: number): Promise<{
    total: MetricStats | null;
  }> {
    const total = await this.getStats('token_usage_total', from, to);
    return { total };
  }

  /**
   * Force flush pending metrics to database
   */
  async flush(): Promise<void> {
    if (!this.enabled || this.pendingMetrics.length === 0) {
      return;
    }

    const metricsToFlush = [...this.pendingMetrics];
    this.pendingMetrics = [];

    try {
      // Convert to repository format (timestamp as number, tags as optional string)
      const repoFormat = metricsToFlush.map(m => ({
        name: m.name,
        type: m.type,
        value: m.value,
        tags: m.tags || undefined,
        timestamp: m.timestamp.getTime(),
      }));
      await this.metricsRepo.recordBatch(repoFormat);

      logger.debug('[Metrics] Flushed metrics', {
        count: metricsToFlush.length,
      });
    } catch (error) {
      logger.error('[Metrics] Failed to flush metrics', {
        count: metricsToFlush.length,
        error: getErrorMessage(error),
      });

      // Re-add failed metrics to the queue (with a limit to prevent memory issues)
      if (this.pendingMetrics.length < METRICS_QUEUE_OVERFLOW_LIMIT) {
        this.pendingMetrics.unshift(...metricsToFlush);
      } else {
        logger.warn('[Metrics] Dropping metrics due to queue overflow', {
          dropped: metricsToFlush.length,
        });
      }
    }
  }

  /**
   * Start background aggregation job
   */
  startAggregationJob(intervalMs: number = METRICS_DEFAULT_AGGREGATION_INTERVAL_MS): void {
    if (!this.enabled) return;

    if (this.aggregationInterval) {
      logger.warn('[Metrics] Aggregation job already running');
      return;
    }

    this.aggregationInterval = setInterval(async () => {
      try {
        await this.runAggregation();
      } catch (error) {
        logger.error('[Metrics] Aggregation job failed', {
          error: getErrorMessage(error),
        });
      }
    }, intervalMs);

    logger.info('[Metrics] Aggregation job started', { intervalMs });
  }

  /**
   * Stop background aggregation job
   */
  stopAggregationJob(): void {
    if (this.aggregationInterval) {
      clearInterval(this.aggregationInterval);
      this.aggregationInterval = null;
      logger.info('[Metrics] Aggregation job stopped');
    }
  }

  /**
   * Cleanup old metrics based on retention policy
   */
  async cleanup(): Promise<void> {
    if (!this.enabled) return;

    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - this.retentionDays);

      const deleted = await this.metricsRepo.pruneOlderThan(cutoffDate);

      logger.info('[Metrics] Cleanup completed', {
        deleted,
        retentionDays: this.retentionDays,
      });
    } catch (error) {
      logger.error('[Metrics] Cleanup failed', {
        error: getErrorMessage(error),
      });
    }
  }

  /**
   * Shutdown the metrics service
   */
  async shutdown(): Promise<void> {
    logger.info('[Metrics] Shutting down...');

    // Stop intervals
    this.stopFlushInterval();
    this.stopAggregationJob();

    // Final flush
    await this.flush();

    logger.info('[Metrics] Shutdown complete');
  }

  /**
   * Record a metric in the pending queue
   */
  private recordMetric(metric: PendingMetric): void {
    this.pendingMetrics.push(metric);

    // If queue is getting large, flush immediately
    if (this.pendingMetrics.length >= METRICS_QUEUE_FLUSH_THRESHOLD) {
      // Don't await - fire and forget
      this.flush().catch((error) => {
        logger.error('[Metrics] Emergency flush failed', {
          error: getErrorMessage(error),
        });
      });
    }
  }

  /**
   * Start automatic flush interval
   */
  private startFlushInterval(): void {
    if (this.flushInterval) return;

    this.flushInterval = setInterval(() => {
      this.flush().catch((error) => {
        logger.error('[Metrics] Scheduled flush failed', {
          error: getErrorMessage(error),
        });
      });
    }, this.flushIntervalMs);
  }

  /**
   * Stop automatic flush interval
   */
  private stopFlushInterval(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
  }

  /**
   * Run metric aggregation
   */
  private async runAggregation(): Promise<void> {
    logger.debug('[Metrics] Running aggregation');

    // Ensure pending metrics are flushed first
    await this.flush();

    // Run aggregation for all periods
    const periods: MetricPeriod[] = ['minute', 'hour', 'day'];
    for (const period of periods) {
      await this.metricsRepo.aggregate(period);
    }

    // Cleanup old metrics
    await this.cleanup();

    logger.debug('[Metrics] Aggregation complete');
  }
}
