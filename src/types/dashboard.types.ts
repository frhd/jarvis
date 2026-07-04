/**
 * Dashboard Visualization & Analytics Types
 * Comprehensive types for real-time metrics visualization and user engagement analytics
 */

import type { AlertEvent, AlertSeverity, MetricTags } from './metrics.types';
import type { ParentIntent, ChildIntent } from './intent.types';

// ============================================================================
// Time Range Types
// ============================================================================

/**
 * Predefined time range options for dashboard filters
 */
export type TimeRangeOption =
  | 'last_hour'
  | 'last_24h'
  | 'last_7d'
  | 'last_30d'
  | 'custom';

/**
 * Dashboard time range with Unix timestamps (seconds)
 */
export interface DashboardTimeRange {
  /** Start timestamp in seconds */
  from: number;

  /** End timestamp in seconds */
  to: number;

  /** Predefined range label for UI display */
  label?: TimeRangeOption;
}

// ============================================================================
// Chart Data Point Types
// ============================================================================

/**
 * Base data point for time-series visualization
 * Used across all chart types for consistent rendering
 */
export interface ChartDataPoint {
  /** Unix timestamp in milliseconds for precise plotting */
  timestamp: number;

  /** Numeric value for the data point */
  value: number;

  /** Optional human-readable label for tooltips */
  label?: string;

  /** Optional metadata tags for filtering/grouping */
  tags?: MetricTags;
}

// ============================================================================
// Response Time Visualization
// ============================================================================

/**
 * Response time data grouped by model
 * Visualizes performance comparison across different LLM models
 */
export interface ResponseTimeByModel {
  /** Model identifier (e.g., 'ollama', 'claude-opus', 'claude-sonnet') */
  model: string;

  /** Time-series data points for this model */
  dataPoints: ChartDataPoint[];

  /** Statistical summary */
  stats: {
    /** Average response time in milliseconds */
    avgMs: number;

    /** Minimum response time in milliseconds */
    minMs: number;

    /** Maximum response time in milliseconds */
    maxMs: number;

    /** Median response time (p50) */
    p50Ms: number;

    /** 95th percentile response time */
    p95Ms: number;

    /** 99th percentile response time */
    p99Ms: number;

    /** Total number of requests */
    count: number;
  };
}

/**
 * Complete response time chart data
 * Includes overall metrics and per-model breakdowns
 */
export interface ResponseTimeChart {
  /** Overall response time across all models */
  overall: {
    dataPoints: ChartDataPoint[];
    avgMs: number;
    p95Ms: number;
    p99Ms: number;
  };

  /** Per-model response time data */
  byModel: ResponseTimeByModel[];

  /** Time range for this chart */
  timeRange: DashboardTimeRange;

  /** Last updated timestamp */
  lastUpdated: number;
}

// ============================================================================
// Token Usage Visualization
// ============================================================================

/**
 * Token usage breakdown by model
 * Tracks prompt, completion, and total token consumption
 */
export interface TokenUsageByModel {
  /** Model identifier */
  model: string;

  /** Prompt tokens used */
  promptTokens: {
    dataPoints: ChartDataPoint[];
    total: number;
    avg: number;
  };

  /** Completion tokens generated */
  completionTokens: {
    dataPoints: ChartDataPoint[];
    total: number;
    avg: number;
  };

  /** Total tokens (prompt + completion) */
  totalTokens: {
    dataPoints: ChartDataPoint[];
    total: number;
    avg: number;
  };

  /** Estimated cost (if available) */
  estimatedCost?: {
    currency: string;
    amount: number;
  };
}

/**
 * Complete token usage chart data
 * Provides insights into LLM resource consumption
 */
export interface TokenUsageChart {
  /** Per-model token usage */
  byModel: TokenUsageByModel[];

  /** Overall token usage across all models */
  overall: {
    totalPromptTokens: number;
    totalCompletionTokens: number;
    totalTokens: number;
    dataPoints: ChartDataPoint[];
  };

