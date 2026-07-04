import { eq, and, sql, gte, lte, desc } from 'drizzle-orm';
import { db } from '../db/client';
import { metrics, metricAggregates } from '../db/schema';
import { MetricEvent, MetricAggregate, MetricPeriod } from '../types';
import type { MetricStats } from '../types/metrics.types';
import { BaseRepository } from './base.repository';

export class MetricsRepository extends BaseRepository<
  MetricEvent,
  Omit<MetricEvent, 'id'>,
  typeof metrics
> {
  protected table = metrics;

  /**
   * Override create to handle timestamp field instead of createdAt/updatedAt
   */
  async create(data: Omit<MetricEvent, 'id'>): Promise<MetricEvent> {
    const id = this.generateId();

    const inserted = await db
      .insert(this.table)
      .values({
        id,
        name: data.name,
        type: data.type,
        value: data.value,
        tags: data.tags || null,
        timestamp: data.timestamp,
      })
      .returning();

    return inserted[0];
  }

  /**
   * Record a single metric event
   */
  async record(event: Omit<MetricEvent, 'id'>): Promise<MetricEvent> {
    return this.create(event);
  }

  /**
   * Create multiple metric events efficiently in a batch
   * Used by MetricsService.flush()
   */
  async createBatch(events: MetricEvent[]): Promise<void> {
    if (events.length === 0) return;

    const values = events.map((event) => ({
      id: event.id,
      name: event.name,
      type: event.type,
      value: event.value,
      tags: event.tags ? JSON.stringify(event.tags) : null,
      timestamp: new Date(event.timestamp),
    }));

    await db.insert(this.table).values(values);
  }

  /**
   * Query raw metrics by name and time range
   */
  async getMetrics(
    name: string,
    from: number,
    to: number,
    tags?: Record<string, string>
  ): Promise<MetricEvent[]> {
    const fromDate = new Date(from);
    const toDate = new Date(to);

    const conditions = [
      eq(this.table.name, name),
      gte(this.table.timestamp, fromDate),
      lte(this.table.timestamp, toDate),
    ];

    // Filter by tags if provided
    if (tags) {
      const tagsJson = JSON.stringify(tags);
      conditions.push(sql`${this.table.tags} = ${tagsJson}`);
    }

    const results = await db
      .select()
      .from(this.table)
      .where(and(...conditions))
      .orderBy(desc(this.table.timestamp));

    return results;
  }

  /**
   * Get pre-aggregated metrics for a time range
   */
  async getAggregates(
    name: string,
    period: MetricPeriod,
    from: number,
    to: number
  ): Promise<any[]> {
    const fromDate = new Date(from);
    const toDate = new Date(to);

    return await db
      .select()
      .from(metricAggregates)
      .where(
        and(
          eq(metricAggregates.name, name),
          eq(metricAggregates.period, period),
          gte(metricAggregates.periodStart, fromDate),
          lte(metricAggregates.periodStart, toDate)
        )
      )
      .orderBy(desc(metricAggregates.periodStart));
  }

  /**
   * Aggregate raw metrics into summaries for a given period
   * This should be run periodically (e.g., every minute/hour/day)
   */
  async aggregate(period: MetricPeriod = 'minute'): Promise<void> {
    const now = new Date();
    const periodStart = this.getPeriodStart(now, period);
    const periodEnd = new Date(periodStart);

    // Calculate period boundaries
    switch (period) {
      case 'minute':
        periodEnd.setMinutes(periodEnd.getMinutes() + 1);
        break;
      case 'hour':
        periodEnd.setHours(periodEnd.getHours() + 1);
        break;
      case 'day':
        periodEnd.setDate(periodEnd.getDate() + 1);
        break;
    }

    // Get all unique metric names in this period
    const metricNames = await db
      .selectDistinct({ name: this.table.name })
      .from(this.table)
      .where(
        and(
          gte(this.table.timestamp, periodStart),
          lte(this.table.timestamp, periodEnd)
        )
      );

    // Aggregate each metric
    for (const { name } of metricNames) {
      await this.aggregateMetric(name, period, periodStart, periodEnd);
    }
  }

  /**
   * Aggregate a specific metric for a period
   */
  private async aggregateMetric(
    name: string,
    period: MetricPeriod,
    periodStart: Date,
    periodEnd: Date
  ): Promise<void> {
    // Get all values for this metric in the period
    const rawMetrics = await db
      .select()
      .from(this.table)
      .where(
        and(
          eq(this.table.name, name),
          gte(this.table.timestamp, periodStart),
          lte(this.table.timestamp, periodEnd)
        )
      );

    if (rawMetrics.length === 0) return;

    // Group by tags if present
    const tagGroups = this.groupByTags(rawMetrics);

    for (const [tagsKey, groupMetrics] of Object.entries(tagGroups)) {
      const values = groupMetrics.map((m) => m.value).sort((a, b) => a - b);
      const count = values.length;
      const sum = values.reduce((acc, val) => acc + val, 0);
      const min = values[0];
      const max = values[count - 1];
      const avg = sum / count;
      const p50 = this.percentile(values, 50);
      const p95 = this.percentile(values, 95);
      const p99 = this.percentile(values, 99);

      // Upsert aggregate
      const existingAggregate = await db
        .select()
        .from(metricAggregates)
        .where(
          and(
            eq(metricAggregates.name, name),
            eq(metricAggregates.period, period),
            eq(metricAggregates.periodStart, periodStart),
            tagsKey ? eq(metricAggregates.tags, tagsKey) : sql`${metricAggregates.tags} IS NULL`
          )
        )
        .limit(1);

      if (existingAggregate.length > 0) {
        // Update existing
        await db
          .update(metricAggregates)
          .set({
            count,
            sum,
            min,
            max,
            avg,
            p50,
            p95,
            p99,
          })
          .where(eq(metricAggregates.id, existingAggregate[0].id));
      } else {
        // Insert new
        await db.insert(metricAggregates).values({
          id: this.generateId(),
          name,
          period,
          periodStart,
          count,
          sum,
          min,
          max,
          avg,
          p50,
          p95,
          p99,
          tags: tagsKey || null,
          createdAt: new Date(),
        });
      }
    }
  }

  /**
   * Delete raw metrics older than the specified timestamp
   * Aggregates are preserved for historical analysis
   */
  async deleteOlderThan(timestamp: Date): Promise<number> {
    const result = await db
      .delete(this.table)
      .where(lte(this.table.timestamp, timestamp))
      .returning({ id: this.table.id });

    return result.length;
  }

  /**
   * Alias for deleteOlderThan (for backwards compatibility)
   */
  async pruneOlderThan(timestamp: Date): Promise<number> {
    return this.deleteOlderThan(timestamp);
  }

  /**
   * Alias for createBatch (for backwards compatibility)
   * Accepts events without IDs and with numeric timestamps
   */
  async recordBatch(events: Array<{
    name: string;
    type: 'counter' | 'gauge' | 'histogram' | 'timing';
    value: number;
    tags?: string; // JSON string from service
    timestamp: number; // Unix timestamp in milliseconds
  }>): Promise<void> {
    if (events.length === 0) return;

    const values = events.map((event) => ({
      id: this.generateId(),
      name: event.name,
      type: event.type,
      value: event.value,
      tags: event.tags || null,
      timestamp: new Date(event.timestamp),
    }));

    await db.insert(this.table).values(values);
  }

  /**
   * Get summary statistics for a metric
   */
  async getStats(
    name: string,
    from?: number | Date,
    to?: number | Date
  ): Promise<MetricStats | null> {
    const conditions = [eq(this.table.name, name)];

    if (from !== undefined) {
      const fromDate = from instanceof Date ? from : new Date(from);
      conditions.push(gte(this.table.timestamp, fromDate));
    }
    if (to !== undefined) {
      const toDate = to instanceof Date ? to : new Date(to);
      conditions.push(lte(this.table.timestamp, toDate));
    }

    const result = await db
      .select({
        count: sql<number>`count(*)`,
        sum: sql<number>`sum(${this.table.value})`,
        min: sql<number>`min(${this.table.value})`,
        max: sql<number>`max(${this.table.value})`,
        avg: sql<number>`avg(${this.table.value})`,
      })
      .from(this.table)
      .where(and(...conditions));

    if (result.length === 0 || result[0].count === 0) {
      return null;
    }

    return {
      name,
      count: Number(result[0].count),
      sum: Number(result[0].sum),
      min: Number(result[0].min),
      max: Number(result[0].max),
      avg: Number(result[0].avg),
    };
  }

  /**
   * Get statistics for a metric filtered by a specific label value
   */
  async getStatsByLabel(
    name: string,
    labelKey: string,
    labelValue: string,
    from?: number | Date,
    to?: number | Date
  ): Promise<MetricStats | null> {
    const conditions = [eq(this.table.name, name)];

    if (from !== undefined) {
      const fromDate = from instanceof Date ? from : new Date(from);
      conditions.push(gte(this.table.timestamp, fromDate));
    }
    if (to !== undefined) {
      const toDate = to instanceof Date ? to : new Date(to);
      conditions.push(lte(this.table.timestamp, toDate));
    }

    // Filter by label using JSON query
    // SQLite doesn't have native JSON functions, so we do simple string matching
    conditions.push(sql`${this.table.tags} LIKE ${'%"' + labelKey + '":"' + labelValue + '"%'}`);

    const result = await db
      .select({
        count: sql<number>`count(*)`,
        sum: sql<number>`sum(${this.table.value})`,
        min: sql<number>`min(${this.table.value})`,
        max: sql<number>`max(${this.table.value})`,
        avg: sql<number>`avg(${this.table.value})`,
      })
      .from(this.table)
      .where(and(...conditions));

    if (result.length === 0 || result[0].count === 0) {
      return null;
    }

    return {
      name,
      count: Number(result[0].count),
      sum: Number(result[0].sum),
      min: Number(result[0].min),
      max: Number(result[0].max),
      avg: Number(result[0].avg),
      tags: { [labelKey]: labelValue },
    };
  }

  /**
   * Get all unique metric names
   */
  async getMetricNames(): Promise<string[]> {
    const result = await db
      .selectDistinct({ name: this.table.name })
      .from(this.table);

    return result.map((r) => r.name);
  }

  /**
   * Delete all aggregates older than the specified timestamp
   */
  async pruneAggregatesOlderThan(timestamp: Date): Promise<number> {
    const result = await db
      .delete(metricAggregates)
      .where(lte(metricAggregates.periodStart, timestamp))
      .returning({ id: metricAggregates.id });

    return result.length;
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /**
   * Get the start of a period for a given timestamp
   */
  private getPeriodStart(date: Date, period: MetricPeriod): Date {
    const start = new Date(date);
    start.setSeconds(0);
    start.setMilliseconds(0);

    switch (period) {
      case 'minute':
        // Already at minute precision
        break;
      case 'hour':
        start.setMinutes(0);
        break;
      case 'day':
        start.setMinutes(0);
        start.setHours(0);
        break;
    }

    return start;
  }

  /**
   * Calculate percentile from sorted array of values
   */
  private percentile(sortedValues: number[], p: number): number {
    if (sortedValues.length === 0) return 0;
    if (sortedValues.length === 1) return sortedValues[0];

    const index = (p / 100) * (sortedValues.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const weight = index - lower;

    return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
  }

  /**
   * Group metrics by their tags
   */
  private groupByTags(metrics: MetricEvent[]): Record<string, MetricEvent[]> {
    const groups: Record<string, MetricEvent[]> = {};

    for (const metric of metrics) {
      const key = metric.tags || '';
      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(metric);
    }

    return groups;
  }
}
