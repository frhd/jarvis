#!/usr/bin/env npx tsx
/**
 * Dashboard Service Tests
 *
 * Comprehensive tests for the dashboard service that aggregates metrics
 * from various repositories (metrics, queue, intent logs) to provide
 * analytics and visualization data.
 *
 * Tests cover:
 * - Summary statistics aggregation
 * - Response time charts with time ranges
 * - Token usage aggregation
 * - Intent accuracy calculations
 * - Queue status monitoring
 * - Cache performance metrics
 * - User engagement analytics
 * - Time range parsing helpers
 * - Interval calculation logic
 * - Edge cases (empty data, single points, large ranges)
 *
 * Run: npx tsx tests/dashboard/dashboard.service.test.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MetricsRepository } from '../../src/repositories/metrics.repository';
import type { QueueRepository } from '../../src/repositories/queue.repository';
import type { IntentLogRepository } from '../../src/repositories/intentLog.repository';
import type { MetricStats } from '../../src/types/metrics.types';

// ============================================================================
// Mock Dashboard Service
// ============================================================================

/**
 * Dashboard service interface (to be implemented)
 * This represents the expected API for the dashboard service
 */
interface TimeRange {
  from: number;
  to: number;
}

interface ChartDataPoint {
  timestamp: number;
  value: number;
  label?: string;
}

interface SummaryStats {
  totalMessages: number;
  averageResponseTime: number;
  cacheHitRate: number;
  queueDepth: number;
  activeUsers: number;
  intentAccuracy: number;
}

interface ResponseTimeChartData {
  dataPoints: ChartDataPoint[];
  average: number;
  p95: number;
  p99: number;
  interval: string;
}

interface TokenUsageChartData {
  dataPoints: ChartDataPoint[];
  totalTokens: number;
  averagePerMessage: number;
}

interface IntentAccuracyChartData {
  byIntent: Array<{
    intent: string;
    accuracy: number;
    count: number;
  }>;
  overall: number;
  byMethod: {
    pattern: number;
    llm: number;
    escalated: number;
  };
}

interface QueueStatusChartData {
  current: {
    pending: number;
    processing: number;
    completed: number;
    failed: number;
  };
  trends: ChartDataPoint[];
}

interface CachePerformanceChartData {
  hitRate: number;
  dataPoints: ChartDataPoint[];
  totalHits: number;
  totalMisses: number;
}

interface UserEngagementMetrics {
  totalUsers: number;
  activeUsers: number;
  messagesByUser: Array<{
    userId: string;
    messageCount: number;
    lastActive: number;
  }>;
  topIntents: Array<{
    intent: string;
    count: number;
  }>;
}

/**
 * Mock Dashboard Service implementation for testing
 */
class DashboardService {
  constructor(
    private metricsRepo: MetricsRepository,
    private queueRepo: QueueRepository,
    private intentLogRepo: IntentLogRepository
  ) {}

  /**
   * Get summary statistics for dashboard overview
   */
  async getSummary(timeRange?: TimeRange): Promise<SummaryStats> {
    const from = timeRange?.from;
    const to = timeRange?.to;

    const [
      responseTimeStats,
      cacheStats,
      queueStats,
      intentStats,
    ] = await Promise.all([
      this.metricsRepo.getStats('response_time_ms', from, to),
      this.getCacheHitRate(from, to),
      this.queueRepo.getStats(),
      this.intentLogRepo.getAccuracyStats({
        startDate: from ? new Date(from) : undefined,
        endDate: to ? new Date(to) : undefined,
      }),
    ]);

    return {
      totalMessages: responseTimeStats?.count || 0,
      averageResponseTime: responseTimeStats?.avg || 0,
      cacheHitRate: cacheStats,
      queueDepth: queueStats.pending + queueStats.processing,
      activeUsers: 0, // Would need user activity tracking
      intentAccuracy: intentStats.accuracyRate,
    };
  }

