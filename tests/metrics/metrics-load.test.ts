#!/usr/bin/env npx tsx
/**
 * Metrics System Load Tests
 *
 * Comprehensive load and performance tests for the metrics infrastructure.
 * Tests high volume metric recording, batch operations, aggregation performance,
 * query performance, memory usage, and concurrent operations.
 *
 * Run: npx tsx tests/metrics/metrics-load.test.ts
 */

import { MetricsService } from '../../src/services/metrics.service.js';
import { MetricsRepository } from '../../src/repositories/metrics.repository.js';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { metrics, metricAggregates } from '../../src/db/schema.js';
import { eq } from 'drizzle-orm';

// ============================================================================
// Performance Thresholds (in milliseconds)
// ============================================================================

const THRESHOLDS = {
  RECORD_1000_METRICS: 100,           // < 100ms to queue 1000 metrics
  RECORD_10000_METRICS: 500,          // < 500ms to queue 10000 metrics
  BATCH_INSERT_1000: 500,             // < 500ms to insert 1000 metrics
  BATCH_INSERT_5000: 2000,            // < 2s to insert 5000 metrics
  FLUSH_1000_METRICS: 600,            // < 600ms to flush 1000 metrics
  FLUSH_5000_METRICS: 2500,           // < 2.5s to flush 5000 metrics
  AGGREGATE_1000_METRICS: 1000,       // < 1s to aggregate 1000 metrics
  AGGREGATE_10000_METRICS: 5000,      // < 5s to aggregate 10000 metrics
  QUERY_STATS_1000: 200,              // < 200ms to query stats with 1000 metrics
  QUERY_STATS_10000: 500,             // < 500ms to query stats with 10000 metrics
  CONCURRENT_RECORD_100: 200,         // < 200ms for 100 concurrent recordings
  MEMORY_STABLE_THRESHOLD_MB: 50,     // Memory should not grow more than 50MB during test
};

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Measure execution time of an async function
 */
async function measureTime<T>(fn: () => Promise<T>): Promise<{ result: T; duration: number }> {
  const start = Date.now();
  const result = await fn();
  const duration = Date.now() - start;
  return { result, duration };
}

/**
 * Measure execution time of a sync function
 */
function measureTimeSync<T>(fn: () => T): { result: T; duration: number } {
  const start = Date.now();
  const result = fn();
  const duration = Date.now() - start;
  return { result, duration };
}

/**
 * Get current memory usage in MB
 */
function getMemoryUsageMB(): number {
  const usage = process.memoryUsage();
  return usage.heapUsed / 1024 / 1024;
}

/**
 * Generate realistic metric data with tags
 */
function generateMetricData(count: number): Array<{
  name: string;
  type: 'counter' | 'gauge' | 'histogram' | 'timing';
  value: number;
  tags?: Record<string, string>;
}> {
  const metricNames = [
    'response_time_ms',
    'llm_response_time_ms',
    'cache_hit',
    'cache_miss',
    'token_usage_total',
    'intent_classification_time_ms',
    'queue_depth',
    'message_processing_time_ms',
  ];

  const models = ['ollama', 'claude', 'gpt-4'];
  const intents = ['simple_greeting', 'web_search', 'complex_task', 'general_chat'];
  const statuses = ['success', 'error', 'timeout'];

  const data: Array<{
    name: string;
    type: 'counter' | 'gauge' | 'histogram' | 'timing';
    value: number;
    tags?: Record<string, string>;
  }> = [];

  for (let i = 0; i < count; i++) {
    const name = metricNames[i % metricNames.length];
    let type: 'counter' | 'gauge' | 'histogram' | 'timing';
    let value: number;

    if (name.includes('_hit') || name.includes('_miss')) {
      type = 'counter';
      value = 1;
    } else if (name.includes('depth')) {
      type = 'gauge';
      value = Math.floor(Math.random() * 100);
    } else if (name.includes('time_ms')) {
      type = 'histogram';
      value = Math.random() * 1000 + 50; // 50-1050ms
    } else {
      type = 'counter';
      value = Math.floor(Math.random() * 1000);
    }

    const tags: Record<string, string> = {
      model: models[i % models.length],
      intent: intents[i % intents.length],
      status: statuses[i % statuses.length],
    };

    data.push({ name, type, value, tags });
  }

  return data;
}