  /** Time range for this chart */
  timeRange: DashboardTimeRange;

  /** Last updated timestamp */
  lastUpdated: number;
}

// ============================================================================
// Intent Classification Accuracy
// ============================================================================

/**
 * Intent classification metrics by intent type
 * Measures classification quality and confidence
 */
export interface IntentAccuracyByIntent {
  /** Parent intent category */
  parentIntent: ParentIntent;

  /** Child intent category */
  childIntent: ChildIntent;

  /** Classification accuracy (0-1) */
  accuracy: number;

  /** Total number of classifications */
  count: number;

  /** Average confidence score (0-1) */
  avgConfidence: number;

  /** Confidence distribution */
  confidenceDistribution: {
    high: number;    // >= 0.85
    medium: number;  // 0.65-0.84
    low: number;     // 0.45-0.64
    uncertain: number; // < 0.45
  };

  /** Escalation rate (0-1) */
  escalationRate: number;

  /** Time-series data for trending */
  dataPoints: ChartDataPoint[];
}

/**
 * Complete intent classification accuracy chart
 * Visualizes classification performance across all intents
 */
export interface IntentAccuracyChart {
  /** Per-intent accuracy metrics */
  byIntent: IntentAccuracyByIntent[];

  /** Overall accuracy metrics */
  overall: {
    accuracy: number;
    avgConfidence: number;
    totalClassifications: number;
    escalationRate: number;
  };

  /** Time range for this chart */
  timeRange: DashboardTimeRange;

  /** Last updated timestamp */
  lastUpdated: number;
}

// ============================================================================
// Queue Status Visualization
// ============================================================================

/**
 * Queue status counts by processing state
 * Real-time view of message processing pipeline
 */
export interface QueueStatusByState {
  /** Queue status ('pending' | 'processing' | 'completed' | 'failed') */
  status: string;

  /** Current count of items in this state */
  count: number;

  /** Historical data points */
  dataPoints: ChartDataPoint[];

  /** Average wait time for this status (ms) */
  avgWaitTimeMs?: number;
}

/**
 * Complete queue status chart data
 * Monitors message processing pipeline health
 */
export interface QueueStatusChart {
  /** Queue status breakdown */
  byStatus: QueueStatusByState[];

  /** Overall queue metrics */
  overall: {
    /** Total items currently in queue */
    totalInQueue: number;

    /** Average processing time (ms) */
    avgProcessingTimeMs: number;

    /** Average wait time (ms) */
    avgWaitTimeMs: number;

    /** Throughput (messages per minute) */
    throughputPerMinute: number;

    /** Error rate (0-1) */
    errorRate: number;
  };

  /** Time range for this chart */
  timeRange: DashboardTimeRange;

  /** Last updated timestamp */
  lastUpdated: number;
}

// ============================================================================
// Cache Performance Metrics
// ============================================================================

/**
 * Semantic cache performance metrics
 * Tracks cache efficiency and resource savings
 */
export interface CachePerformanceChart {
  /** Cache hit rate (0-1) */
  hitRate: number;

  /** Total cache hits */
  totalHits: number;

  /** Total cache misses */
  totalMisses: number;

  /** Total cache lookups */
  totalLookups: number;

  /** Current number of cache entries */
  entries: number;

  /** Average similarity score for hits (0-1) */
  avgSimilarityScore: number;

  /** Time-series data for hit rate trending */
  hitRateDataPoints: ChartDataPoint[];

  /** Time-series data for cache size */
  cacheSizeDataPoints: ChartDataPoint[];

  /** Estimated time saved (ms) */
  timeSavedMs: number;

  /** Estimated tokens saved */
  tokensSaved: number;

  /** Cache lookup performance */
  lookupPerformance: {
    avgLookupTimeMs: number;
    p95LookupTimeMs: number;
    p99LookupTimeMs: number;
  };