  /**
   * Get response time chart data with configurable time range
   */
  async getResponseTimeChart(timeRange: TimeRange): Promise<ResponseTimeChartData> {
    const stats = await this.metricsRepo.getStats('response_time_ms', timeRange.from, timeRange.to);
    const metrics = await this.metricsRepo.getMetrics(
      'response_time_ms',
      timeRange.from,
      timeRange.to
    );

    const interval = this.calculateInterval(timeRange);
    const dataPoints = this.aggregateByInterval(metrics, interval);

    return {
      dataPoints,
      average: stats?.avg || 0,
      p95: stats?.p95 || 0,
      p99: stats?.p99 || 0,
      interval,
    };
  }

  /**
   * Get token usage chart data with aggregation
   */
  async getTokenUsageChart(timeRange: TimeRange): Promise<TokenUsageChartData> {
    const stats = await this.metricsRepo.getStats('token_usage_total', timeRange.from, timeRange.to);
    const metrics = await this.metricsRepo.getMetrics(
      'token_usage_total',
      timeRange.from,
      timeRange.to
    );

    const interval = this.calculateInterval(timeRange);
    const dataPoints = this.aggregateByInterval(metrics, interval);

    return {
      dataPoints,
      totalTokens: stats?.sum || 0,
      averagePerMessage: stats?.avg || 0,
    };
  }

  /**
   * Get intent accuracy chart data with breakdown
   */
  async getIntentAccuracyChart(timeRange?: TimeRange): Promise<IntentAccuracyChartData> {
    const stats = await this.intentLogRepo.getAccuracyStats({
      startDate: timeRange?.from ? new Date(timeRange.from) : undefined,
      endDate: timeRange?.to ? new Date(timeRange.to) : undefined,
    });

    // Mock intent-specific accuracy (would need real data)
    const byIntent = [
      { intent: 'simple_greeting', accuracy: stats.byConfidenceLevel.high.accuracyRate, count: stats.byConfidenceLevel.high.count },
      { intent: 'factual_question', accuracy: stats.byConfidenceLevel.medium.accuracyRate, count: stats.byConfidenceLevel.medium.count },
    ];

    return {
      byIntent,
      overall: stats.accuracyRate,
      byMethod: {
        pattern: stats.byMethod.pattern.accuracyRate,
        llm: stats.byMethod.llm.accuracyRate,
        escalated: stats.byMethod.escalated.accuracyRate,
      },
    };
  }

  /**
   * Get queue status chart data
   */
  async getQueueStatusChart(): Promise<QueueStatusChartData> {
    const current = await this.queueRepo.getStats();

    // Mock trend data (would need historical tracking)
    const trends: ChartDataPoint[] = [];

    return {
      current,
      trends,
    };
  }

  /**
   * Get cache performance chart data
   */
  async getCachePerformanceChart(timeRange: TimeRange): Promise<CachePerformanceChartData> {
    const [hitsStats, missesStats] = await Promise.all([
      this.metricsRepo.getStats('cache_hit', timeRange.from, timeRange.to),
      this.metricsRepo.getStats('cache_miss', timeRange.from, timeRange.to),
    ]);

    const totalHits = hitsStats?.sum || 0;
    const totalMisses = missesStats?.sum || 0;
    const total = totalHits + totalMisses;
    const hitRate = total > 0 ? (totalHits / total) * 100 : 0;

    const [hitMetrics, missMetrics] = await Promise.all([
      this.metricsRepo.getMetrics('cache_hit', timeRange.from, timeRange.to),
      this.metricsRepo.getMetrics('cache_miss', timeRange.from, timeRange.to),
    ]);

    const interval = this.calculateInterval(timeRange);
    const hitPoints = this.aggregateByInterval(hitMetrics, interval);
    const missPoints = this.aggregateByInterval(missMetrics, interval);

    // Calculate hit rate for each time bucket
    const dataPoints = hitPoints.map((hitPoint, idx) => {
      const missPoint = missPoints[idx];
      const hits = hitPoint.value;
      const misses = missPoint?.value || 0;
      const bucketTotal = hits + misses;
      const bucketHitRate = bucketTotal > 0 ? (hits / bucketTotal) * 100 : 0;

      return {
        timestamp: hitPoint.timestamp,
        value: bucketHitRate,
      };
    });

    return {
      hitRate,
      dataPoints,
      totalHits,
      totalMisses,
    };
  }

