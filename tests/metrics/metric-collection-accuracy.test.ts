#!/usr/bin/env npx tsx
/**
 * Metric Collection Accuracy Tests
 *
 * Comprehensive tests for metric collection, storage, and aggregation accuracy.
 * Tests cover:
 * 1. MetricsService correctly records counters, gauges, histograms, and timing metrics
 * 2. MetricsService batching works correctly (pending queue, flush behavior)
 * 3. MetricsRepository correctly stores and retrieves metrics
 * 4. MetricsRepository aggregation produces accurate statistics (count, sum, min, max, avg, p50, p95, p99)
 * 5. Tags are properly stored and can be filtered
 * 6. Timestamps are accurate
 * 7. Batch operations work correctly
 *
 * Run: npx tsx tests/metrics/metric-collection-accuracy.test.ts
 */

import { MetricsService } from '../../src/services/metrics.service.js';
import { MetricsRepository } from '../../src/repositories/metrics.repository.js';
import { db } from '../../src/db/client.js';
import { metrics, metricAggregates } from '../../src/db/schema.js';
import { sql, eq } from 'drizzle-orm';

// ============== Test Helpers ==============

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve(fn())
    .then(() => {
      console.log(`✓ ${name}`);
      passed++;
    })
    .catch((err) => {
      console.log(`✗ ${name}`);
      console.log(`  Error: ${err.message}`);
      if (err.stack) {
        const stackLine = err.stack.split('\n')[1];
        if (stackLine) console.log(`  ${stackLine.trim()}`);
      }
      failed++;
    });
}

