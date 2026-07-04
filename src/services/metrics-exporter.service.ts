import { LLMResponseRepository } from '../repositories/llmResponse.repository';
import { IntentLogRepository } from '../repositories/intentLog.repository';
import { SemanticCacheRepository } from '../repositories/semanticCache.repository';
import { QueueRepository } from '../repositories/queue.repository';
import { DeadLetterQueueRepository } from '../repositories/deadLetterQueue.repository';
import { CircuitBreakerRepository } from '../repositories/circuitBreaker.repository';
import { logger } from '../utils/logger';
import { db } from '../db/client';
import { llmResponses, intentClassificationLogs, semanticCache, queue } from '../db/schema';
import { sql, and, gte, lte } from 'drizzle-orm';

/**
 * Metric data aggregated for export
 */
export interface MetricData {
  name: string;
  type: 'counter' | 'gauge' | 'histogram';
  help: string;
  labels: Record<string, string>;
  value: number;
  timestamp?: number;
}

/**
 * Response time metrics by model
 */
interface ResponseTimeMetric {
  model: string;
  count: number;
  sum: number;
  min: number;
  max: number;
  avg: number;
  p50?: number;
  p95?: number;
  p99?: number;
}

/**
 * Token usage metrics by model
 */
interface TokenUsageMetric {
  model: string;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  count: number;
}

/**
 * Intent classification metrics
 */
interface IntentMetric {
  parentIntent: string;
  childIntent: string;
  count: number;
  avgConfidence: number;
  avgDuration: number;
}

/**
 * Queue metrics
 */
interface QueueMetric {
  status: string;
  count: number;
}

/**
 * Cache metrics
 */
interface CacheMetric {
  totalEntries: number;
  totalHits: number;
  avgHitCount: number;
  hitRate: number;
  entriesByIntent: Record<string, number>;
  entriesByModel: Record<string, number>;
}

/**
 * Dead letter queue metrics
 */
interface DLQMetric {
  total: number;
  byReason: Record<string, number>;
  recentFailures: number;
}

/**
 * Circuit breaker metrics
 */
interface CircuitBreakerMetric {
  serviceName: string;
  state: string;
  failureCount: number;
  successCount: number;
}

/**
 * Export options for time-based filtering
 */
export interface ExportOptions {
  from?: number; // Unix timestamp in seconds
  to?: number; // Unix timestamp in seconds
}

/**
 * MetricsExporterService - Export metrics in different formats
 *
 * This service aggregates metrics from various repositories and exports them
 * in Prometheus, JSON, or CSV formats for monitoring and analysis.
 */
export class MetricsExporterService {
  private dlqRepo: DeadLetterQueueRepository | null = null;
  private circuitBreakerRepo: CircuitBreakerRepository | null = null;

  constructor(
    private llmResponseRepo: LLMResponseRepository,
    private intentLogRepo: IntentLogRepository,
    private cacheRepo: SemanticCacheRepository,
    private queueRepo: QueueRepository
  ) {
    logger.info('[MetricsExporter] Service initialized');
  }

  /**
   * Set optional DLQ repository for dead letter queue metrics
   */
  setDLQRepository(repo: DeadLetterQueueRepository): void {
    this.dlqRepo = repo;
  }

  /**
   * Set optional circuit breaker repository for circuit breaker metrics
   */
  setCircuitBreakerRepository(repo: CircuitBreakerRepository): void {
    this.circuitBreakerRepo = repo;
  }