  /**
   * Get user engagement metrics
   */
  async getUserEngagementMetrics(timeRange?: TimeRange): Promise<UserEngagementMetrics> {
    // Mock implementation (would need user activity tracking)
    return {
      totalUsers: 0,
      activeUsers: 0,
      messagesByUser: [],
      topIntents: [],
    };
  }

  /**
   * Parse time range presets (last_hour, last_24h, last_7d, last_30d)
   */
  parseTimeRange(preset: string): TimeRange {
    const now = Date.now();
    let from: number;

    switch (preset) {
      case 'last_hour':
        from = now - 60 * 60 * 1000;
        break;
      case 'last_24h':
        from = now - 24 * 60 * 60 * 1000;
        break;
      case 'last_7d':
        from = now - 7 * 24 * 60 * 60 * 1000;
        break;
      case 'last_30d':
        from = now - 30 * 24 * 60 * 60 * 1000;
        break;
      default:
        from = now - 24 * 60 * 60 * 1000; // Default to last 24h
    }

    return { from, to: now };
  }

  /**
   * Calculate appropriate interval for time range
   */
  calculateInterval(timeRange: TimeRange): string {
    const duration = timeRange.to - timeRange.from;
    const hour = 60 * 60 * 1000;
    const day = 24 * hour;

    if (duration <= hour) {
      return 'minute';
    } else if (duration <= 24 * hour) {
      return 'hour';
    } else if (duration <= 7 * day) {
      return '6hour';
    } else {
      return 'day';
    }
  }

