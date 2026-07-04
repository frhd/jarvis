/**
 * Performance Monitoring & Analytics Types
 * Phase 4: Metrics infrastructure for tracking system performance
 */

// Note: MetricType is exported from index.ts (inferred from schema)
// The schema defines: 'counter' | 'gauge' | 'histogram' | 'timing'

// ============================================================================
// Metric Tags
// ============================================================================

/**
 * Tags for metrics (key-value pairs for filtering and grouping)
 * Examples: { model: 'ollama', intent: 'simple_greeting' }
 */
export type MetricTags = Record<string, string>;

// ============================================================================
// Input Types for Recording Metrics
// ============================================================================

// Note: MetricEvent and MetricAggregate are exported from index.ts
// (inferred from Drizzle schema via InferSelectModel)

/**
 * Input for recording a new metric event
 */
export interface RecordMetricInput {
  name: string;
  value: number;
  tags?: MetricTags;
  type: 'counter' | 'gauge' | 'histogram' | 'timing';
  timestamp?: number; // Optional, defaults to current time
}

/**
 * Input for creating a metric aggregate
 */
export interface CreateAggregateInput {
  name: string;
  period: 'minute' | 'hour' | 'day';
  periodStart: number;
  count: number;
  sum: number;
  min: number;
  max: number;
  avg: number;
  p50?: number | null;
  p95?: number | null;
  p99?: number | null;
  tags?: MetricTags;
}

// Type alias for clarity
export type AggregationPeriod = 'minute' | 'hour' | 'day';

// ============================================================================
// Query Types
// ============================================================================

/**
 * Options for querying metrics
 */
export interface MetricQueryOptions {
  name: string;
  startTime?: number;
  endTime?: number;
  tags?: Partial<MetricTags>;
  limit?: number;
}

/**
 * Options for querying aggregates
 */
export interface AggregateQueryOptions {
  name: string;
  period: AggregationPeriod;
  startTime?: number;
  endTime?: number;
  tags?: Partial<MetricTags>;
  limit?: number;
}

/**
 * Time series data point for visualization
 */
export interface TimeSeriesPoint {
  timestamp: number;
  value: number;
  tags?: MetricTags;
}

// ============================================================================
// Metric Name Constants
// ============================================================================

/**
 * Standard metric names used throughout the system
 */