/**
 * Wait for a specified duration
 */
function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// Test Suite Setup
// ============================================================================

interface TestContext {
  db: ReturnType<typeof drizzle>;
  sqlite: Database.Database;
  metricsRepo: MetricsRepository;
  metricsService: MetricsService;
}

interface TestResult {
  name: string;
  passed: boolean;
  duration?: number;
  error?: string;
}

const testResults: TestResult[] = [];
let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function createTestContext(): TestContext {
  // Create in-memory database for testing
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite);

  // Create tables
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS metrics (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      value REAL NOT NULL,
      tags TEXT,
      timestamp INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS metrics_name_idx ON metrics(name);
    CREATE INDEX IF NOT EXISTS metrics_timestamp_idx ON metrics(timestamp);
    CREATE INDEX IF NOT EXISTS metrics_name_timestamp_idx ON metrics(name, timestamp);

    CREATE TABLE IF NOT EXISTS metricAggregates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      period TEXT NOT NULL,
      periodStart INTEGER NOT NULL,
      count INTEGER NOT NULL,
      sum REAL NOT NULL,
      min REAL NOT NULL,
      max REAL NOT NULL,
      avg REAL NOT NULL,
      p50 REAL,
      p95 REAL,
      p99 REAL,
      tags TEXT,
      createdAt INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS metricAggregates_name_period_idx
      ON metricAggregates(name, period, periodStart);
    CREATE INDEX IF NOT EXISTS metricAggregates_periodStart_idx
      ON metricAggregates(periodStart);
  `);

  const metricsRepo = new MetricsRepository();
  // @ts-ignore - Use test database
  metricsRepo['db'] = db;

  const metricsService = new MetricsService(metricsRepo, {
    enabled: true,
    flushIntervalMs: 60000, // Disable auto-flush for tests
    retentionDays: 30,
  });

  return { db, sqlite, metricsRepo, metricsService };
}

async function cleanupTestContext(ctx: TestContext): Promise<void> {
  await ctx.metricsService.shutdown();
  ctx.sqlite.close();
}

async function runTest(
  name: string,
  testFn: (ctx: TestContext) => Promise<void>
): Promise<void> {
  totalTests++;
  const ctx = createTestContext();

  try {
    await testFn(ctx);
    testResults.push({ name, passed: true });
    passedTests++;
    console.log(`✓ ${name}`);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    testResults.push({ name, passed: false, error: errorMsg });
    failedTests++;
    console.log(`✗ ${name}`);
    console.log(`  Error: ${errorMsg}`);
  } finally {
    await cleanupTestContext(ctx);
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

// ============================================================================
// Test Cases
// ============================================================================

async function main() {
  console.log('\n' + '='.repeat(70));
  console.log('METRICS SYSTEM LOAD TESTS');
  console.log('='.repeat(70) + '\n');

  // ==========================================================================
  // Test 1: High Volume Metric Recording
  // ==========================================================================

  console.log('\n--- Test 1: High Volume Metric Recording ---\n');

  await runTest('should handle recording 1000 metrics quickly', async (ctx) => {
    const metricData = generateMetricData(1000);

    const { duration } = measureTimeSync(() => {
      for (const data of metricData) {
        ctx.metricsService.increment(data.name, data.tags, data.value);
      }
    });

    assert(duration < THRESHOLDS.RECORD_1000_METRICS,
      `Duration ${duration}ms exceeded threshold ${THRESHOLDS.RECORD_1000_METRICS}ms`);
    console.log(`  Recorded 1000 metrics in ${duration}ms (threshold: ${THRESHOLDS.RECORD_1000_METRICS}ms)`);
  });

  await runTest('should handle recording 10000 metrics quickly', async (ctx) => {
    const metricData = generateMetricData(10000);

    const { duration } = measureTimeSync(() => {
      for (const data of metricData) {
        if (data.type === 'counter') {
          ctx.metricsService.increment(data.name, data.tags, data.value);
        } else if (data.type === 'gauge') {
          ctx.metricsService.gauge(data.name, data.value, data.tags);
        } else {
          ctx.metricsService.histogram(data.name, data.value, data.tags);
        }
      }
    });

    assert(duration < THRESHOLDS.RECORD_10000_METRICS,
      `Duration ${duration}ms exceeded threshold ${THRESHOLDS.RECORD_10000_METRICS}ms`);
    console.log(`  Recorded 10000 metrics in ${duration}ms (threshold: ${THRESHOLDS.RECORD_10000_METRICS}ms)`);
  });

  // ==========================================================================
  // Test 2: Batch Insert Performance
  // ==========================================================================

  console.log('\n--- Test 2: Batch Insert Performance ---\n');

  await runTest('should insert 1000 metrics in batch efficiently', async (ctx) => {
    const metricData = generateMetricData(1000).map((m, i) => ({
      name: m.name,
      type: m.type,
      value: m.value,
      tags: JSON.stringify(m.tags),
      timestamp: Date.now() - i * 1000,
    }));

    const { duration } = await measureTime(async () => {
      await ctx.metricsRepo.recordBatch(metricData);
    });

    assert(duration < THRESHOLDS.BATCH_INSERT_1000,
      `Duration ${duration}ms exceeded threshold ${THRESHOLDS.BATCH_INSERT_1000}ms`);
    console.log(`  Batch inserted 1000 metrics in ${duration}ms (threshold: ${THRESHOLDS.BATCH_INSERT_1000}ms)`);

    const stats = await ctx.metricsRepo.getStats('response_time_ms');
    assert(stats !== null, 'Stats should not be null');
    assert(stats!.count > 0, 'Stats count should be greater than 0');
  });

  await runTest('should insert 5000 metrics in batch efficiently', async (ctx) => {
    const metricData = generateMetricData(5000).map((m, i) => ({
      name: m.name,
      type: m.type,
      value: m.value,
      tags: JSON.stringify(m.tags),
      timestamp: Date.now() - i * 1000,
    }));

    const { duration } = await measureTime(async () => {
      await ctx.metricsRepo.recordBatch(metricData);
    });

    assert(duration < THRESHOLDS.BATCH_INSERT_5000,
      `Duration ${duration}ms exceeded threshold ${THRESHOLDS.BATCH_INSERT_5000}ms`);
    console.log(`  Batch inserted 5000 metrics in ${duration}ms (threshold: ${THRESHOLDS.BATCH_INSERT_5000}ms)`);
  });

  // ==========================================================================
  // Test 3: Flush Performance Under Load
  // ==========================================================================

  console.log('\n--- Test 3: Flush Performance Under Load ---\n');

  await runTest('should flush 1000 pending metrics efficiently', async (ctx) => {
    const metricData = generateMetricData(1000);

    for (const data of metricData) {
      ctx.metricsService.increment(data.name, data.tags, data.value);
    }

    const { duration } = await measureTime(async () => {
      await ctx.metricsService.flush();
    });

    assert(duration < THRESHOLDS.FLUSH_1000_METRICS,
      `Duration ${duration}ms exceeded threshold ${THRESHOLDS.FLUSH_1000_METRICS}ms`);
    console.log(`  Flushed 1000 metrics in ${duration}ms (threshold: ${THRESHOLDS.FLUSH_1000_METRICS}ms)`);

    const stats = await ctx.metricsRepo.getStats('response_time_ms');
    assert(stats !== null, 'Stats should not be null');
  });

  await runTest('should flush 5000 pending metrics efficiently', async (ctx) => {
    const metricData = generateMetricData(5000);

    for (const data of metricData) {
      ctx.metricsService.gauge(data.name, data.value, data.tags);
    }

    const { duration } = await measureTime(async () => {
      await ctx.metricsService.flush();
    });

    assert(duration < THRESHOLDS.FLUSH_5000_METRICS,
      `Duration ${duration}ms exceeded threshold ${THRESHOLDS.FLUSH_5000_METRICS}ms`);
    console.log(`  Flushed 5000 metrics in ${duration}ms (threshold: ${THRESHOLDS.FLUSH_5000_METRICS}ms)`);
  });

  // ==========================================================================
  // Test 4: Aggregation Performance with Large Datasets
  // ==========================================================================

  console.log('\n--- Test 4: Aggregation Performance ---\n');

  await runTest('should aggregate 1000 metrics efficiently', async (ctx) => {
    const now = Date.now();
    const metricData = generateMetricData(1000).map((m, i) => ({
      name: m.name,
      type: m.type,
      value: m.value,
      tags: JSON.stringify(m.tags),
      timestamp: now - i * 1000,
    }));

    await ctx.metricsRepo.recordBatch(metricData);

    const { duration } = await measureTime(async () => {
      await ctx.metricsRepo.aggregate('minute');
    });

    assert(duration < THRESHOLDS.AGGREGATE_1000_METRICS,
      `Duration ${duration}ms exceeded threshold ${THRESHOLDS.AGGREGATE_1000_METRICS}ms`);
    console.log(`  Aggregated 1000 metrics in ${duration}ms (threshold: ${THRESHOLDS.AGGREGATE_1000_METRICS}ms)`);

    const aggregates = await ctx.db
      .select()
      .from(metricAggregates)
      .where(eq(metricAggregates.period, 'minute'));

    assert(aggregates.length > 0, 'Aggregates should be created');
  });

  await runTest('should aggregate 10000 metrics efficiently', async (ctx) => {
    const now = Date.now();
    const allMetricData = generateMetricData(10000);

    // Insert in batches to avoid SQLite variable limit
    const batchSize = 1000;
    for (let i = 0; i < allMetricData.length; i += batchSize) {
      const batch = allMetricData.slice(i, i + batchSize).map((m, j) => ({
        name: m.name,
        type: m.type,
        value: m.value,
        tags: JSON.stringify(m.tags),
        timestamp: now - (i + j) * 100,
      }));
      await ctx.metricsRepo.recordBatch(batch);
    }

    const { duration } = await measureTime(async () => {
      await ctx.metricsRepo.aggregate('minute');
    });

    assert(duration < THRESHOLDS.AGGREGATE_10000_METRICS,
      `Duration ${duration}ms exceeded threshold ${THRESHOLDS.AGGREGATE_10000_METRICS}ms`);
    console.log(`  Aggregated 10000 metrics in ${duration}ms (threshold: ${THRESHOLDS.AGGREGATE_10000_METRICS}ms)`);
  });

  // ==========================================================================
  // Test 5: Query Performance with Many Metrics
  // ==========================================================================

  console.log('\n--- Test 5: Query Performance ---\n');

  await runTest('should query stats with 1000 metrics efficiently', async (ctx) => {
    const now = Date.now();
    const metricData = Array.from({ length: 1000 }, (_, i) => ({
      name: 'response_time_ms',
      type: 'histogram' as const,
      value: Math.random() * 500 + 50,
      tags: JSON.stringify({ model: 'ollama', intent: 'greeting' }),
      timestamp: now - i * 1000,
    }));

    await ctx.metricsRepo.recordBatch(metricData);

    const { duration } = await measureTime(async () => {
      await ctx.metricsRepo.getStats('response_time_ms');
    });

    assert(duration < THRESHOLDS.QUERY_STATS_1000,
      `Duration ${duration}ms exceeded threshold ${THRESHOLDS.QUERY_STATS_1000}ms`);
    console.log(`  Queried stats with 1000 metrics in ${duration}ms (threshold: ${THRESHOLDS.QUERY_STATS_1000}ms)`);
  });

  await runTest('should query stats with 10000 metrics efficiently', async (ctx) => {
    const now = Date.now();

    // Insert in batches to avoid SQLite variable limit
    const batchSize = 1000;
    const totalMetrics = 10000;

    for (let batch = 0; batch < totalMetrics / batchSize; batch++) {
      const metricData = Array.from({ length: batchSize }, (_, i) => ({
        name: 'llm_response_time_ms',
        type: 'histogram' as const,
        value: Math.random() * 1000 + 100,
        tags: JSON.stringify({ model: 'claude' }),
        timestamp: now - (batch * batchSize + i) * 1000,
      }));

      await ctx.metricsRepo.recordBatch(metricData);
    }

    const { duration } = await measureTime(async () => {
      await ctx.metricsRepo.getStats('llm_response_time_ms');
    });

    assert(duration < THRESHOLDS.QUERY_STATS_10000,
      `Duration ${duration}ms exceeded threshold ${THRESHOLDS.QUERY_STATS_10000}ms`);
    console.log(`  Queried stats with 10000 metrics in ${duration}ms (threshold: ${THRESHOLDS.QUERY_STATS_10000}ms)`);
  });

  await runTest('should efficiently query stats with time range filtering', async (ctx) => {
    const now = Date.now();
    const metricData = Array.from({ length: 5000 }, (_, i) => ({
      name: 'cache_hit',
      type: 'counter' as const,
      value: 1,
      tags: undefined,
      timestamp: now - i * 60000,
    }));

    await ctx.metricsRepo.recordBatch(metricData);

    const oneHourAgo = now - 3600000;
    const { duration } = await measureTime(async () => {
      await ctx.metricsRepo.getStats('cache_hit', oneHourAgo, now);
    });

    assert(duration < 100, `Duration ${duration}ms exceeded threshold 100ms`);
    console.log(`  Queried stats with time range in ${duration}ms`);
  });

  // ==========================================================================
  // Test 6: Memory Usage During High Load
  // ==========================================================================

  console.log('\n--- Test 6: Memory Usage ---\n');

  await runTest('should maintain stable memory usage during high volume recording', async (ctx) => {
    const initialMemory = getMemoryUsageMB();

    const metricData = generateMetricData(10000);
    for (const data of metricData) {
      ctx.metricsService.increment(data.name, data.tags, data.value);
    }

    const afterRecordingMemory = getMemoryUsageMB();
    const memoryGrowth = afterRecordingMemory - initialMemory;

    assert(memoryGrowth < THRESHOLDS.MEMORY_STABLE_THRESHOLD_MB,
      `Memory growth ${memoryGrowth.toFixed(2)}MB exceeded threshold ${THRESHOLDS.MEMORY_STABLE_THRESHOLD_MB}MB`);
    console.log(`  Memory growth: ${memoryGrowth.toFixed(2)}MB (threshold: ${THRESHOLDS.MEMORY_STABLE_THRESHOLD_MB}MB)`);

    await ctx.metricsService.flush();
    await wait(100);

    const afterFlushMemory = getMemoryUsageMB();
    const finalMemoryGrowth = afterFlushMemory - initialMemory;
    console.log(`  Memory after flush: ${finalMemoryGrowth.toFixed(2)}MB`);
  });

  await runTest('should handle pending queue overflow gracefully', async (ctx) => {
    const metricData = generateMetricData(15000);

    for (const data of metricData) {
      ctx.metricsService.increment(data.name, data.tags, data.value);
    }

    // Should not crash
    assert(true, 'Should handle overflow gracefully');
  });

  // ==========================================================================
  // Test 7: Concurrent Metric Recording
  // ==========================================================================

  console.log('\n--- Test 7: Concurrent Operations ---\n');

  await runTest('should handle concurrent metric recording', async (ctx) => {
    const concurrentOps = 100;
    const operations: Promise<void>[] = [];

    const { duration } = await measureTime(async () => {
      for (let i = 0; i < concurrentOps; i++) {
        const op = new Promise<void>((resolve) => {
          ctx.metricsService.increment('concurrent_test', { id: i.toString() }, 1);
          ctx.metricsService.gauge('concurrent_gauge', Math.random() * 100, { id: i.toString() });
          ctx.metricsService.histogram('concurrent_histogram', Math.random() * 500, { id: i.toString() });
          resolve();
        });
        operations.push(op);
      }
      await Promise.all(operations);
    });

    assert(duration < THRESHOLDS.CONCURRENT_RECORD_100,
      `Duration ${duration}ms exceeded threshold ${THRESHOLDS.CONCURRENT_RECORD_100}ms`);
    console.log(`  Handled ${concurrentOps} concurrent recordings in ${duration}ms (threshold: ${THRESHOLDS.CONCURRENT_RECORD_100}ms)`);

    await ctx.metricsService.flush();
    const stats = await ctx.metricsRepo.getStats('concurrent_test');
    assert(stats?.count === concurrentOps, `Expected ${concurrentOps} metrics, got ${stats?.count}`);
  });

  await runTest('should handle concurrent recording and flushing', async (ctx) => {
    const recordingOps: Promise<void>[] = [];
    const flushOps: Promise<void>[] = [];

    for (let i = 0; i < 50; i++) {
      const op = new Promise<void>((resolve) => {
        setTimeout(() => {
          ctx.metricsService.increment('concurrent_flush_test', { batch: (i % 5).toString() }, 1);
          resolve();
        }, Math.random() * 100);
      });
      recordingOps.push(op);
    }

    for (let i = 0; i < 5; i++) {
      const op = wait(Math.random() * 50).then(() => ctx.metricsService.flush());
      flushOps.push(op);
    }

    await Promise.all([...recordingOps, ...flushOps]);

    await ctx.metricsService.flush();
    const stats = await ctx.metricsRepo.getStats('concurrent_flush_test');
    assert(stats?.count === 50, `Expected 50 metrics, got ${stats?.count}`);
  });

  // ==========================================================================
  // Test 8: Database Performance with Large Tables
  // ==========================================================================

  console.log('\n--- Test 8: Database Performance with Large Tables ---\n');

  await runTest('should maintain query performance with 50000 metrics in database', async (ctx) => {
    const batchSize = 5000;
    const batches = 10;

    console.log('  Inserting 50000 metrics...');
    for (let batch = 0; batch < batches; batch++) {
      const now = Date.now();
      const metricData = generateMetricData(batchSize).map((m, i) => ({
        name: m.name,
        type: m.type,
        value: m.value,
        tags: JSON.stringify(m.tags),
        timestamp: now - (batch * batchSize + i) * 1000,
      }));

      await ctx.metricsRepo.recordBatch(metricData);
    }

    const { duration } = await measureTime(async () => {
      await ctx.metricsRepo.getStats('response_time_ms');
    });

    assert(duration < 500, `Duration ${duration}ms exceeded threshold 500ms`);
    console.log(`  Queried stats from 50000 metrics in ${duration}ms`);

    const { duration: aggDuration } = await measureTime(async () => {
      await ctx.metricsRepo.aggregate('hour');
    });

    console.log(`  Aggregated 50000 metrics in ${aggDuration}ms`);
  });

  await runTest('should efficiently delete old metrics', async (ctx) => {
    const now = Date.now();
    const metricData = Array.from({ length: 5000 }, (_, i) => ({
      name: 'old_metric',
      type: 'counter' as const,
      value: 1,
      tags: undefined,
      timestamp: now - i * 3600000,
    }));

    await ctx.metricsRepo.recordBatch(metricData);

    const cutoffDate = new Date(now - 30 * 24 * 3600000);
    const { duration, result: deleted } = await measureTime(async () => {
      return await ctx.metricsRepo.pruneOlderThan(cutoffDate);
    });

    assert(deleted > 0, `Expected deleted count > 0, got ${deleted}`);
    assert(duration < 1000, `Duration ${duration}ms exceeded threshold 1000ms`);
    console.log(`  Deleted ${deleted} old metrics in ${duration}ms`);

    const stats = await ctx.metricsRepo.getStats('old_metric');
    assert(stats!.count < 5000, `Expected count < 5000, got ${stats!.count}`);
  });

  // ==========================================================================
  // Test 9: Stress Test - Multiple Operations
  // ==========================================================================

  console.log('\n--- Test 9: Complex Workload ---\n');

  await runTest('should handle complex workload with mixed operations', async (ctx) => {
    const startTime = Date.now();
    const operations: Promise<any>[] = [];

    for (let i = 0; i < 100; i++) {
      const op = new Promise<void>((resolve) => {
        setTimeout(() => {
          ctx.metricsService.increment('workload_counter', { batch: (i % 10).toString() }, 1);
          ctx.metricsService.gauge('workload_gauge', Math.random() * 100);
          ctx.metricsService.histogram('workload_histogram', Math.random() * 500);
          resolve();
        }, Math.random() * 100);
      });
      operations.push(op);
    }

    for (let i = 0; i < 5; i++) {
      const op = wait(i * 50).then(() => ctx.metricsService.flush());
      operations.push(op);
    }

    for (let i = 0; i < 10; i++) {
      const op = wait(Math.random() * 100).then(() =>
        ctx.metricsRepo.getStats('workload_counter')
      );
      operations.push(op);
    }

    await Promise.all(operations);

    const duration = Date.now() - startTime;
    console.log(`  Completed complex workload in ${duration}ms`);
    assert(duration < 5000, `Duration ${duration}ms exceeded threshold 5000ms`);
  });

  // ==========================================================================
  // Test 10: Edge Cases and Error Handling
  // ==========================================================================

  console.log('\n--- Test 10: Edge Cases ---\n');

  await runTest('should handle empty flush gracefully', async (ctx) => {
    const { duration } = await measureTime(async () => {
      await ctx.metricsService.flush();
    });

    assert(duration < 10, `Duration ${duration}ms exceeded threshold 10ms`);
    console.log(`  Empty flush completed in ${duration}ms`);
  });

  await runTest('should handle querying non-existent metrics', async (ctx) => {
    const stats = await ctx.metricsRepo.getStats('non_existent_metric');
    assert(stats === null, 'Stats should be null for non-existent metric');
  });

  await runTest('should handle metrics with special characters in tags', async (ctx) => {
    const specialTags = {
      'key-with-dash': 'value',
      'key.with.dots': 'another-value',
      'key_with_underscore': 'value_123',
    };

    ctx.metricsService.increment('special_chars_test', specialTags, 1);
    await ctx.metricsService.flush();

    const stats = await ctx.metricsRepo.getStats('special_chars_test');
    assert(stats?.count === 1, `Expected count 1, got ${stats?.count}`);
  });

  await runTest('should handle extremely large metric values', async (ctx) => {
    const largeValue = Number.MAX_SAFE_INTEGER / 2;

    ctx.metricsService.gauge('large_value_test', largeValue);
    await ctx.metricsService.flush();

    const stats = await ctx.metricsRepo.getStats('large_value_test');
    assert(stats?.max === largeValue, `Expected max ${largeValue}, got ${stats?.max}`);
    console.log(`  Large metric value ${largeValue} handled correctly`);
  });

  await runTest('should handle rapid successive flushes', async (ctx) => {
    for (let i = 0; i < 100; i++) {
      ctx.metricsService.increment('rapid_flush_test', undefined, 1);
    }

    const flushes = [
      ctx.metricsService.flush(),
      ctx.metricsService.flush(),
      ctx.metricsService.flush(),
      ctx.metricsService.flush(),
      ctx.metricsService.flush(),
    ];

    await Promise.all(flushes);

    const stats = await ctx.metricsRepo.getStats('rapid_flush_test');
    assert(stats?.count === 100, `Expected count 100, got ${stats?.count}`);
  });

  // ==========================================================================
  // Summary
  // ==========================================================================

  console.log('\n' + '='.repeat(70));
  console.log('METRICS SYSTEM PERFORMANCE BENCHMARK SUMMARY');
  console.log('='.repeat(70));

  const benchmarks = [
    { name: 'Record 1000 metrics', threshold: THRESHOLDS.RECORD_1000_METRICS },
    { name: 'Batch insert 1000 metrics', threshold: THRESHOLDS.BATCH_INSERT_1000 },
    { name: 'Flush 1000 metrics', threshold: THRESHOLDS.FLUSH_1000_METRICS },
    { name: 'Aggregate 1000 metrics', threshold: THRESHOLDS.AGGREGATE_1000_METRICS },
    { name: 'Query stats (1000 metrics)', threshold: THRESHOLDS.QUERY_STATS_1000 },
    { name: 'Concurrent operations', threshold: THRESHOLDS.CONCURRENT_RECORD_100 },
  ];

  console.log('\nPerformance Thresholds:');
  benchmarks.forEach((bench) => {
    console.log(`  ${bench.name.padEnd(35)} < ${bench.threshold}ms`);
  });

  console.log('\n' + '='.repeat(70));
  console.log(`Total Tests: ${totalTests}`);
  console.log(`Passed: ${passedTests}`);
  console.log(`Failed: ${failedTests}`);
  console.log('='.repeat(70));

  if (failedTests > 0) {
    console.log('\nFailed Tests:');
    testResults.filter(r => !r.passed).forEach(r => {
      console.log(`  ✗ ${r.name}`);
      console.log(`    ${r.error}`);
    });
    process.exit(1);
  } else {
    console.log('\nAll benchmarks passed! Metrics system performs well under load.');
    console.log('='.repeat(70) + '\n');
  }
}

main().catch(console.error);