  /** Time range for this chart */
  timeRange: DashboardTimeRange;

  /** Last updated timestamp */
  lastUpdated: number;
}

// ============================================================================
// User Engagement Metrics
// ============================================================================

/**
 * Hourly activity distribution
 * Used for peak hour analysis
 */
export interface HourlyActivity {
  /** Hour of day (0-23) */
  hour: number;

  /** Number of messages in this hour */
  messageCount: number;

  /** Unique users active in this hour */
  uniqueUsers: number;

  /** Average response time for this hour (ms) */
  avgResponseTimeMs: number;
}

/**
 * User engagement and activity metrics
 * Provides insights into system usage patterns
 */
export interface UserEngagementMetrics {
  /** Total messages processed in time range */
  messagesProcessed: number;

  /** Number of unique users */
  uniqueUsers: number;

  /** Average response time across all messages (ms) */
  avgResponseTime: number;

  /** Peak activity hour (0-23) */
  peakHour: HourlyActivity;

  /** Hourly activity distribution */
  hourlyDistribution: HourlyActivity[];

  /** Messages by chat type */
  byChatType: {
    private: number;
    group: number;
    supergroup: number;
    channel: number;
  };

  /** Top active users */
  topUsers: Array<{
    senderId: string;
    messageCount: number;
    avgResponseTimeMs: number;
  }>;

  /** Top active chats */
  topChats: Array<{
    chatId: string;
    messageCount: number;
    avgResponseTimeMs: number;
  }>;

  /** Message trends (daily aggregation) */
  messageTrends: ChartDataPoint[];

  /** Time range for these metrics */
  timeRange: DashboardTimeRange;

  /** Last updated timestamp */
  lastUpdated: number;
}

// ============================================================================
// Complete Dashboard Summary
// ============================================================================

/**
 * Complete dashboard data combining all visualizations
 * Single response object for dashboard rendering
 */
export interface DashboardSummary {
  /** Response time chart data */
  responseTime: ResponseTimeChart;

  /** Token usage chart data */
  tokenUsage: TokenUsageChart;

  /** Intent classification accuracy data */
  intentAccuracy: IntentAccuracyChart;

  /** Queue status data */
  queueStatus: QueueStatusChart;

  /** Cache performance data */
  cachePerformance: CachePerformanceChart;

  /** User engagement metrics */
  userEngagement: UserEngagementMetrics;

  /** Active alerts */
  alerts: AlertEvent[];

  /** Dashboard metadata */
  metadata: {
    /** When this dashboard was generated */
    generatedAt: number;

    /** Time range for all metrics */
    timeRange: DashboardTimeRange;

    /** Data freshness in seconds */
    dataFreshnessSeconds: number;

    /** Number of data points included */
    totalDataPoints: number;
  };
}

// ============================================================================
// Dashboard Configuration
// ============================================================================

/**
 * Chart visibility configuration
 * Allows users to customize which charts are displayed
 */
export interface VisibleChartsConfig {
  responseTime: boolean;
  tokenUsage: boolean;
  intentAccuracy: boolean;
  queueStatus: boolean;
  cachePerformance: boolean;
  userEngagement: boolean;
}

/**
 * Dashboard user preferences and configuration
 * Persisted settings for personalized dashboard experience
 */
export interface DashboardConfig {
  /** Auto-refresh interval in seconds (0 = disabled) */
  refreshInterval: number;

  /** Default time range when opening dashboard */
  defaultTimeRange: TimeRangeOption;

  /** Which charts to display */
  visibleCharts: VisibleChartsConfig;

  /** Alert severity filter */
  alertSeverityFilter: AlertSeverity[];

  /** Timezone offset for time display (minutes from UTC) */
  timezoneOffset: number;

  /** Enable real-time updates via WebSocket/polling */
  realtimeUpdates: boolean;