export const METRIC_NAMES = {
  // Response time metrics
  RESPONSE_TIME_MS: 'response_time_ms',
  LLM_RESPONSE_TIME_MS: 'llm_response_time_ms',
  CLAUDE_RESPONSE_TIME_MS: 'claude_response_time_ms',
  OLLAMA_RESPONSE_TIME_MS: 'ollama_response_time_ms',
  CACHE_LOOKUP_TIME_MS: 'cache_lookup_time_ms',

  // Token usage metrics
  TOKEN_USAGE_PROMPT: 'token_usage_prompt',
  TOKEN_USAGE_COMPLETION: 'token_usage_completion',
  TOKEN_USAGE_TOTAL: 'token_usage_total',

  // Cache metrics
  CACHE_HIT: 'cache_hit',
  CACHE_MISS: 'cache_miss',
  CACHE_HIT_RATE: 'cache_hit_rate',
  CACHE_SIZE: 'cache_size',

  // Intent classification metrics
  INTENT_CLASSIFICATION_TIME_MS: 'intent_classification_time_ms',
  INTENT_CONFIDENCE: 'intent_confidence',
  INTENT_ESCALATION: 'intent_escalation',

  // LLM request metrics
  LLM_REQUEST: 'llm_request',
  LLM_REQUEST_SUCCESS: 'llm_request_success',
  LLM_REQUEST_ERROR: 'llm_request_error',

  // Message processing metrics
  MESSAGE_PROCESSED: 'message_processed',
  MESSAGE_PROCESSING_TIME_MS: 'message_processing_time_ms',
  MESSAGE_FAILED: 'message_failed',

  // Queue metrics
  QUEUE_DEPTH: 'queue_depth',
  QUEUE_WAIT_TIME_MS: 'queue_wait_time_ms',
  QUEUE_PROCESSING_TIME_MS: 'queue_processing_time_ms',
  QUEUE_STUCK_MESSAGES: 'queue_stuck_messages',
  QUEUE_STUCK_AGE_MINUTES: 'queue_stuck_age_minutes',
  QUEUE_STUCK_OLDEST_AGE_MINUTES: 'queue_stuck_oldest_age_minutes',

  // Memory & context metrics
  MEMORY_RETRIEVAL_TIME_MS: 'memory_retrieval_time_ms',
  MEMORY_COUNT: 'memory_count',
  CONTEXT_SIZE_TOKENS: 'context_size_tokens',
  CONTEXT_COMPRESSION_RATIO: 'context_compression_ratio',

  // Embedding metrics
  EMBEDDING_GENERATION_TIME_MS: 'embedding_generation_time_ms',
  EMBEDDING_SIMILARITY_SCORE: 'embedding_similarity_score',

  // Message length metrics
  MESSAGE_LENGTH_ORIGINAL: 'message_length_original',
  MESSAGE_LENGTH_FINAL: 'message_length_final',
  MESSAGE_SUMMARIZATION_COUNT: 'message_summarization_count',
  MESSAGE_TRUNCATION_COUNT: 'message_truncation_count',
  MESSAGE_SUMMARIZATION_DURATION_MS: 'message_summarization_duration_ms',

  // Stability metrics (Phase 4)
  OLLAMA_MODEL_LOAD_COUNT: 'ollama_model_load_count',
  TELEGRAM_RECONNECTION_COUNT: 'telegram_reconnection_count',
} as const;

/**
 * Type for metric name values
 */
export type MetricName = typeof METRIC_NAMES[keyof typeof METRIC_NAMES];

// ============================================================================
// Metric Label Constants
// ============================================================================

/**
 * Standard label keys used for filtering and grouping
 */
export const METRIC_LABEL_KEYS = {
  MODEL: 'model',
  INTENT: 'intent',
  PARENT_INTENT: 'parentIntent',
  CHILD_INTENT: 'childIntent',
  CHAT_ID: 'chatId',
  SENDER_ID: 'senderId',
  STATUS: 'status',
  ERROR_TYPE: 'errorType',
  CACHE_HIT: 'cacheHit',
  CLASSIFICATION_METHOD: 'classificationMethod',
  PRIORITY: 'priority',
  MEDIA_TYPE: 'mediaType',
} as const;

// ============================================================================
// Statistics Types
// ============================================================================

/**
 * Statistical summary of metric data
 */
export interface MetricStats {
  name: string;
  count: number;
  sum: number;
  min: number;
  max: number;
  avg: number;
  median?: number;
  p95?: number; // 95th percentile
  p99?: number; // 99th percentile
  tags?: MetricTags;
  period?: {
    start: number;
    end: number;
  };
}

/**
 * Percentile data
 */
export interface PercentileStats {
  p50: number; // Median
  p75: number;
  p90: number;
  p95: number;
  p99: number;
}

// ============================================================================
// Alert Types
// ============================================================================

export type AlertSeverity = 'info' | 'warning' | 'error' | 'critical';

/**
 * Metric alert configuration
 */
export interface MetricAlert {
  id: string;
  name: string;
  metricName: string;
  threshold: number;
  operator: 'gt' | 'lt' | 'eq' | 'gte' | 'lte';
  severity: AlertSeverity;
  enabled: boolean;
  tags?: MetricTags;
  createdAt: number;
}

/**
 * Triggered alert event
 */
export interface AlertEvent {
  id: string;
  alertId: string;
  metricName: string;
  currentValue: number;
  threshold: number;
  severity: AlertSeverity;
  message: string;
  triggeredAt: number;
  resolvedAt?: number;
}