  /**
   * Aggregate metrics by time interval
   */
  private aggregateByInterval(
    metrics: any[],
    interval: string
  ): ChartDataPoint[] {
    if (metrics.length === 0) return [];

    const buckets = new Map<number, { sum: number; count: number }>();

    metrics.forEach((metric) => {
      const timestamp = metric.timestamp instanceof Date
        ? metric.timestamp.getTime()
        : metric.timestamp;
      const bucketTime = this.getBucketTime(timestamp, interval);

      if (!buckets.has(bucketTime)) {
        buckets.set(bucketTime, { sum: 0, count: 0 });
      }

      const bucket = buckets.get(bucketTime)!;
      bucket.sum += metric.value;
      bucket.count++;
    });

    return Array.from(buckets.entries())
      .map(([timestamp, { sum, count }]) => ({
        timestamp,
        value: sum / count, // Average for the bucket
      }))
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Get bucket time for aggregation
   */
  private getBucketTime(timestamp: number, interval: string): number {
    const date = new Date(timestamp);

    switch (interval) {
      case 'minute':
        date.setSeconds(0, 0);
        break;
      case 'hour':
        date.setMinutes(0, 0, 0);
        break;
      case '6hour':
        date.setHours(Math.floor(date.getHours() / 6) * 6, 0, 0, 0);
        break;
      case 'day':
        date.setHours(0, 0, 0, 0);
        break;
    }

    return date.getTime();
  }

  /**
   * Calculate cache hit rate
   */
  private async getCacheHitRate(from?: number, to?: number): Promise<number> {
    const [hitsStats, missesStats] = await Promise.all([
      this.metricsRepo.getStats('cache_hit', from, to),
      this.metricsRepo.getStats('cache_miss', from, to),
    ]);

    const totalHits = hitsStats?.sum || 0;
    const totalMisses = missesStats?.sum || 0;
    const total = totalHits + totalMisses;

    return total > 0 ? (totalHits / total) * 100 : 0;
  }
}

// ============================================================================
// Test Setup
// ============================================================================

describe('DashboardService', () => {
  let dashboardService: DashboardService;
  let mockMetricsRepo: any;
  let mockQueueRepo: any;
  let mockIntentLogRepo: any;

  beforeEach(() => {
    // Mock MetricsRepository
    mockMetricsRepo = {
      getStats: vi.fn(),
      getMetrics: vi.fn(),
      getStatsByLabel: vi.fn(),
    };

    // Mock QueueRepository
    mockQueueRepo = {
      getStats: vi.fn(),
    };

    // Mock IntentLogRepository
    mockIntentLogRepo = {
      getAccuracyStats: vi.fn(),
      getConfidenceDistribution: vi.fn(),
      getEscalationRate: vi.fn(),
    };

    dashboardService = new DashboardService(
      mockMetricsRepo as unknown as MetricsRepository,
      mockQueueRepo as unknown as QueueRepository,
      mockIntentLogRepo as unknown as IntentLogRepository
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ============================================================================
  // getSummary() Tests
  // ============================================================================

  describe('getSummary()', () => {
    it('should return all expected summary fields', async () => {
      mockMetricsRepo.getStats.mockResolvedValueOnce({
        count: 100,
        sum: 50000,
        min: 200,
        max: 2000,
        avg: 500,
      } as MetricStats);

      mockMetricsRepo.getStats.mockResolvedValueOnce({
        sum: 80,
      } as MetricStats);

      mockMetricsRepo.getStats.mockResolvedValueOnce({
        sum: 20,
      } as MetricStats);

      mockQueueRepo.getStats.mockResolvedValueOnce({
        pending: 5,
        processing: 2,
        completed: 150,
        failed: 3,
      });

      mockIntentLogRepo.getAccuracyStats.mockResolvedValueOnce({
        totalClassifications: 100,
        accuracyRate: 95.5,
        byMethod: {
          pattern: { accuracyRate: 98 },
          llm: { accuracyRate: 92 },
          escalated: { accuracyRate: 85 },
        },
      });

      const summary = await dashboardService.getSummary();

      expect(summary).toHaveProperty('totalMessages');
      expect(summary).toHaveProperty('averageResponseTime');
      expect(summary).toHaveProperty('cacheHitRate');
      expect(summary).toHaveProperty('queueDepth');
      expect(summary).toHaveProperty('activeUsers');
      expect(summary).toHaveProperty('intentAccuracy');

      expect(summary.totalMessages).toBe(100);
      expect(summary.averageResponseTime).toBe(500);
      expect(summary.cacheHitRate).toBe(80); // 80/(80+20) = 80%
      expect(summary.queueDepth).toBe(7); // 5 + 2
      expect(summary.intentAccuracy).toBe(95.5);
    });

    it('should handle empty metrics gracefully', async () => {
      mockMetricsRepo.getStats.mockResolvedValue(null);
      mockQueueRepo.getStats.mockResolvedValueOnce({
        pending: 0,
        processing: 0,
        completed: 0,
        failed: 0,
      });
      mockIntentLogRepo.getAccuracyStats.mockResolvedValueOnce({
        accuracyRate: 0,
        byMethod: {
          pattern: { accuracyRate: 0 },
          llm: { accuracyRate: 0 },
          escalated: { accuracyRate: 0 },
        },
      });

      const summary = await dashboardService.getSummary();

      expect(summary.totalMessages).toBe(0);
      expect(summary.averageResponseTime).toBe(0);
      expect(summary.cacheHitRate).toBe(0);
    });

    it('should respect time range filters', async () => {
      const timeRange = {
        from: Date.now() - 60 * 60 * 1000,
        to: Date.now(),
      };

      mockMetricsRepo.getStats.mockResolvedValue({ count: 50, avg: 300 } as MetricStats);
      mockQueueRepo.getStats.mockResolvedValue({
        pending: 1,
        processing: 0,
        completed: 50,
        failed: 0,
      });
      mockIntentLogRepo.getAccuracyStats.mockResolvedValue({
        accuracyRate: 90,
        byMethod: { pattern: { accuracyRate: 95 }, llm: { accuracyRate: 85 }, escalated: { accuracyRate: 80 } },
      });

      await dashboardService.getSummary(timeRange);

      expect(mockMetricsRepo.getStats).toHaveBeenCalledWith(
        'response_time_ms',
        timeRange.from,
        timeRange.to
      );
    });
  });

  // ============================================================================
  // getResponseTimeChart() Tests
  // ============================================================================

  describe('getResponseTimeChart()', () => {
    it('should return chart data with various time ranges', async () => {
      const timeRange = {
        from: Date.now() - 24 * 60 * 60 * 1000,
        to: Date.now(),
      };

      mockMetricsRepo.getStats.mockResolvedValueOnce({
        avg: 450,
        p95: 1200,
        p99: 2000,
      } as MetricStats);

      mockMetricsRepo.getMetrics.mockResolvedValueOnce([
        { timestamp: new Date(timeRange.from + 1000), value: 400 },
        { timestamp: new Date(timeRange.from + 2000), value: 500 },
      ]);

      const chartData = await dashboardService.getResponseTimeChart(timeRange);

      expect(chartData).toHaveProperty('dataPoints');
      expect(chartData).toHaveProperty('average');
      expect(chartData).toHaveProperty('p95');
      expect(chartData).toHaveProperty('p99');
      expect(chartData).toHaveProperty('interval');

      expect(chartData.average).toBe(450);
      expect(chartData.p95).toBe(1200);
      expect(chartData.p99).toBe(2000);
      expect(chartData.interval).toBe('hour'); // 24h range
    });

    it('should aggregate data points by calculated interval', async () => {
      const now = Date.now();
      const timeRange = { from: now - 60 * 60 * 1000, to: now };

      mockMetricsRepo.getStats.mockResolvedValueOnce({
        avg: 500,
        p95: 1000,
        p99: 1500,
      } as MetricStats);

      const minuteTime = now - 30 * 60 * 1000;
      mockMetricsRepo.getMetrics.mockResolvedValueOnce([
        { timestamp: new Date(minuteTime), value: 400 },
        { timestamp: new Date(minuteTime + 1000), value: 600 },
        { timestamp: new Date(minuteTime + 60000), value: 500 },
      ]);

      const chartData = await dashboardService.getResponseTimeChart(timeRange);

      expect(chartData.dataPoints.length).toBeGreaterThan(0);
      expect(chartData.interval).toBe('minute'); // 1h range
    });

    it('should handle empty data', async () => {
      const timeRange = { from: Date.now() - 1000, to: Date.now() };

      mockMetricsRepo.getStats.mockResolvedValueOnce(null);
      mockMetricsRepo.getMetrics.mockResolvedValueOnce([]);

      const chartData = await dashboardService.getResponseTimeChart(timeRange);

      expect(chartData.dataPoints).toEqual([]);
      expect(chartData.average).toBe(0);
      expect(chartData.p95).toBe(0);
    });
  });

  // ============================================================================
  // getTokenUsageChart() Tests
  // ============================================================================

  describe('getTokenUsageChart()', () => {
    it('should aggregate token usage correctly', async () => {
      const timeRange = {
        from: Date.now() - 24 * 60 * 60 * 1000,
        to: Date.now(),
      };

      mockMetricsRepo.getStats.mockResolvedValueOnce({
        sum: 50000,
        avg: 500,
      } as MetricStats);

      mockMetricsRepo.getMetrics.mockResolvedValueOnce([
        { timestamp: new Date(), value: 1000 },
        { timestamp: new Date(), value: 2000 },
      ]);

      const chartData = await dashboardService.getTokenUsageChart(timeRange);

      expect(chartData).toHaveProperty('dataPoints');
      expect(chartData).toHaveProperty('totalTokens');
      expect(chartData).toHaveProperty('averagePerMessage');

      expect(chartData.totalTokens).toBe(50000);
      expect(chartData.averagePerMessage).toBe(500);
    });

    it('should handle zero token usage', async () => {
      const timeRange = { from: Date.now() - 1000, to: Date.now() };

      mockMetricsRepo.getStats.mockResolvedValueOnce(null);
      mockMetricsRepo.getMetrics.mockResolvedValueOnce([]);

      const chartData = await dashboardService.getTokenUsageChart(timeRange);

      expect(chartData.totalTokens).toBe(0);
      expect(chartData.averagePerMessage).toBe(0);
      expect(chartData.dataPoints).toEqual([]);
    });
  });

  // ============================================================================
  // getIntentAccuracyChart() Tests
  // ============================================================================

  describe('getIntentAccuracyChart()', () => {
    it('should calculate intent accuracy properly', async () => {
      mockIntentLogRepo.getAccuracyStats.mockResolvedValueOnce({
        accuracyRate: 92.5,
        byMethod: {
          pattern: { accuracyRate: 98.5 },
          llm: { accuracyRate: 88.0 },
          escalated: { accuracyRate: 75.0 },
        },
        byConfidenceLevel: {
          high: { accuracyRate: 99.0, count: 50 },
          medium: { accuracyRate: 85.0, count: 30 },
          low: { accuracyRate: 70.0, count: 15 },
          uncertain: { accuracyRate: 50.0, count: 5 },
        },
      });

      const chartData = await dashboardService.getIntentAccuracyChart();

      expect(chartData).toHaveProperty('byIntent');
      expect(chartData).toHaveProperty('overall');
      expect(chartData).toHaveProperty('byMethod');

      expect(chartData.overall).toBe(92.5);
      expect(chartData.byMethod.pattern).toBe(98.5);
      expect(chartData.byMethod.llm).toBe(88.0);
      expect(chartData.byMethod.escalated).toBe(75.0);
    });

    it('should handle no accuracy data', async () => {
      mockIntentLogRepo.getAccuracyStats.mockResolvedValueOnce({
        accuracyRate: 0,
        byMethod: {
          pattern: { accuracyRate: 0 },
          llm: { accuracyRate: 0 },
          escalated: { accuracyRate: 0 },
        },
        byConfidenceLevel: {
          high: { accuracyRate: 0, count: 0 },
          medium: { accuracyRate: 0, count: 0 },
          low: { accuracyRate: 0, count: 0 },
          uncertain: { accuracyRate: 0, count: 0 },
        },
      });

      const chartData = await dashboardService.getIntentAccuracyChart();

      expect(chartData.overall).toBe(0);
      expect(chartData.byMethod.pattern).toBe(0);
    });
  });

  // ============================================================================
  // getQueueStatusChart() Tests
  // ============================================================================

  describe('getQueueStatusChart()', () => {
    it('should return current queue status', async () => {
      mockQueueRepo.getStats.mockResolvedValueOnce({
        pending: 10,
        processing: 3,
        completed: 200,
        failed: 5,
      });

      const chartData = await dashboardService.getQueueStatusChart();

      expect(chartData).toHaveProperty('current');
      expect(chartData).toHaveProperty('trends');

      expect(chartData.current.pending).toBe(10);
      expect(chartData.current.processing).toBe(3);
      expect(chartData.current.completed).toBe(200);
      expect(chartData.current.failed).toBe(5);
    });

    it('should handle empty queue', async () => {
      mockQueueRepo.getStats.mockResolvedValueOnce({
        pending: 0,
        processing: 0,
        completed: 0,
        failed: 0,
      });

      const chartData = await dashboardService.getQueueStatusChart();

      expect(chartData.current.pending).toBe(0);
      expect(chartData.current.processing).toBe(0);
    });
  });

  // ============================================================================
  // getCachePerformanceChart() Tests
  // ============================================================================

  describe('getCachePerformanceChart()', () => {
    it('should calculate cache hit rates correctly', async () => {
      const timeRange = {
        from: Date.now() - 60 * 60 * 1000,
        to: Date.now(),
      };

      mockMetricsRepo.getStats
        .mockResolvedValueOnce({ sum: 80 } as MetricStats) // cache_hit
        .mockResolvedValueOnce({ sum: 20 } as MetricStats); // cache_miss

      mockMetricsRepo.getMetrics
        .mockResolvedValueOnce([
          { timestamp: new Date(), value: 80 },
        ])
        .mockResolvedValueOnce([
          { timestamp: new Date(), value: 20 },
        ]);

      const chartData = await dashboardService.getCachePerformanceChart(timeRange);

      expect(chartData).toHaveProperty('hitRate');
      expect(chartData).toHaveProperty('dataPoints');
      expect(chartData).toHaveProperty('totalHits');
      expect(chartData).toHaveProperty('totalMisses');

      expect(chartData.totalHits).toBe(80);
      expect(chartData.totalMisses).toBe(20);
      expect(chartData.hitRate).toBe(80); // 80/(80+20) = 80%
    });

    it('should handle zero cache activity', async () => {
      const timeRange = { from: Date.now() - 1000, to: Date.now() };

      mockMetricsRepo.getStats
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      mockMetricsRepo.getMetrics
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const chartData = await dashboardService.getCachePerformanceChart(timeRange);

      expect(chartData.hitRate).toBe(0);
      expect(chartData.totalHits).toBe(0);
      expect(chartData.totalMisses).toBe(0);
    });

    it('should calculate hit rate as 100% when no misses', async () => {
      const timeRange = { from: Date.now() - 1000, to: Date.now() };

      mockMetricsRepo.getStats
        .mockResolvedValueOnce({ sum: 100 } as MetricStats)
        .mockResolvedValueOnce({ sum: 0 } as MetricStats);

      mockMetricsRepo.getMetrics
        .mockResolvedValueOnce([{ timestamp: new Date(), value: 100 }])
        .mockResolvedValueOnce([]);

      const chartData = await dashboardService.getCachePerformanceChart(timeRange);

      expect(chartData.hitRate).toBe(100);
    });
  });

  // ============================================================================
  // getUserEngagementMetrics() Tests
  // ============================================================================

  describe('getUserEngagementMetrics()', () => {
    it('should aggregate user engagement data', async () => {
      const metrics = await dashboardService.getUserEngagementMetrics();

      expect(metrics).toHaveProperty('totalUsers');
      expect(metrics).toHaveProperty('activeUsers');
      expect(metrics).toHaveProperty('messagesByUser');
      expect(metrics).toHaveProperty('topIntents');
    });
  });

  // ============================================================================
  // parseTimeRange() Tests
  // ============================================================================

  describe('parseTimeRange()', () => {
    it('should parse last_hour preset correctly', () => {
      const range = dashboardService.parseTimeRange('last_hour');
      const duration = range.to - range.from;

      expect(duration).toBe(60 * 60 * 1000); // 1 hour in ms
      expect(range.to).toBeGreaterThan(range.from);
    });

    it('should parse last_24h preset correctly', () => {
      const range = dashboardService.parseTimeRange('last_24h');
      const duration = range.to - range.from;

      expect(duration).toBe(24 * 60 * 60 * 1000); // 24 hours in ms
    });

    it('should parse last_7d preset correctly', () => {
      const range = dashboardService.parseTimeRange('last_7d');
      const duration = range.to - range.from;

      expect(duration).toBe(7 * 24 * 60 * 60 * 1000); // 7 days in ms
    });

    it('should parse last_30d preset correctly', () => {
      const range = dashboardService.parseTimeRange('last_30d');
      const duration = range.to - range.from;

      expect(duration).toBe(30 * 24 * 60 * 60 * 1000); // 30 days in ms
    });

    it('should default to last_24h for unknown preset', () => {
      const range = dashboardService.parseTimeRange('unknown_preset');
      const duration = range.to - range.from;

      expect(duration).toBe(24 * 60 * 60 * 1000); // Default to 24h
    });
  });

  // ============================================================================
  // calculateInterval() Tests
  // ============================================================================

  describe('calculateInterval()', () => {
    it('should choose minute interval for ranges <= 1 hour', () => {
      const range = {
        from: Date.now() - 60 * 60 * 1000,
        to: Date.now(),
      };

      const interval = dashboardService.calculateInterval(range);
      expect(interval).toBe('minute');
    });

    it('should choose hour interval for ranges <= 24 hours', () => {
      const range = {
        from: Date.now() - 24 * 60 * 60 * 1000,
        to: Date.now(),
      };

      const interval = dashboardService.calculateInterval(range);
      expect(interval).toBe('hour');
    });

    it('should choose 6hour interval for ranges <= 7 days', () => {
      const range = {
        from: Date.now() - 7 * 24 * 60 * 60 * 1000,
        to: Date.now(),
      };

      const interval = dashboardService.calculateInterval(range);
      expect(interval).toBe('6hour');
    });

    it('should choose day interval for ranges > 7 days', () => {
      const range = {
        from: Date.now() - 30 * 24 * 60 * 60 * 1000,
        to: Date.now(),
      };

      const interval = dashboardService.calculateInterval(range);
      expect(interval).toBe('day');
    });
  });

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe('Edge Cases', () => {
    it('should handle empty data sets', async () => {
      mockMetricsRepo.getStats.mockResolvedValue(null);
      mockMetricsRepo.getMetrics.mockResolvedValue([]);
      mockQueueRepo.getStats.mockResolvedValue({
        pending: 0,
        processing: 0,
        completed: 0,
        failed: 0,
      });
      mockIntentLogRepo.getAccuracyStats.mockResolvedValue({
        accuracyRate: 0,
        byMethod: {
          pattern: { accuracyRate: 0 },
          llm: { accuracyRate: 0 },
          escalated: { accuracyRate: 0 },
        },
        byConfidenceLevel: {
          high: { accuracyRate: 0, count: 0 },
          medium: { accuracyRate: 0, count: 0 },
          low: { accuracyRate: 0, count: 0 },
          uncertain: { accuracyRate: 0, count: 0 },
        },
      });

      const timeRange = { from: Date.now() - 1000, to: Date.now() };

      const summary = await dashboardService.getSummary(timeRange);
      const responseChart = await dashboardService.getResponseTimeChart(timeRange);
      const tokenChart = await dashboardService.getTokenUsageChart(timeRange);

      expect(summary.totalMessages).toBe(0);
      expect(responseChart.dataPoints).toEqual([]);
      expect(tokenChart.dataPoints).toEqual([]);
    });

    it('should handle single data point', async () => {
      const timeRange = { from: Date.now() - 1000, to: Date.now() };

      mockMetricsRepo.getStats.mockResolvedValue({
        count: 1,
        sum: 500,
        avg: 500,
        min: 500,
        max: 500,
      } as MetricStats);

      mockMetricsRepo.getMetrics.mockResolvedValue([
        { timestamp: new Date(), value: 500 },
      ]);

      const chartData = await dashboardService.getResponseTimeChart(timeRange);

      expect(chartData.dataPoints.length).toBeGreaterThanOrEqual(1);
      expect(chartData.average).toBe(500);
    });

    it('should handle large time ranges efficiently', async () => {
      const timeRange = {
        from: Date.now() - 365 * 24 * 60 * 60 * 1000, // 1 year
        to: Date.now(),
      };

      mockMetricsRepo.getStats.mockResolvedValue({
        avg: 500,
        p95: 1000,
        p99: 1500,
      } as MetricStats);

      mockMetricsRepo.getMetrics.mockResolvedValue([
        { timestamp: new Date(timeRange.from), value: 400 },
        { timestamp: new Date(timeRange.to), value: 600 },
      ]);

      const interval = dashboardService.calculateInterval(timeRange);
      expect(interval).toBe('day'); // Should use day interval for year-long range

      const chartData = await dashboardService.getResponseTimeChart(timeRange);
      expect(chartData.interval).toBe('day');
    });

    it('should handle null stats from repository', async () => {
      mockMetricsRepo.getStats.mockResolvedValue(null);
      mockMetricsRepo.getMetrics.mockResolvedValue([]);
      mockQueueRepo.getStats.mockResolvedValue({
        pending: 0,
        processing: 0,
        completed: 0,
        failed: 0,
      });
      mockIntentLogRepo.getAccuracyStats.mockResolvedValue({
        accuracyRate: 0,
        byMethod: {
          pattern: { accuracyRate: 0 },
          llm: { accuracyRate: 0 },
          escalated: { accuracyRate: 0 },
        },
      });

      const summary = await dashboardService.getSummary();

      expect(summary.totalMessages).toBe(0);
      expect(summary.averageResponseTime).toBe(0);
      expect(summary.cacheHitRate).toBe(0);
    });

    it('should handle metrics with Date timestamps', async () => {
      const now = Date.now();
      const timeRange = { from: now - 1000, to: now };

      mockMetricsRepo.getStats.mockResolvedValue({
        avg: 500,
      } as MetricStats);

      mockMetricsRepo.getMetrics.mockResolvedValue([
        { timestamp: new Date(now - 500), value: 400 },
        { timestamp: new Date(now - 300), value: 600 },
      ]);

      const chartData = await dashboardService.getResponseTimeChart(timeRange);

      expect(chartData.dataPoints.length).toBeGreaterThan(0);
      chartData.dataPoints.forEach(point => {
        expect(typeof point.timestamp).toBe('number');
      });
    });
  });
});