function assertEqual<T>(actual: T, expected: T, message?: string) {
  if (actual !== expected) {
    throw new Error(message || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertApproximately(actual: number, expected: number, tolerance: number, message?: string) {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(
      message || `Expected ${expected} ± ${tolerance}, got ${actual}`
    );
  }
}

function assertGreaterThan(actual: number, expected: number, message?: string) {
  if (actual <= expected) {
    throw new Error(message || `Expected ${actual} to be greater than ${expected}`);
  }
}

function assertLessThan(actual: number, expected: number, message?: string) {
  if (actual >= expected) {
    throw new Error(message || `Expected ${actual} to be less than ${expected}`);
  }
}

function assertNotNull<T>(value: T | null, message?: string): asserts value is T {
  if (value === null) {
    throw new Error(message || 'Expected value to not be null');
  }
}

function assertArrayLength<T>(arr: T[], expectedLength: number, message?: string) {
  if (arr.length !== expectedLength) {
    throw new Error(
      message || `Expected array length ${expectedLength}, got ${arr.length}`
    );
  }
}

function assertContains(actual: string, expected: string, message?: string) {
  if (!actual.includes(expected)) {
    throw new Error(
      message || `Expected "${actual}" to contain "${expected}"`
    );
  }
}

// ============== Test Setup ==============

async function cleanupDatabase() {
  await db.delete(metrics);
  await db.delete(metricAggregates);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============== Test Suite ==============

async function runTests() {
  console.log('\n🧪 Metric Collection Accuracy Tests\n');
  console.log('='.repeat(60));

  const metricsRepo = new MetricsRepository();

  // ============================================================================
  // 1. MetricsService: Counter Metrics
  // ============================================================================

  await test('MetricsService: should increment counter correctly', async () => {
    await cleanupDatabase();
    const metricsService = new MetricsService(metricsRepo, {
      enabled: true,
      flushIntervalMs: 60000, // Long interval - we'll flush manually
    });

    metricsService.increment('test_counter', { env: 'test' }, 5);
    metricsService.increment('test_counter', { env: 'test' }, 3);
    metricsService.increment('test_counter', { env: 'test' }, 2);

    await metricsService.flush();

    const stats = await metricsRepo.getStats('test_counter');
    assertNotNull(stats);
    assertEqual(stats.count, 3, 'Should have 3 counter events');
    assertEqual(stats.sum, 10, 'Sum should be 5+3+2=10');
    assertEqual(stats.min, 2, 'Min should be 2');
    assertEqual(stats.max, 5, 'Max should be 5');
    assertApproximately(stats.avg, 3.33, 0.01, 'Avg should be ~3.33');

    await metricsService.shutdown();
  });

  await test('MetricsService: should handle counter with default value of 1', async () => {
    await cleanupDatabase();
    const metricsService = new MetricsService(metricsRepo, {
      enabled: true,
      flushIntervalMs: 60000,
    });

    metricsService.increment('requests_total');
    metricsService.increment('requests_total');
    metricsService.increment('requests_total');

    await metricsService.flush();

    const stats = await metricsRepo.getStats('requests_total');
    assertNotNull(stats);
    assertEqual(stats.count, 3, 'Should have 3 counter events');
    assertEqual(stats.sum, 3, 'Sum should be 3 (default increment of 1)');

    await metricsService.shutdown();
  });

  // ============================================================================
  // 2. MetricsService: Gauge Metrics
  // ============================================================================

  await test('MetricsService: should set gauge values correctly', async () => {
    await cleanupDatabase();
    const metricsService = new MetricsService(metricsRepo, {
      enabled: true,
      flushIntervalMs: 60000,
    });

    metricsService.gauge('queue_depth', 10, { queue: 'main' });
    metricsService.gauge('queue_depth', 15, { queue: 'main' });
    metricsService.gauge('queue_depth', 5, { queue: 'main' });

    await metricsService.flush();

    const stats = await metricsRepo.getStats('queue_depth');
    assertNotNull(stats);
    assertEqual(stats.count, 3, 'Should have 3 gauge events');
    assertEqual(stats.min, 5, 'Min should be 5');
    assertEqual(stats.max, 15, 'Max should be 15');
    assertEqual(stats.avg, 10, 'Avg should be 10');

    await metricsService.shutdown();
  });

  // ============================================================================
  // 3. MetricsService: Histogram Metrics
  // ============================================================================

  await test('MetricsService: should record histogram values correctly', async () => {
    await cleanupDatabase();
    const metricsService = new MetricsService(metricsRepo, {
      enabled: true,
      flushIntervalMs: 60000,
    });

    // Record response times
    const responseTimes = [100, 150, 200, 250, 300, 350, 400, 450, 500, 1000];
    for (const rt of responseTimes) {
      metricsService.histogram('response_time_ms', rt, { service: 'api' });
    }

    await metricsService.flush();

    const stats = await metricsRepo.getStats('response_time_ms');
    assertNotNull(stats);
    assertEqual(stats.count, 10, 'Should have 10 histogram events');
    assertEqual(stats.sum, 3700, 'Sum should be 3700');
    assertEqual(stats.min, 100, 'Min should be 100');
    assertEqual(stats.max, 1000, 'Max should be 1000');
    assertEqual(stats.avg, 370, 'Avg should be 370');

    await metricsService.shutdown();
  });

  // ============================================================================
  // 4. MetricsService: Timing Metrics
  // ============================================================================

  await test('MetricsService: should time async operations correctly', async () => {
    await cleanupDatabase();
    const metricsService = new MetricsService(metricsRepo, {
      enabled: true,
      flushIntervalMs: 60000,
    });

    const result = await metricsService.timing(
      'operation_duration_ms',
      async () => {
        await sleep(50); // Simulate 50ms operation
        return 'success';
      },
      { operation: 'test' }
    );

    assertEqual(result, 'success', 'Should return operation result');
    await metricsService.flush();

    const stats = await metricsRepo.getStats('operation_duration_ms');
    assertNotNull(stats);
    assertEqual(stats.count, 1, 'Should have 1 timing event');
    assertGreaterThan(stats.avg, 45, 'Duration should be > 45ms');
    assertLessThan(stats.avg, 100, 'Duration should be < 100ms');

    await metricsService.shutdown();
  });

  await test('MetricsService: should time sync operations correctly', async () => {
    await cleanupDatabase();
    const metricsService = new MetricsService(metricsRepo, {
      enabled: true,
      flushIntervalMs: 60000,
    });

    const result = metricsService.timingSync(
      'sync_operation_ms',
      () => {
        let sum = 0;
        for (let i = 0; i < 1000000; i++) {
          sum += i;
        }
        return sum;
      },
      { type: 'compute' }
    );

    assertGreaterThan(result, 0, 'Should return computation result');
    await metricsService.flush();

    const stats = await metricsRepo.getStats('sync_operation_ms');
    assertNotNull(stats);
    assertEqual(stats.count, 1, 'Should have 1 timing event');
    assertGreaterThan(stats.avg, 0, 'Duration should be > 0ms');

    await metricsService.shutdown();
  });

  await test('MetricsService: should record timing with error tag on failure', async () => {
    await cleanupDatabase();
    const metricsService = new MetricsService(metricsRepo, {
      enabled: true,
      flushIntervalMs: 60000,
    });

    try {
      await metricsService.timing(
        'failing_operation_ms',
        async () => {
          await sleep(10);
          throw new Error('Operation failed');
        },
        { operation: 'test' }
      );
    } catch (err) {
      // Expected to throw
    }

    await metricsService.flush();

    const stats = await metricsRepo.getStats('failing_operation_ms');
    assertNotNull(stats);
    assertEqual(stats.count, 1, 'Should have 1 timing event');
    assertGreaterThan(stats.avg, 5, 'Duration should be recorded even on error');

    // Verify error tag was added
    const rawMetrics = await metricsRepo.getMetrics(
      'failing_operation_ms',
      0,
      Date.now()
    );
    assertEqual(rawMetrics.length, 1, 'Should have 1 raw metric');
    const tags = rawMetrics[0].tags ? JSON.parse(rawMetrics[0].tags) : {};
    assertEqual(tags.error, 'true', 'Should have error=true tag');

    await metricsService.shutdown();
  });

  // ============================================================================
  // 5. MetricsService: Batching and Flush Behavior
  // ============================================================================

  await test('MetricsService: should queue metrics in pending array', async () => {
    await cleanupDatabase();
    const metricsService = new MetricsService(metricsRepo, {
      enabled: true,
      flushIntervalMs: 60000, // Long interval to prevent auto-flush
    });

    metricsService.increment('pending_test', {}, 1);
    metricsService.increment('pending_test', {}, 2);
    metricsService.increment('pending_test', {}, 3);

    // Before flush, should not be in DB
    const statsBeforeFlush = await metricsRepo.getStats('pending_test');
    assertEqual(statsBeforeFlush, null, 'Should not be in DB before flush');

    await metricsService.flush();

    // After flush, should be in DB
    const statsAfterFlush = await metricsRepo.getStats('pending_test');
    assertNotNull(statsAfterFlush);
    assertEqual(statsAfterFlush.count, 3, 'Should have 3 events after flush');

    await metricsService.shutdown();
  });

  await test('MetricsService: should flush automatically at interval', async () => {
    await cleanupDatabase();
    const metricsService = new MetricsService(metricsRepo, {
      enabled: true,
      flushIntervalMs: 100, // Short interval for testing
    });

    metricsService.increment('auto_flush_test', {}, 1);

    // Wait for auto-flush
    await sleep(200);

    const stats = await metricsRepo.getStats('auto_flush_test');
    assertNotNull(stats);
    assertEqual(stats.count, 1, 'Should have auto-flushed');

    await metricsService.shutdown();
  });

  await test('MetricsService: should emergency flush when queue reaches 1000', async () => {
    await cleanupDatabase();
    const metricsService = new MetricsService(metricsRepo, {
      enabled: true,
      flushIntervalMs: 60000, // Long interval
    });

    // Add 1000 metrics to trigger emergency flush
    for (let i = 0; i < 1000; i++) {
      metricsService.increment('emergency_flush_test', {}, 1);
    }

    // Wait a bit for emergency flush to complete
    await sleep(100);

    const stats = await metricsRepo.getStats('emergency_flush_test');
    assertNotNull(stats);
    assertEqual(stats.count, 1000, 'Should have emergency flushed 1000 metrics');

    await metricsService.shutdown();
  });

  await test('MetricsService: should clear pending queue after flush', async () => {
    await cleanupDatabase();
    const metricsService = new MetricsService(metricsRepo, {
      enabled: true,
      flushIntervalMs: 60000,
    });

    metricsService.increment('queue_clear_test', {}, 1);
    metricsService.increment('queue_clear_test', {}, 2);

    await metricsService.flush();

    // Add more metrics after flush
    metricsService.increment('queue_clear_test', {}, 3);
    metricsService.increment('queue_clear_test', {}, 4);

    await metricsService.flush();

    const stats = await metricsRepo.getStats('queue_clear_test');
    assertNotNull(stats);
    assertEqual(stats.count, 4, 'Should have all 4 metrics from both flushes');

    await metricsService.shutdown();
  });

  // ============================================================================
  // 6. MetricsService: Disabled State
  // ============================================================================

  await test('MetricsService: should not record when disabled', async () => {
    await cleanupDatabase();
    const metricsService = new MetricsService(metricsRepo, {
      enabled: false,
    });

    metricsService.increment('disabled_test', {}, 1);
    metricsService.gauge('disabled_gauge', 100);
    metricsService.histogram('disabled_histogram', 50);

    await metricsService.flush();

    const stats = await metricsRepo.getStats('disabled_test');
    assertEqual(stats, null, 'Should not record when disabled');

    await metricsService.shutdown();
  });

  // ============================================================================
  // 7. MetricsRepository: Storing and Retrieving Metrics
  // ============================================================================

  await test('MetricsRepository: should store metric with all fields', async () => {
    await cleanupDatabase();

    const timestamp = Date.now();
    const metric = await metricsRepo.record({
      name: 'test_metric',
      type: 'counter',
      value: 42,
      tags: JSON.stringify({ env: 'test', version: '1.0' }),
      timestamp: new Date(timestamp), // Pass as Date object
    });

    assertNotNull(metric);
    assertEqual(metric.name, 'test_metric');
    assertEqual(metric.type, 'counter');
    assertEqual(metric.value, 42);
    assertContains(metric.tags || '', 'env');
    assertContains(metric.tags || '', 'test');
  });

  await test('MetricsRepository: should retrieve metrics by name', async () => {
    await cleanupDatabase();

    const now = Date.now();
    await metricsRepo.recordBatch([
      { name: 'metric_a', type: 'counter', value: 1, timestamp: now },
      { name: 'metric_b', type: 'counter', value: 2, timestamp: now },
      { name: 'metric_a', type: 'counter', value: 3, timestamp: now },
    ]);

    const metricARecords = await metricsRepo.getMetrics('metric_a', 0, Date.now());
    assertEqual(metricARecords.length, 2, 'Should retrieve 2 metric_a records');

    const metricBRecords = await metricsRepo.getMetrics('metric_b', 0, Date.now());
    assertEqual(metricBRecords.length, 1, 'Should retrieve 1 metric_b record');
  });

  await test('MetricsRepository: should filter metrics by time range', async () => {
    await cleanupDatabase();

    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;
    const twoHoursAgo = now - 2 * 60 * 60 * 1000;

    await metricsRepo.recordBatch([
      { name: 'time_test', type: 'counter', value: 1, timestamp: twoHoursAgo },
      { name: 'time_test', type: 'counter', value: 2, timestamp: oneHourAgo },
      { name: 'time_test', type: 'counter', value: 3, timestamp: now },
    ]);

    // Query last hour
    const lastHourMetrics = await metricsRepo.getMetrics(
      'time_test',
      oneHourAgo - 1000,
      now
    );
    assertEqual(lastHourMetrics.length, 2, 'Should retrieve last 2 metrics');

    // Query last 2 hours
    const lastTwoHoursMetrics = await metricsRepo.getMetrics(
      'time_test',
      twoHoursAgo - 1000,
      now
    );
    assertEqual(lastTwoHoursMetrics.length, 3, 'Should retrieve all 3 metrics');
  });

  // ============================================================================
  // 8. MetricsRepository: Batch Operations
  // ============================================================================

  await test('MetricsRepository: should insert batch efficiently', async () => {
    await cleanupDatabase();

    const now = Date.now();
    const batch = [];
    for (let i = 0; i < 100; i++) {
      batch.push({
        name: 'batch_test',
        type: 'counter' as const,
        value: i,
        timestamp: now + i,
      });
    }

    await metricsRepo.recordBatch(batch);

    const stats = await metricsRepo.getStats('batch_test');
    assertNotNull(stats);
    assertEqual(stats.count, 100, 'Should have 100 metrics');
    assertEqual(stats.sum, 4950, 'Sum should be 0+1+2+...+99 = 4950');
    assertEqual(stats.min, 0, 'Min should be 0');
    assertEqual(stats.max, 99, 'Max should be 99');
  });

  await test('MetricsRepository: should handle empty batch gracefully', async () => {
    await cleanupDatabase();

    await metricsRepo.recordBatch([]);

    const allMetrics = await metricsRepo.getMetrics('any_metric', 0, Date.now());
    assertEqual(allMetrics.length, 0, 'Should have no metrics');
  });

  // ============================================================================
  // 9. MetricsRepository: Statistics Accuracy
  // ============================================================================

  await test('MetricsRepository: should calculate statistics accurately', async () => {
    await cleanupDatabase();

    const now = Date.now();
    const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    await metricsRepo.recordBatch(
      values.map((v) => ({
        name: 'stats_test',
        type: 'histogram',
        value: v,
        timestamp: now,
      }))
    );

    const stats = await metricsRepo.getStats('stats_test');
    assertNotNull(stats);
    assertEqual(stats.count, 10, 'Count should be 10');
    assertEqual(stats.sum, 550, 'Sum should be 550');
    assertEqual(stats.min, 10, 'Min should be 10');
    assertEqual(stats.max, 100, 'Max should be 100');
    assertEqual(stats.avg, 55, 'Avg should be 55');
  });

  await test('MetricsRepository: should handle single metric statistics', async () => {
    await cleanupDatabase();

    await metricsRepo.recordBatch([
      { name: 'single_test', type: 'gauge', value: 42, timestamp: Date.now() },
    ]);

    const stats = await metricsRepo.getStats('single_test');
    assertNotNull(stats);
    assertEqual(stats.count, 1, 'Count should be 1');
    assertEqual(stats.sum, 42, 'Sum should be 42');
    assertEqual(stats.min, 42, 'Min should be 42');
    assertEqual(stats.max, 42, 'Max should be 42');
    assertEqual(stats.avg, 42, 'Avg should be 42');
  });

  await test('MetricsRepository: should return null for non-existent metric', async () => {
    await cleanupDatabase();

    const stats = await metricsRepo.getStats('non_existent_metric');
    assertEqual(stats, null, 'Should return null for non-existent metric');
  });

  // ============================================================================
  // 10. MetricsRepository: Tag Filtering
  // ============================================================================

  await test('MetricsRepository: should store tags correctly', async () => {
    await cleanupDatabase();

    const now = Date.now();
    await metricsRepo.recordBatch([
      {
        name: 'tagged_metric',
        type: 'counter',
        value: 1,
        tags: JSON.stringify({ env: 'prod', region: 'us-east' }),
        timestamp: now,
      },
      {
        name: 'tagged_metric',
        type: 'counter',
        value: 2,
        tags: JSON.stringify({ env: 'dev', region: 'us-west' }),
        timestamp: now,
      },
    ]);

    const allMetrics = await metricsRepo.getMetrics('tagged_metric', 0, Date.now());
    assertEqual(allMetrics.length, 2, 'Should have 2 tagged metrics');

    // Verify tags are stored
    const metric1Tags = JSON.parse(allMetrics[0].tags || '{}');
    const metric2Tags = JSON.parse(allMetrics[1].tags || '{}');

    // One should have env=prod, other should have env=dev
    const hasEnvProd = metric1Tags.env === 'prod' || metric2Tags.env === 'prod';
    const hasEnvDev = metric1Tags.env === 'dev' || metric2Tags.env === 'dev';

    assertEqual(hasEnvProd, true, 'Should have env=prod tag');
    assertEqual(hasEnvDev, true, 'Should have env=dev tag');
  });

  await test('MetricsRepository: should filter by label correctly', async () => {
    await cleanupDatabase();

    const now = Date.now();
    await metricsRepo.recordBatch([
      {
        name: 'label_test',
        type: 'counter',
        value: 1,
        tags: JSON.stringify({ model: 'ollama', intent: 'greeting' }),
        timestamp: now,
      },
      {
        name: 'label_test',
        type: 'counter',
        value: 2,
        tags: JSON.stringify({ model: 'claude', intent: 'greeting' }),
        timestamp: now,
      },
      {
        name: 'label_test',
        type: 'counter',
        value: 3,
        tags: JSON.stringify({ model: 'ollama', intent: 'question' }),
        timestamp: now,
      },
    ]);

    const ollamaStats = await metricsRepo.getStatsByLabel(
      'label_test',
      'model',
      'ollama',
      0,
      Date.now()
    );
    assertNotNull(ollamaStats);
    assertEqual(ollamaStats.count, 2, 'Should have 2 ollama metrics');
    assertEqual(ollamaStats.sum, 4, 'Sum should be 1+3=4');

    const claudeStats = await metricsRepo.getStatsByLabel(
      'label_test',
      'model',
      'claude',
      0,
      Date.now()
    );
    assertNotNull(claudeStats);
    assertEqual(claudeStats.count, 1, 'Should have 1 claude metric');
    assertEqual(claudeStats.sum, 2, 'Sum should be 2');
  });

  // ============================================================================
  // 11. MetricsRepository: Timestamp Accuracy
  // ============================================================================

  await test('MetricsRepository: should preserve timestamp accuracy', async () => {
    await cleanupDatabase();

    const exactTimestamp = 1703347200000; // 2023-12-23 12:00:00 UTC
    await metricsRepo.recordBatch([
      { name: 'timestamp_test', type: 'counter', value: 1, timestamp: exactTimestamp },
    ]);

    const metrics = await metricsRepo.getMetrics('timestamp_test', 0, Date.now());
    assertEqual(metrics.length, 1, 'Should have 1 metric');

    const storedTimestamp = metrics[0].timestamp instanceof Date
      ? metrics[0].timestamp.getTime()
      : metrics[0].timestamp;

    assertEqual(storedTimestamp, exactTimestamp, 'Timestamp should be preserved exactly');
  });

  await test('MetricsRepository: should handle Date and number timestamps', async () => {
    await cleanupDatabase();

    const now = Date.now();
    await metricsRepo.recordBatch([
      { name: 'timestamp_type_test', type: 'counter', value: 1, timestamp: now },
    ]);

    // Query with Date object
    const metricsWithDate = await metricsRepo.getStats(
      'timestamp_type_test',
      new Date(now - 1000),
      new Date(now + 1000)
    );
    assertNotNull(metricsWithDate);
    assertEqual(metricsWithDate.count, 1, 'Should work with Date objects');

    // Query with numbers
    const metricsWithNumber = await metricsRepo.getStats(
      'timestamp_type_test',
      now - 1000,
      now + 1000
    );
    assertNotNull(metricsWithNumber);
    assertEqual(metricsWithNumber.count, 1, 'Should work with number timestamps');
  });

  // ============================================================================
  // 12. MetricsRepository: Aggregation
  // ============================================================================

  await test('MetricsRepository: should aggregate metrics by minute', async () => {
    await cleanupDatabase();

    const now = new Date();
    const minuteStart = new Date(now);
    minuteStart.setSeconds(0, 0);

    // Add metrics within the same minute
    const timestamp = minuteStart.getTime();
    await metricsRepo.recordBatch([
      { name: 'agg_test', type: 'histogram', value: 100, timestamp },
      { name: 'agg_test', type: 'histogram', value: 200, timestamp: timestamp + 1000 },
      { name: 'agg_test', type: 'histogram', value: 300, timestamp: timestamp + 2000 },
    ]);

    // Run aggregation
    await metricsRepo.aggregate('minute');

    // Check aggregates
    const aggregates = await metricsRepo.getAggregates(
      'agg_test',
      'minute',
      timestamp - 1000,
      timestamp + 60000
    );

    assertGreaterThan(aggregates.length, 0, 'Should have aggregates');
    const agg = aggregates[0];
    assertEqual(agg.count, 3, 'Aggregate count should be 3');
    assertEqual(agg.sum, 600, 'Aggregate sum should be 600');
    assertEqual(agg.min, 100, 'Aggregate min should be 100');
    assertEqual(agg.max, 300, 'Aggregate max should be 300');
    assertEqual(agg.avg, 200, 'Aggregate avg should be 200');
  });

  await test('MetricsRepository: should calculate percentiles in aggregation', async () => {
    await cleanupDatabase();

    const now = new Date();
    const minuteStart = new Date(now);
    minuteStart.setSeconds(0, 0);
    const timestamp = minuteStart.getTime();

    // Add 100 values from 1 to 100
    const batch = [];
    for (let i = 1; i <= 100; i++) {
      batch.push({
        name: 'percentile_test',
        type: 'histogram' as const,
        value: i,
        timestamp,
      });
    }
    await metricsRepo.recordBatch(batch);

    // Run aggregation
    await metricsRepo.aggregate('minute');

    // Check aggregates
    const aggregates = await metricsRepo.getAggregates(
      'percentile_test',
      'minute',
      timestamp - 1000,
      timestamp + 60000
    );

    assertGreaterThan(aggregates.length, 0, 'Should have aggregates');
    const agg = aggregates[0];

    // Check percentiles (approximate due to interpolation)
    assertApproximately(agg.p50, 50.5, 1, 'p50 should be ~50.5');
    assertApproximately(agg.p95, 95.5, 1, 'p95 should be ~95.5');
    assertApproximately(agg.p99, 99.5, 1, 'p99 should be ~99.5');
  });

  // ============================================================================
  // 13. MetricsRepository: Cleanup
  // ============================================================================

  await test('MetricsRepository: should prune old metrics', async () => {
    await cleanupDatabase();

    const now = Date.now();
    const oldTimestamp = now - 40 * 24 * 60 * 60 * 1000; // 40 days ago
    const recentTimestamp = now - 10 * 24 * 60 * 60 * 1000; // 10 days ago

    await metricsRepo.recordBatch([
      { name: 'prune_test', type: 'counter', value: 1, timestamp: oldTimestamp },
      { name: 'prune_test', type: 'counter', value: 2, timestamp: recentTimestamp },
      { name: 'prune_test', type: 'counter', value: 3, timestamp: now },
    ]);

    const cutoff = new Date(now - 30 * 24 * 60 * 60 * 1000); // 30 days ago
    const deleted = await metricsRepo.pruneOlderThan(cutoff);

    assertEqual(deleted, 1, 'Should have deleted 1 old metric');

    const stats = await metricsRepo.getStats('prune_test');
    assertNotNull(stats);
    assertEqual(stats.count, 2, 'Should have 2 remaining metrics');
  });

  // ============================================================================
  // 14. Integration Tests
  // ============================================================================

  await test('Integration: Full pipeline from service to aggregation', async () => {
    await cleanupDatabase();

    const metricsService = new MetricsService(metricsRepo, {
      enabled: true,
      flushIntervalMs: 60000,
    });

    // Record various metrics
    for (let i = 0; i < 20; i++) {
      metricsService.histogram('pipeline_test', 100 + i * 10, { source: 'integration' });
    }

    await metricsService.flush();

    // Verify metrics are stored
    const stats = await metricsRepo.getStats('pipeline_test');
    assertNotNull(stats);
    assertEqual(stats.count, 20, 'Should have 20 metrics');
    assertEqual(stats.min, 100, 'Min should be 100');
    assertEqual(stats.max, 290, 'Max should be 290');

    // Run aggregation
    await metricsRepo.aggregate('minute');

    // Verify aggregates exist
    const now = Date.now();
    const aggregates = await metricsRepo.getAggregates(
      'pipeline_test',
      'minute',
      now - 60000,
      now
    );

    assertGreaterThan(aggregates.length, 0, 'Should have created aggregates');

    await metricsService.shutdown();
  });

  // ============================================================================
  // Summary
  // ============================================================================

  console.log('='.repeat(60));
  console.log(`\n✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📊 Total: ${passed + failed}\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

// Run tests
runTests().catch((err) => {
  console.error('Fatal error running tests:', err);
  process.exit(1);
});