  /**
   * Export all metrics in Prometheus text format
   *
   * @param from - Start timestamp (Unix seconds)
   * @param to - End timestamp (Unix seconds)
   * @returns Prometheus-formatted metrics text
   */
  async exportPrometheus(from?: number, to?: number): Promise<string> {
    logger.info('[MetricsExporter] Exporting Prometheus format', { from, to });

    const lines: string[] = [];
    const timestamp = Math.floor(Date.now() / 1000);

    try {
      // Response time metrics
      const responseTimeMetrics = await this.getResponseTimeMetrics(from, to);
      for (const metric of responseTimeMetrics) {
        lines.push('# HELP jarvis_response_time_ms Response time in milliseconds');
        lines.push('# TYPE jarvis_response_time_ms histogram');
        lines.push(`jarvis_response_time_ms_sum{model="${metric.model}"} ${metric.sum} ${timestamp}`);
        lines.push(`jarvis_response_time_ms_count{model="${metric.model}"} ${metric.count} ${timestamp}`);
        lines.push(`jarvis_response_time_ms_avg{model="${metric.model}"} ${metric.avg} ${timestamp}`);
        lines.push(`jarvis_response_time_ms_min{model="${metric.model}"} ${metric.min} ${timestamp}`);
        lines.push(`jarvis_response_time_ms_max{model="${metric.model}"} ${metric.max} ${timestamp}`);
        lines.push('');
      }

      // Token usage metrics
      const tokenMetrics = await this.getTokenUsageMetrics(from, to);
      for (const metric of tokenMetrics) {
        lines.push('# HELP jarvis_token_usage_total Total token usage by model');
        lines.push('# TYPE jarvis_token_usage_total counter');
        lines.push(`jarvis_token_usage_total{model="${metric.model}",type="prompt"} ${metric.totalPromptTokens} ${timestamp}`);
        lines.push(`jarvis_token_usage_total{model="${metric.model}",type="completion"} ${metric.totalCompletionTokens} ${timestamp}`);
        lines.push(`jarvis_token_usage_total{model="${metric.model}",type="total"} ${metric.totalTokens} ${timestamp}`);
        lines.push('');
      }

      // Intent classification metrics
      const intentMetrics = await this.getIntentMetrics(from, to);
      for (const metric of intentMetrics) {
        lines.push('# HELP jarvis_intent_classifications_total Total intent classifications');
        lines.push('# TYPE jarvis_intent_classifications_total counter');
        lines.push(`jarvis_intent_classifications_total{parent="${metric.parentIntent}",child="${metric.childIntent}"} ${metric.count} ${timestamp}`);
        lines.push('');

        lines.push('# HELP jarvis_intent_confidence Average confidence score');
        lines.push('# TYPE jarvis_intent_confidence gauge');
        lines.push(`jarvis_intent_confidence{parent="${metric.parentIntent}",child="${metric.childIntent}"} ${metric.avgConfidence} ${timestamp}`);
        lines.push('');
      }

      // Queue metrics
      const queueMetrics = await this.getQueueMetrics();
      for (const metric of queueMetrics) {
        lines.push('# HELP jarvis_queue_items Queue items by status');
        lines.push('# TYPE jarvis_queue_items gauge');
        lines.push(`jarvis_queue_items{status="${metric.status}"} ${metric.count} ${timestamp}`);
        lines.push('');
      }

      // Cache metrics
      const cacheMetrics = await this.getCacheMetrics();
      lines.push('# HELP jarvis_cache_entries Total cache entries');
      lines.push('# TYPE jarvis_cache_entries gauge');
      lines.push(`jarvis_cache_entries ${cacheMetrics.totalEntries} ${timestamp}`);
      lines.push('');

      lines.push('# HELP jarvis_cache_hits_total Total cache hits');
      lines.push('# TYPE jarvis_cache_hits_total counter');
      lines.push(`jarvis_cache_hits_total ${cacheMetrics.totalHits} ${timestamp}`);
      lines.push('');

      lines.push('# HELP jarvis_cache_hit_rate Cache hit rate percentage');
      lines.push('# TYPE jarvis_cache_hit_rate gauge');
      lines.push(`jarvis_cache_hit_rate ${cacheMetrics.hitRate} ${timestamp}`);
      lines.push('');

      // Dead letter queue metrics (if repository is set)
      if (this.dlqRepo) {
        const dlqMetrics = await this.getDLQMetrics();
        lines.push('# HELP jarvis_dlq_total Total items in dead letter queue');
        lines.push('# TYPE jarvis_dlq_total gauge');
        lines.push(`jarvis_dlq_total ${dlqMetrics.total} ${timestamp}`);
        lines.push('');

        for (const [reason, count] of Object.entries(dlqMetrics.byReason)) {
          lines.push('# HELP jarvis_dlq_by_reason Dead letter queue items by reason');
          lines.push('# TYPE jarvis_dlq_by_reason gauge');
          lines.push(`jarvis_dlq_by_reason{reason="${reason}"} ${count} ${timestamp}`);
          lines.push('');
        }

        lines.push('# HELP jarvis_dlq_recent_failures Failures in the last hour');
        lines.push('# TYPE jarvis_dlq_recent_failures gauge');
        lines.push(`jarvis_dlq_recent_failures ${dlqMetrics.recentFailures} ${timestamp}`);
        lines.push('');
      }

      // Circuit breaker metrics (if repository is set)
      if (this.circuitBreakerRepo) {
        const cbMetrics = await this.getCircuitBreakerMetrics();
        for (const metric of cbMetrics) {
          lines.push('# HELP jarvis_circuit_breaker_state Circuit breaker state (0=CLOSED, 1=OPEN, 2=HALF_OPEN)');
          lines.push('# TYPE jarvis_circuit_breaker_state gauge');
          const stateValue = metric.state === 'CLOSED' ? 0 : metric.state === 'OPEN' ? 1 : 2;
          lines.push(`jarvis_circuit_breaker_state{service="${metric.serviceName}"} ${stateValue} ${timestamp}`);
          lines.push('');

          lines.push('# HELP jarvis_circuit_breaker_failures Total failures');
          lines.push('# TYPE jarvis_circuit_breaker_failures counter');
          lines.push(`jarvis_circuit_breaker_failures{service="${metric.serviceName}"} ${metric.failureCount} ${timestamp}`);
          lines.push('');

          lines.push('# HELP jarvis_circuit_breaker_successes Total successes');
          lines.push('# TYPE jarvis_circuit_breaker_successes counter');
          lines.push(`jarvis_circuit_breaker_successes{service="${metric.serviceName}"} ${metric.successCount} ${timestamp}`);
          lines.push('');
        }
      }

      logger.info('[MetricsExporter] Prometheus export complete', {
        lines: lines.length,
        metrics: responseTimeMetrics.length + tokenMetrics.length + intentMetrics.length + queueMetrics.length + 1
      });

      return lines.join('\n');
    } catch (error) {
      logger.error('[MetricsExporter] Failed to export Prometheus metrics', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Export all metrics in JSON format
   *
   * @param from - Start timestamp (Unix seconds)
   * @param to - End timestamp (Unix seconds)
   * @returns JSON object with all metrics
   */
  async exportJSON(from?: number, to?: number): Promise<Record<string, unknown>> {
    logger.info('[MetricsExporter] Exporting JSON format', { from, to });

    try {
      const [
        responseTime,
        tokenUsage,
        intents,
        queueStats,
        cacheStats,
        intentStats,
      ] = await Promise.all([
        this.getResponseTimeMetrics(from, to),
        this.getTokenUsageMetrics(from, to),
        this.getIntentMetrics(from, to),
        this.getQueueMetrics(),
        this.getCacheMetrics(),
        this.intentLogRepo.getAccuracyStats({
          startDate: from ? new Date(from * 1000) : undefined,
          endDate: to ? new Date(to * 1000) : undefined,
        }),
      ]);

      const result = {
        timestamp: Math.floor(Date.now() / 1000),
        timeRange: {
          from: from || null,
          to: to || null,
        },
        metrics: {
          responseTime: {
            byModel: responseTime.reduce((acc, m) => {
              acc[m.model] = {
                count: m.count,
                sum: m.sum,
                avg: m.avg,
                min: m.min,
                max: m.max,
              };
              return acc;
            }, {} as Record<string, unknown>),
          },
          tokenUsage: {
            byModel: tokenUsage.reduce((acc, m) => {
              acc[m.model] = {
                promptTokens: m.totalPromptTokens,
                completionTokens: m.totalCompletionTokens,
                totalTokens: m.totalTokens,
                count: m.count,
              };
              return acc;
            }, {} as Record<string, unknown>),
          },
          intents: {
            classifications: intents.reduce((acc, m) => {
              const key = `${m.parentIntent}:${m.childIntent}`;
              acc[key] = {
                count: m.count,
                avgConfidence: m.avgConfidence,
                avgDuration: m.avgDuration,
              };
              return acc;
            }, {} as Record<string, unknown>),
            accuracy: intentStats,
          },
          queue: {
            byStatus: queueStats.reduce((acc, m) => {
              acc[m.status] = m.count;
              return acc;
            }, {} as Record<string, number>),
          },
          cache: cacheStats,
        },
      };

      logger.info('[MetricsExporter] JSON export complete', {
        responseTimeModels: responseTime.length,
        tokenModels: tokenUsage.length,
        intentTypes: intents.length,
      });

      return result;
    } catch (error) {
      logger.error('[MetricsExporter] Failed to export JSON metrics', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Export a specific metric as CSV
   *
   * @param name - Metric name ('response_time', 'token_usage', 'intents', 'queue', 'cache')
   * @param from - Start timestamp (Unix seconds)
   * @param to - End timestamp (Unix seconds)
   * @returns CSV-formatted string
   */
  async exportCSV(name: string, from?: number, to?: number): Promise<string> {
    logger.info('[MetricsExporter] Exporting CSV format', { name, from, to });

    try {
      switch (name) {
        case 'response_time':
          return this.exportResponseTimeCSV(from, to);
        case 'token_usage':
          return this.exportTokenUsageCSV(from, to);
        case 'intents':
          return this.exportIntentsCSV(from, to);
        case 'queue':
          return this.exportQueueCSV();
        case 'cache':
          return this.exportCacheCSV();
        default:
          throw new Error(`Unknown metric name: ${name}`);
      }
    } catch (error) {
      logger.error('[MetricsExporter] Failed to export CSV metrics', {
        name,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Get response time metrics aggregated by model
   */
  private async getResponseTimeMetrics(from?: number, to?: number): Promise<ResponseTimeMetric[]> {
    const conditions = [];

    if (from) {
      conditions.push(gte(llmResponses.createdAt, new Date(from * 1000)));
    }
    if (to) {
      conditions.push(lte(llmResponses.createdAt, new Date(to * 1000)));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const results = await db
      .select({
        model: llmResponses.model,
        count: sql<number>`count(*)`,
        sum: sql<number>`sum(${llmResponses.durationMs})`,
        min: sql<number>`min(${llmResponses.durationMs})`,
        max: sql<number>`max(${llmResponses.durationMs})`,
        avg: sql<number>`avg(${llmResponses.durationMs})`,
      })
      .from(llmResponses)
      .where(whereClause)
      .groupBy(llmResponses.model);

    return results.map(r => ({
      model: r.model,
      count: r.count || 0,
      sum: r.sum || 0,
      min: r.min || 0,
      max: r.max || 0,
      avg: r.avg || 0,
    }));
  }

  /**
   * Get token usage metrics aggregated by model
   */
  private async getTokenUsageMetrics(from?: number, to?: number): Promise<TokenUsageMetric[]> {
    const conditions = [];

    if (from) {
      conditions.push(gte(llmResponses.createdAt, new Date(from * 1000)));
    }
    if (to) {
      conditions.push(lte(llmResponses.createdAt, new Date(to * 1000)));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const results = await db
      .select({
        model: llmResponses.model,
        totalPromptTokens: sql<number>`sum(COALESCE(${llmResponses.promptTokens}, 0))`,
        totalCompletionTokens: sql<number>`sum(COALESCE(${llmResponses.completionTokens}, 0))`,
        count: sql<number>`count(*)`,
      })
      .from(llmResponses)
      .where(whereClause)
      .groupBy(llmResponses.model);

    return results.map(r => ({
      model: r.model,
      totalPromptTokens: r.totalPromptTokens || 0,
      totalCompletionTokens: r.totalCompletionTokens || 0,
      totalTokens: (r.totalPromptTokens || 0) + (r.totalCompletionTokens || 0),
      count: r.count || 0,
    }));
  }

  /**
   * Get intent classification metrics
   */
  private async getIntentMetrics(from?: number, to?: number): Promise<IntentMetric[]> {
    const conditions = [];

    if (from) {
      conditions.push(gte(intentClassificationLogs.createdAt, new Date(from * 1000)));
    }
    if (to) {
      conditions.push(lte(intentClassificationLogs.createdAt, new Date(to * 1000)));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const results = await db
      .select({
        parentIntent: intentClassificationLogs.parentIntent,
        childIntent: intentClassificationLogs.childIntent,
        count: sql<number>`count(*)`,
        avgConfidence: sql<number>`avg(COALESCE(${intentClassificationLogs.confidence}, 0))`,
        avgDuration: sql<number>`avg(COALESCE(${intentClassificationLogs.durationMs}, 0))`,
      })
      .from(intentClassificationLogs)
      .where(whereClause)
      .groupBy(intentClassificationLogs.parentIntent, intentClassificationLogs.childIntent);

    return results.map(r => ({
      parentIntent: r.parentIntent || 'unknown',
      childIntent: r.childIntent || 'unknown',
      count: r.count || 0,
      avgConfidence: r.avgConfidence || 0,
      avgDuration: r.avgDuration || 0,
    }));
  }

  /**
   * Get queue metrics
   */
  private async getQueueMetrics(): Promise<QueueMetric[]> {
    const stats = await this.queueRepo.getStats();

    return Object.entries(stats).map(([status, count]) => ({
      status,
      count,
    }));
  }

  /**
   * Get cache metrics
   */
  private async getCacheMetrics(): Promise<CacheMetric> {
    const stats = await this.cacheRepo.getStats();

    // Calculate hit rate
    const hitRate = stats.totalEntries > 0
      ? (stats.totalHits / stats.totalEntries) * 100
      : 0;

    return {
      ...stats,
      hitRate,
    };
  }

  /**
   * Export response time metrics as CSV
   */
  private async exportResponseTimeCSV(from?: number, to?: number): Promise<string> {
    const metrics = await this.getResponseTimeMetrics(from, to);

    const lines = [
      'model,count,sum_ms,avg_ms,min_ms,max_ms',
      ...metrics.map(m =>
        `${m.model},${m.count},${m.sum},${m.avg},${m.min},${m.max}`
      ),
    ];

    return lines.join('\n');
  }

  /**
   * Export token usage metrics as CSV
   */
  private async exportTokenUsageCSV(from?: number, to?: number): Promise<string> {
    const metrics = await this.getTokenUsageMetrics(from, to);

    const lines = [
      'model,count,prompt_tokens,completion_tokens,total_tokens',
      ...metrics.map(m =>
        `${m.model},${m.count},${m.totalPromptTokens},${m.totalCompletionTokens},${m.totalTokens}`
      ),
    ];

    return lines.join('\n');
  }

  /**
   * Export intent classification metrics as CSV
   */
  private async exportIntentsCSV(from?: number, to?: number): Promise<string> {
    const metrics = await this.getIntentMetrics(from, to);

    const lines = [
      'parent_intent,child_intent,count,avg_confidence,avg_duration_ms',
      ...metrics.map(m =>
        `${m.parentIntent},${m.childIntent},${m.count},${m.avgConfidence},${m.avgDuration}`
      ),
    ];

    return lines.join('\n');
  }

  /**
   * Export queue metrics as CSV
   */
  private async exportQueueCSV(): Promise<string> {
    const metrics = await this.getQueueMetrics();

    const lines = [
      'status,count',
      ...metrics.map(m => `${m.status},${m.count}`),
    ];

    return lines.join('\n');
  }

  /**
   * Export cache metrics as CSV
   */
  private async exportCacheCSV(): Promise<string> {
    const metrics = await this.getCacheMetrics();

    const lines = [
      'metric,value',
      `total_entries,${metrics.totalEntries}`,
      `total_hits,${metrics.totalHits}`,
      `avg_hit_count,${metrics.avgHitCount}`,
      `hit_rate_percent,${metrics.hitRate}`,
      '',
      'intent,count',
      ...Object.entries(metrics.entriesByIntent).map(([intent, count]) =>
        `${intent},${count}`
      ),
      '',
      'model,count',
      ...Object.entries(metrics.entriesByModel).map(([model, count]) =>
        `${model},${count}`
      ),
    ];

    return lines.join('\n');
  }

  /**
   * Get dead letter queue metrics
   */
  private async getDLQMetrics(): Promise<DLQMetric> {
    if (!this.dlqRepo) {
      return { total: 0, byReason: {}, recentFailures: 0 };
    }

    const stats = await this.dlqRepo.getStats();

    // Get recent failures (last hour)
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    const allItems = await this.dlqRepo.getAll({ limit: 1000 });
    const recentFailures = allItems.filter(
      (item) => item.createdAt.getTime() > oneHourAgo
    ).length;

    return {
      total: stats.total,
      byReason: stats.byReason,
      recentFailures,
    };
  }

  /**
   * Get circuit breaker metrics
   */
  private async getCircuitBreakerMetrics(): Promise<CircuitBreakerMetric[]> {
    if (!this.circuitBreakerRepo) {
      return [];
    }

    const allBreakers = await this.circuitBreakerRepo.findAll();

    return allBreakers.map((cb) => ({
      serviceName: cb.serviceName,
      state: cb.state,
      failureCount: cb.failureCount,
      successCount: cb.successCount,
    }));
  }
}