  /** Number of top users/chats to show in engagement metrics */
  topItemsLimit: number;

  /** Date format preference */
  dateFormat: 'relative' | 'absolute' | 'both';

  /** Theme preference */
  theme: 'light' | 'dark' | 'auto';

  /** Data aggregation interval for charts */
  aggregationInterval: 'minute' | 'hour' | 'day';
}

/**
 * Default dashboard configuration
 */
export const DEFAULT_DASHBOARD_CONFIG: DashboardConfig = {
  refreshInterval: 30, // 30 seconds
  defaultTimeRange: 'last_24h',
  visibleCharts: {
    responseTime: true,
    tokenUsage: true,
    intentAccuracy: true,
    queueStatus: true,
    cachePerformance: true,
    userEngagement: true,
  },
  alertSeverityFilter: ['warning', 'error', 'critical'],
  timezoneOffset: 0, // UTC
  realtimeUpdates: true,
  topItemsLimit: 10,
  dateFormat: 'relative',
  theme: 'auto',
  aggregationInterval: 'minute',
};

// ============================================================================
// Dashboard Query Options
// ============================================================================

/**
 * Options for fetching dashboard data
 * Allows selective data loading and optimization
 */
export interface DashboardQueryOptions {
  /** Time range for the dashboard */
  timeRange: DashboardTimeRange;

  /** Which sections to include (omit for all) */
  sections?: Array<keyof Omit<DashboardSummary, 'metadata' | 'alerts'>>;

  /** Data aggregation period */
  aggregationPeriod?: 'minute' | 'hour' | 'day';

  /** Maximum data points per chart */
  maxDataPoints?: number;

  /** Filter by specific models */
  models?: string[];

  /** Filter by specific intents */
  intents?: ChildIntent[];

  /** Filter by chat IDs */
  chatIds?: string[];

  /** Include active alerts */
  includeAlerts?: boolean;

  /** Alert severity filter */
  alertSeverityFilter?: AlertSeverity[];
}

// ============================================================================
// Dashboard Export Types
// ============================================================================

/**
 * Export format options for dashboard data
 */
export type DashboardExportFormat = 'json' | 'csv' | 'pdf' | 'png';

/**
 * Dashboard export request
 */
export interface DashboardExportRequest {
  /** Export format */
  format: DashboardExportFormat;

  /** Time range to export */
  timeRange: DashboardTimeRange;

  /** Sections to include in export */
  sections: Array<keyof Omit<DashboardSummary, 'metadata' | 'alerts'>>;

  /** Include raw data points */
  includeRawData: boolean;

  /** Include charts/visualizations (for PDF/PNG) */
  includeVisualizations?: boolean;

  /** Export title/description */
  title?: string;
  description?: string;
}

// ============================================================================
// Real-time Update Types
// ============================================================================

/**
 * Real-time dashboard update event
 * Sent via WebSocket or polling for live updates
 */
export interface DashboardUpdateEvent {
  /** Update type */
  type: 'metric_update' | 'alert_triggered' | 'alert_resolved' | 'full_refresh';

  /** Timestamp of the update */
  timestamp: number;

  /** Updated section (if partial update) */
  section?: keyof DashboardSummary;

  /** Updated data (if partial update) */
  data?: Partial<DashboardSummary>;

  /** Alert information (if alert event) */
  alert?: AlertEvent;
}

/**
 * Real-time subscription configuration
 */
export interface DashboardSubscription {
  /** Subscription ID */
  id: string;

  /** Update frequency in seconds */
  updateFrequency: number;

  /** Sections to monitor */
  sections: Array<keyof Omit<DashboardSummary, 'metadata' | 'alerts'>>;

  /** Alert subscription settings */
  alertSubscription: {
    enabled: boolean;
    severityFilter: AlertSeverity[];
  };

  /** Created timestamp */
  createdAt: number;

  /** Last update timestamp */
  lastUpdate: number;
}
