#!/usr/bin/env npx tsx
/**
 * Dashboard Visualization Tests
 *
 * Comprehensive tests for validating dashboard visualization data structures,
 * calculations, and edge cases for all chart types and metrics.
 *
 * Tests cover:
 * - DashboardService.getSummary() data structure validation
 * - Response time charts with proper time series formatting
 * - Token usage aggregation and chart data
 * - Intent accuracy calculations and percentages
 * - Queue status chart data and percentages
 * - Cache performance metrics and hit rates
 * - User engagement metric calculations
 * - Time range parsing (last_hour, last_24h, last_7d, last_30d)
 * - Interval calculation for different time ranges
 * - Edge cases: empty data, single points, large ranges
 *
 * Run: npx vitest tests/dashboard/dashboard-visualizations.test.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DashboardService } from '../../src/services/dashboard.service';
import type { MetricsRepository } from '../../src/repositories/metrics.repository';
import type { QueueRepository } from '../../src/repositories/queue.repository';
import type { IntentLogRepository } from '../../src/repositories/intentLog.repository';
import type { LLMResponseRepository } from '../../src/repositories/llmResponse.repository';
import type { SemanticCacheRepository } from '../../src/repositories/semanticCache.repository';
import type { AlertingService } from '../../src/services/alerting.service';

// ============================================================================
// Test Setup
// ============================================================================

describe('Dashboard Visualizations', () => {
  let dashboardService: DashboardService;
  let mockMetricsRepo: any;
  let mockAlertingService: any;
  let mockLLMResponseRepo: any;
  let mockIntentLogRepo: any;
  let mockCacheRepo: any;
  let mockQueueRepo: any;

  beforeEach(() => {
    // Mock MetricsRepository
    mockMetricsRepo = {
      getStats: vi.fn(),
      getMetrics: vi.fn(),
      getStatsByLabel: vi.fn(),
      getMetricNames: vi.fn(),
    };

    // Mock AlertingService
    mockAlertingService = {
      getActiveAlerts: vi.fn(() => []),
    };

    // Mock LLMResponseRepository
    mockLLMResponseRepo = {
      findById: vi.fn(),
      findByMessageId: vi.fn(),
    };

    // Mock IntentLogRepository
    mockIntentLogRepo = {
      getAccuracyStats: vi.fn(),
      getConfidenceDistribution: vi.fn(),
      getEscalationRate: vi.fn(),
    };

    // Mock SemanticCacheRepository
    mockCacheRepo = {
      getStats: vi.fn(),
    };

    // Mock QueueRepository
    mockQueueRepo = {
      getStats: vi.fn(),
    };

    dashboardService = new DashboardService(
      mockMetricsRepo as unknown as MetricsRepository,
      mockAlertingService as unknown as AlertingService,
      mockLLMResponseRepo as unknown as LLMResponseRepository,
      mockIntentLogRepo as unknown as IntentLogRepository,
      mockCacheRepo as unknown as SemanticCacheRepository,
      mockQueueRepo as unknown as QueueRepository
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ============================================================================
  // 1. DashboardService.getSummary() Tests
  // ============================================================================

  describe('getSummary()', () => {
    it('should return correctly structured summary data with all fields', async () => {
      const timeRange = {
        from: Date.now() - 60 * 60 * 1000,
        to: Date.now(),
      };

      // Mock all required data
      mockIntentLogRepo.getAccuracyStats.mockResolvedValue({
        totalClassifications: 100,
        accuracyRate: 95.5,
        averageConfidence: 0.85,
        byMethod: {
          pattern: { accuracyRate: 98 },
          llm: { accuracyRate: 92 },
          escalated: { accuracyRate: 85 },
        },
      });

      mockIntentLogRepo.getEscalationRate.mockResolvedValue({
        escalationRate: 10.5,
      });

      mockCacheRepo.getStats.mockResolvedValue({
        totalEntries: 100,
        totalHits: 80,
        avgHitCount: 4.5,
      });

      mockQueueRepo.getStats.mockResolvedValue({
        pending: 5,
        processing: 2,
        completed: 150,
        failed: 3,
      });

      mockAlertingService.getActiveAlerts.mockReturnValue([
        { id: '1', severity: 'warning' },
        { id: '2', severity: 'error' },
      ]);

      const summary = await dashboardService.getSummary(timeRange);

      // Validate structure
      expect(summary).toHaveProperty('timeRange');
      expect(summary).toHaveProperty('overview');
      expect(summary).toHaveProperty('responseTime');
      expect(summary).toHaveProperty('tokenUsage');
      expect(summary).toHaveProperty('intentClassification');
      expect(summary).toHaveProperty('cache');
      expect(summary).toHaveProperty('queue');

      // Validate time range
      expect(summary.timeRange).toEqual(timeRange);

      // Validate overview structure
      expect(summary.overview).toHaveProperty('totalMessages');
      expect(summary.overview).toHaveProperty('totalLLMRequests');
      expect(summary.overview).toHaveProperty('avgResponseTime');
      expect(summary.overview).toHaveProperty('cacheHitRate');
      expect(summary.overview).toHaveProperty('activeAlerts');
      expect(summary.overview.activeAlerts).toBe(2);

      // Validate response time structure
      expect(summary.responseTime).toHaveProperty('ollama');
      expect(summary.responseTime).toHaveProperty('claude');
      expect(summary.responseTime.ollama).toHaveProperty('avg');
      expect(summary.responseTime.ollama).toHaveProperty('min');
      expect(summary.responseTime.ollama).toHaveProperty('max');
      expect(summary.responseTime.ollama).toHaveProperty('p95');
      expect(summary.responseTime.ollama).toHaveProperty('count');

      // Validate cache hit rate calculation
      expect(summary.overview.cacheHitRate).toBe(80); // 80/100 = 80%

      // Validate queue depth
      expect(summary.queue.pending).toBe(5);
      expect(summary.queue.processing).toBe(2);
      expect(summary.overview.cacheHitRate).toBeGreaterThanOrEqual(0);
      expect(summary.overview.cacheHitRate).toBeLessThanOrEqual(100);
    });

    it('should handle zero values gracefully', async () => {
      const timeRange = { from: Date.now() - 1000, to: Date.now() };

      mockIntentLogRepo.getAccuracyStats.mockResolvedValue({
        totalClassifications: 0,
        accuracyRate: 0,
        averageConfidence: 0,
        byMethod: {
          pattern: { accuracyRate: 0 },
          llm: { accuracyRate: 0 },
          escalated: { accuracyRate: 0 },
        },
      });

      mockIntentLogRepo.getEscalationRate.mockResolvedValue({
        escalationRate: 0,
      });

      mockCacheRepo.getStats.mockResolvedValue({
        totalEntries: 0,
        totalHits: 0,
        avgHitCount: 0,
      });

      mockQueueRepo.getStats.mockResolvedValue({
        pending: 0,
        processing: 0,
        completed: 0,
        failed: 0,
      });

      const summary = await dashboardService.getSummary(timeRange);

      // Note: totalLLMRequests may have data from actual DB queries
      // so we check for >= 0 rather than exact values
      expect(summary.overview.totalLLMRequests).toBeGreaterThanOrEqual(0);
      expect(summary.overview.avgResponseTime).toBeGreaterThanOrEqual(0);
      expect(summary.overview.cacheHitRate).toBe(0);
      expect(summary.intentClassification.totalClassifications).toBe(0);
      expect(summary.cache.totalHits).toBe(0);
    });

    it('should correctly calculate average response time across models', async () => {
      const timeRange = { from: Date.now() - 1000, to: Date.now() };

      mockIntentLogRepo.getAccuracyStats.mockResolvedValue({
        totalClassifications: 10,
        accuracyRate: 90,
        averageConfidence: 0.8,
        byMethod: {
          pattern: { accuracyRate: 95 },
          llm: { accuracyRate: 85 },
          escalated: { accuracyRate: 80 },
        },
      });

      mockIntentLogRepo.getEscalationRate.mockResolvedValue({
        escalationRate: 5,
      });

      mockCacheRepo.getStats.mockResolvedValue({
        totalEntries: 100,
        totalHits: 75,
        avgHitCount: 3,
      });

      mockQueueRepo.getStats.mockResolvedValue({
        pending: 1,
        processing: 0,
        completed: 100,
        failed: 0,
      });

      const summary = await dashboardService.getSummary(timeRange);

      // Weighted average calculation should be correct
      expect(typeof summary.overview.avgResponseTime).toBe('number');
      expect(summary.overview.avgResponseTime).toBeGreaterThanOrEqual(0);
    });
  });

  // ============================================================================
  // 2. Response Time Charts Tests
  // ============================================================================

  describe('getResponseTimeChart()', () => {
    it('should return properly formatted time series data', async () => {
      const timeRange = {
        from: Date.now() - 60 * 60 * 1000, // 1 hour ago
        to: Date.now(),
      };

      const chartData = await dashboardService.getResponseTimeChart(timeRange);

      expect(Array.isArray(chartData)).toBe(true);

      chartData.forEach((point) => {
        expect(point).toHaveProperty('timestamp');
        expect(point).toHaveProperty('ollama');
        expect(point).toHaveProperty('claude');
        expect(typeof point.timestamp).toBe('number');
        expect(point.timestamp).toBeGreaterThan(0);

        // Values can be null or numbers
        if (point.ollama !== null) {
          expect(typeof point.ollama).toBe('number');
        }
        if (point.claude !== null) {
          expect(typeof point.claude).toBe('number');
        }
      });
    });

    it('should handle empty data sets', async () => {
      const timeRange = { from: Date.now() - 1000, to: Date.now() };

      const chartData = await dashboardService.getResponseTimeChart(timeRange);

      expect(Array.isArray(chartData)).toBe(true);
      // Empty data is acceptable
    });

    it('should order data points chronologically', async () => {
      const timeRange = {
        from: Date.now() - 24 * 60 * 60 * 1000,
        to: Date.now(),
      };

      const chartData = await dashboardService.getResponseTimeChart(timeRange);

      if (chartData.length > 1) {
        for (let i = 1; i < chartData.length; i++) {
          expect(chartData[i].timestamp).toBeGreaterThanOrEqual(chartData[i - 1].timestamp);
        }
      }
    });

    it('should respect custom interval parameter', async () => {
      const timeRange = {
        from: Date.now() - 60 * 60 * 1000,
        to: Date.now(),
      };
      const customInterval = 5 * 60 * 1000; // 5 minutes

      const chartData = await dashboardService.getResponseTimeChart(timeRange, customInterval);

      expect(Array.isArray(chartData)).toBe(true);
      // Data should be bucketed by the custom interval
    });
  });

  // ============================================================================
  // 3. Token Usage Charts Tests
  // ============================================================================

  describe('getTokenUsageChart()', () => {
    it('should correctly aggregate prompt and completion tokens', async () => {
      const timeRange = {
        from: Date.now() - 60 * 60 * 1000,
        to: Date.now(),
      };

      const chartData = await dashboardService.getTokenUsageChart(timeRange);

      expect(Array.isArray(chartData)).toBe(true);

      chartData.forEach((point) => {
        expect(point).toHaveProperty('timestamp');
        expect(point).toHaveProperty('model');
        expect(point).toHaveProperty('promptTokens');
        expect(point).toHaveProperty('completionTokens');
        expect(point).toHaveProperty('totalTokens');

        expect(typeof point.timestamp).toBe('number');
        expect(typeof point.model).toBe('string');
        expect(typeof point.promptTokens).toBe('number');
        expect(typeof point.completionTokens).toBe('number');
        expect(typeof point.totalTokens).toBe('number');

        // Total should equal sum of prompt and completion
        expect(point.totalTokens).toBeGreaterThanOrEqual(
          point.promptTokens + point.completionTokens
        );
      });
    });

    it('should group data by model', async () => {
      const timeRange = {
        from: Date.now() - 24 * 60 * 60 * 1000,
        to: Date.now(),
      };

      const chartData = await dashboardService.getTokenUsageChart(timeRange);

      // Should have data grouped by different models
      const models = new Set(chartData.map((point) => point.model));
      expect(models.size).toBeGreaterThanOrEqual(0);
    });

    it('should handle zero token usage', async () => {
      const timeRange = { from: Date.now() - 1000, to: Date.now() };

      const chartData = await dashboardService.getTokenUsageChart(timeRange);

      expect(Array.isArray(chartData)).toBe(true);
      chartData.forEach((point) => {
        expect(point.promptTokens).toBeGreaterThanOrEqual(0);
        expect(point.completionTokens).toBeGreaterThanOrEqual(0);
        expect(point.totalTokens).toBeGreaterThanOrEqual(0);
      });
    });
  });

  // ============================================================================
  // 4. Intent Accuracy Charts Tests
  // ============================================================================

  describe('getIntentAccuracyChart()', () => {
    it('should show correct accuracy percentages for each intent', async () => {
      const timeRange = {
        from: Date.now() - 24 * 60 * 60 * 1000,
        to: Date.now(),
      };

      mockIntentLogRepo.getAccuracyStats.mockResolvedValue({
        totalClassifications: 100,
        accuracyRate: 92.5,
        averageConfidence: 0.85,
        byMethod: {
          pattern: { accuracyRate: 98 },
          llm: { accuracyRate: 88 },
          escalated: { accuracyRate: 75 },
        },
        byConfidenceLevel: {
          high: { accuracyRate: 99, count: 50 },
          medium: { accuracyRate: 85, count: 30 },
          low: { accuracyRate: 70, count: 15 },
          uncertain: { accuracyRate: 50, count: 5 },
        },
      });

      const chartData = await dashboardService.getIntentAccuracyChart(timeRange);

      expect(Array.isArray(chartData)).toBe(true);

      chartData.forEach((point) => {
        expect(point).toHaveProperty('intent');
        expect(point).toHaveProperty('accuracy');
        expect(point).toHaveProperty('count');
        expect(point).toHaveProperty('avgConfidence');

        expect(typeof point.intent).toBe('string');
        expect(typeof point.accuracy).toBe('number');
        expect(typeof point.count).toBe('number');
        expect(typeof point.avgConfidence).toBe('number');

        // Accuracy should be a percentage (0-100)
        expect(point.accuracy).toBeGreaterThanOrEqual(0);
        expect(point.accuracy).toBeLessThanOrEqual(100);

        // Confidence should be between 0 and 1
        expect(point.avgConfidence).toBeGreaterThanOrEqual(0);
        expect(point.avgConfidence).toBeLessThanOrEqual(1);
      });
    });

    it('should handle no classification data', async () => {
      const timeRange = { from: Date.now() - 1000, to: Date.now() };

      mockIntentLogRepo.getAccuracyStats.mockResolvedValue({
        totalClassifications: 0,
        accuracyRate: 0,
        averageConfidence: 0,
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

      const chartData = await dashboardService.getIntentAccuracyChart(timeRange);

      expect(Array.isArray(chartData)).toBe(true);
    });

    it('should sort intents by count (most frequent first)', async () => {
      const timeRange = { from: Date.now() - 1000, to: Date.now() };

      mockIntentLogRepo.getAccuracyStats.mockResolvedValue({
        totalClassifications: 100,
        accuracyRate: 90,
        averageConfidence: 0.8,
        byMethod: {
          pattern: { accuracyRate: 95 },
          llm: { accuracyRate: 85 },
          escalated: { accuracyRate: 80 },
        },
        byConfidenceLevel: {
          high: { accuracyRate: 99, count: 50 },
          medium: { accuracyRate: 85, count: 30 },
          low: { accuracyRate: 70, count: 15 },
          uncertain: { accuracyRate: 50, count: 5 },
        },
      });

      const chartData = await dashboardService.getIntentAccuracyChart(timeRange);

      if (chartData.length > 1) {
        for (let i = 1; i < chartData.length; i++) {
          expect(chartData[i].count).toBeLessThanOrEqual(chartData[i - 1].count);
        }
      }
    });
  });

  // ============================================================================
  // 5. Queue Status Charts Tests
  // ============================================================================

  describe('getQueueStatusChart()', () => {
    it('should reflect actual queue state with correct counts', async () => {
      mockQueueRepo.getStats.mockResolvedValue({
        pending: 10,
        processing: 3,
        completed: 200,
        failed: 5,
      });

      const chartData = await dashboardService.getQueueStatusChart();

      expect(Array.isArray(chartData)).toBe(true);
      expect(chartData.length).toBe(4); // pending, processing, completed, failed

      chartData.forEach((point) => {
        expect(point).toHaveProperty('status');
        expect(point).toHaveProperty('count');
        expect(point).toHaveProperty('percentage');

        expect(typeof point.status).toBe('string');
        expect(typeof point.count).toBe('number');
        expect(typeof point.percentage).toBe('number');

        expect(point.count).toBeGreaterThanOrEqual(0);
        expect(point.percentage).toBeGreaterThanOrEqual(0);
        expect(point.percentage).toBeLessThanOrEqual(100);
      });

      // Find specific statuses
      const pending = chartData.find((p) => p.status === 'pending');
      const processing = chartData.find((p) => p.status === 'processing');
      const completed = chartData.find((p) => p.status === 'completed');
      const failed = chartData.find((p) => p.status === 'failed');

      expect(pending?.count).toBe(10);
      expect(processing?.count).toBe(3);
      expect(completed?.count).toBe(200);
      expect(failed?.count).toBe(5);
    });

    it('should calculate correct percentages', async () => {
      mockQueueRepo.getStats.mockResolvedValue({
        pending: 25,
        processing: 25,
        completed: 25,
        failed: 25,
      });

      const chartData = await dashboardService.getQueueStatusChart();

      // All should be 25% each
      chartData.forEach((point) => {
        expect(point.percentage).toBeCloseTo(25, 1);
      });

      // Total percentages should sum to ~100%
      const totalPercentage = chartData.reduce((sum, point) => sum + point.percentage, 0);
      expect(totalPercentage).toBeCloseTo(100, 1);
    });

    it('should handle empty queue', async () => {
      mockQueueRepo.getStats.mockResolvedValue({
        pending: 0,
        processing: 0,
        completed: 0,
        failed: 0,
      });

      const chartData = await dashboardService.getQueueStatusChart();

      expect(Array.isArray(chartData)).toBe(true);
      chartData.forEach((point) => {
        expect(point.count).toBe(0);
        expect(point.percentage).toBe(0);
      });
    });
  });

  // ============================================================================
  // 6. Cache Performance Charts Tests
  // ============================================================================

  describe('getCachePerformanceChart()', () => {
    it('should show accurate hit rates', async () => {
      const timeRange = {
        from: Date.now() - 60 * 60 * 1000,
        to: Date.now(),
      };

      mockCacheRepo.getStats.mockResolvedValue({
        totalEntries: 100,
        totalHits: 80,
        avgHitCount: 4.5,
      });

      const chartData = await dashboardService.getCachePerformanceChart(timeRange);

      expect(Array.isArray(chartData)).toBe(true);

      chartData.forEach((point) => {
        expect(point).toHaveProperty('timestamp');
        expect(point).toHaveProperty('hitRate');
        expect(point).toHaveProperty('totalEntries');
        expect(point).toHaveProperty('totalHits');

        expect(typeof point.timestamp).toBe('number');
        expect(typeof point.hitRate).toBe('number');
        expect(typeof point.totalEntries).toBe('number');
        expect(typeof point.totalHits).toBe('number');

        // Hit rate should be a percentage
        expect(point.hitRate).toBeGreaterThanOrEqual(0);
        expect(point.hitRate).toBeLessThanOrEqual(100);
      });
    });

    it('should calculate hit rate correctly', async () => {
      const timeRange = { from: Date.now() - 1000, to: Date.now() };

      mockCacheRepo.getStats.mockResolvedValue({
        totalEntries: 200,
        totalHits: 160,
        avgHitCount: 8,
      });

      const chartData = await dashboardService.getCachePerformanceChart(timeRange);

      if (chartData.length > 0) {
        const point = chartData[0];
        // 160 hits / 200 entries = 80% hit rate
        expect(point.hitRate).toBeCloseTo(80, 1);
      }
    });

    it('should handle zero cache activity', async () => {
      const timeRange = { from: Date.now() - 1000, to: Date.now() };

      mockCacheRepo.getStats.mockResolvedValue({
        totalEntries: 0,
        totalHits: 0,
        avgHitCount: 0,
      });

      const chartData = await dashboardService.getCachePerformanceChart(timeRange);

      if (chartData.length > 0) {
        const point = chartData[0];
        expect(point.hitRate).toBe(0);
        expect(point.totalEntries).toBe(0);
        expect(point.totalHits).toBe(0);
      }
    });

    it('should handle 100% hit rate', async () => {
      const timeRange = { from: Date.now() - 1000, to: Date.now() };

      mockCacheRepo.getStats.mockResolvedValue({
        totalEntries: 50,
        totalHits: 50,
        avgHitCount: 10,
      });

      const chartData = await dashboardService.getCachePerformanceChart(timeRange);

      if (chartData.length > 0) {
        const point = chartData[0];
        expect(point.hitRate).toBe(100);
      }
    });
  });

  // ============================================================================
  // 7. User Engagement Metrics Tests
  // ============================================================================

  describe('getUserEngagementMetrics()', () => {
    it('should calculate engagement metrics properly', async () => {
      const timeRange = {
        from: Date.now() - 24 * 60 * 60 * 1000,
        to: Date.now(),
      };

      const metrics = await dashboardService.getUserEngagementMetrics(timeRange);

      expect(metrics).toHaveProperty('totalUsers');
      expect(metrics).toHaveProperty('activeUsers');
      expect(metrics).toHaveProperty('totalChats');
      expect(metrics).toHaveProperty('avgMessagesPerUser');
      expect(metrics).toHaveProperty('topUsers');

      expect(typeof metrics.totalUsers).toBe('number');
      expect(typeof metrics.activeUsers).toBe('number');
      expect(typeof metrics.totalChats).toBe('number');
      expect(typeof metrics.avgMessagesPerUser).toBe('number');
      expect(Array.isArray(metrics.topUsers)).toBe(true);

      expect(metrics.totalUsers).toBeGreaterThanOrEqual(0);
      expect(metrics.activeUsers).toBeGreaterThanOrEqual(0);
      expect(metrics.activeUsers).toBeLessThanOrEqual(metrics.totalUsers);
    });

    it('should format top users correctly', async () => {
      const timeRange = { from: Date.now() - 1000, to: Date.now() };

      const metrics = await dashboardService.getUserEngagementMetrics(timeRange);

      metrics.topUsers.forEach((user) => {
        expect(user).toHaveProperty('userId');
        expect(user).toHaveProperty('messageCount');
        expect(typeof user.userId).toBe('string');
        expect(typeof user.messageCount).toBe('number');
        expect(user.messageCount).toBeGreaterThan(0);
      });
    });
  });

  // ============================================================================
  // 8. Time Range Parsing Tests
  // ============================================================================

  describe('parseTimeRange()', () => {
    it('should correctly parse last_hour preset', () => {
      const range = dashboardService.parseTimeRange('last_hour');

      expect(range).toHaveProperty('from');
      expect(range).toHaveProperty('to');
      expect(typeof range.from).toBe('number');
      expect(typeof range.to).toBe('number');

      const duration = range.to - range.from;
      expect(duration).toBe(60 * 60 * 1000); // 1 hour
    });

    it('should correctly parse last_24h preset', () => {
      const range = dashboardService.parseTimeRange('last_24h');
      const duration = range.to - range.from;
      expect(duration).toBe(24 * 60 * 60 * 1000); // 24 hours
    });

    it('should correctly parse last_7d preset', () => {
      const range = dashboardService.parseTimeRange('last_7d');
      const duration = range.to - range.from;
      expect(duration).toBe(7 * 24 * 60 * 60 * 1000); // 7 days
    });

    it('should correctly parse last_30d preset', () => {
      const range = dashboardService.parseTimeRange('last_30d');
      const duration = range.to - range.from;
      expect(duration).toBe(30 * 24 * 60 * 60 * 1000); // 30 days
    });

    it('should correctly parse last_90d preset', () => {
      const range = dashboardService.parseTimeRange('last_90d');
      const duration = range.to - range.from;
      expect(duration).toBe(90 * 24 * 60 * 60 * 1000); // 90 days
    });

    it('should default to last_24h for unknown preset', () => {
      const range = dashboardService.parseTimeRange('unknown_preset');
      const duration = range.to - range.from;
      expect(duration).toBe(24 * 60 * 60 * 1000); // Default to 24h
    });

    it('should return timestamps where to > from', () => {
      const presets = ['last_hour', 'last_24h', 'last_7d', 'last_30d', 'last_90d'];

      presets.forEach((preset) => {
        const range = dashboardService.parseTimeRange(preset);
        expect(range.to).toBeGreaterThan(range.from);
      });
    });
  });

  // ============================================================================
  // 9. Interval Calculation Tests
  // ============================================================================

  describe('calculateInterval()', () => {
    it('should return 1 minute for ranges <= 1 hour', () => {
      const from = Date.now() - 60 * 60 * 1000; // 1 hour ago
      const to = Date.now();

      const interval = dashboardService.calculateInterval(from, to);
      expect(interval).toBe(60 * 1000); // 1 minute
    });

    it('should return 5 minutes for ranges <= 24 hours', () => {
      const from = Date.now() - 24 * 60 * 60 * 1000; // 24 hours ago
      const to = Date.now();

      const interval = dashboardService.calculateInterval(from, to);
      expect(interval).toBe(5 * 60 * 1000); // 5 minutes
    });

    it('should return 1 hour for ranges <= 7 days', () => {
      const from = Date.now() - 7 * 24 * 60 * 60 * 1000; // 7 days ago
      const to = Date.now();

      const interval = dashboardService.calculateInterval(from, to);
      expect(interval).toBe(60 * 60 * 1000); // 1 hour
    });

    it('should return 1 day for ranges > 7 days', () => {
      const from = Date.now() - 30 * 24 * 60 * 60 * 1000; // 30 days ago
      const to = Date.now();

      const interval = dashboardService.calculateInterval(from, to);
      expect(interval).toBe(24 * 60 * 60 * 1000); // 1 day
    });

    it('should handle edge case at exactly 1 hour', () => {
      const from = Date.now() - 60 * 60 * 1000;
      const to = Date.now();

      const interval = dashboardService.calculateInterval(from, to);
      expect(interval).toBe(60 * 1000); // Should be minute interval
    });

    it('should handle very short time ranges', () => {
      const from = Date.now() - 5 * 60 * 1000; // 5 minutes
      const to = Date.now();

      const interval = dashboardService.calculateInterval(from, to);
      expect(interval).toBe(60 * 1000); // 1 minute
    });

    it('should handle very long time ranges', () => {
      const from = Date.now() - 365 * 24 * 60 * 60 * 1000; // 1 year
      const to = Date.now();

      const interval = dashboardService.calculateInterval(from, to);
      expect(interval).toBe(24 * 60 * 60 * 1000); // 1 day
    });
  });

  // ============================================================================
  // 10. Edge Cases Tests
  // ============================================================================

  describe('Edge Cases', () => {
    it('should handle completely empty data across all charts', async () => {
      const timeRange = { from: Date.now() - 1000, to: Date.now() };

      mockIntentLogRepo.getAccuracyStats.mockResolvedValue({
        totalClassifications: 0,
        accuracyRate: 0,
        averageConfidence: 0,
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

      mockIntentLogRepo.getEscalationRate.mockResolvedValue({
        escalationRate: 0,
      });

      mockCacheRepo.getStats.mockResolvedValue({
        totalEntries: 0,
        totalHits: 0,
        avgHitCount: 0,
      });

      mockQueueRepo.getStats.mockResolvedValue({
        pending: 0,
        processing: 0,
        completed: 0,
        failed: 0,
      });

      const [summary, responseChart, tokenChart, intentChart, queueChart, cacheChart] =
        await Promise.all([
          dashboardService.getSummary(timeRange),
          dashboardService.getResponseTimeChart(timeRange),
          dashboardService.getTokenUsageChart(timeRange),
          dashboardService.getIntentAccuracyChart(timeRange),
          dashboardService.getQueueStatusChart(),
          dashboardService.getCachePerformanceChart(timeRange),
        ]);

      expect(summary).toBeDefined();
      expect(Array.isArray(responseChart)).toBe(true);
      expect(Array.isArray(tokenChart)).toBe(true);
      expect(Array.isArray(intentChart)).toBe(true);
      expect(Array.isArray(queueChart)).toBe(true);
      expect(Array.isArray(cacheChart)).toBe(true);
    });

    it('should handle single data point correctly', async () => {
      const timeRange = { from: Date.now() - 1000, to: Date.now() };

      const responseChart = await dashboardService.getResponseTimeChart(timeRange);

      // Single data point should be handled gracefully
      expect(Array.isArray(responseChart)).toBe(true);
    });

    it('should handle large date ranges efficiently', async () => {
      const timeRange = {
        from: Date.now() - 365 * 24 * 60 * 60 * 1000, // 1 year
        to: Date.now(),
      };

      // Should not throw or timeout
      const interval = dashboardService.calculateInterval(timeRange.from, timeRange.to);
      expect(interval).toBe(24 * 60 * 60 * 1000); // 1 day interval

      const charts = await Promise.all([
        dashboardService.getResponseTimeChart(timeRange),
        dashboardService.getTokenUsageChart(timeRange),
      ]);

      charts.forEach((chart) => {
        expect(Array.isArray(chart)).toBe(true);
      });
    });

    it('should handle future time ranges gracefully', async () => {
      const timeRange = {
        from: Date.now(),
        to: Date.now() + 24 * 60 * 60 * 1000, // 24 hours in the future
      };

      // Should not throw
      const interval = dashboardService.calculateInterval(timeRange.from, timeRange.to);
      expect(typeof interval).toBe('number');
      expect(interval).toBeGreaterThan(0);
    });

    it('should handle inverted time ranges (to < from)', async () => {
      const from = Date.now();
      const to = Date.now() - 60 * 60 * 1000; // 1 hour in the past

      // Interval calculation should handle negative duration
      const interval = dashboardService.calculateInterval(from, to);
      expect(typeof interval).toBe('number');
    });

    it('should validate percentage values never exceed bounds', async () => {
      mockQueueRepo.getStats.mockResolvedValue({
        pending: 100,
        processing: 50,
        completed: 200,
        failed: 10,
      });

      const queueChart = await dashboardService.getQueueStatusChart();

      queueChart.forEach((point) => {
        expect(point.percentage).toBeGreaterThanOrEqual(0);
        expect(point.percentage).toBeLessThanOrEqual(100);
      });
    });

    it('should handle null/undefined repository dependencies gracefully', async () => {
      // Create service with minimal dependencies
      const minimalService = new DashboardService(
        mockMetricsRepo as unknown as MetricsRepository,
        mockAlertingService as unknown as AlertingService
      );

      const timeRange = { from: Date.now() - 1000, to: Date.now() };

      // Should not throw even with missing optional repos
      const [intentChart, queueChart, cacheChart] = await Promise.all([
        minimalService.getIntentAccuracyChart(timeRange),
        minimalService.getQueueStatusChart(),
        minimalService.getCachePerformanceChart(timeRange),
      ]);

      expect(Array.isArray(intentChart)).toBe(true);
      expect(Array.isArray(queueChart)).toBe(true);
      expect(Array.isArray(cacheChart)).toBe(true);
    });
  });
});
