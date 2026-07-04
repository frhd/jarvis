/**
 * Application-wide constants
 *
 * This file centralizes magic numbers and hardcoded values throughout the codebase.
 * Each constant has a descriptive name that explains its purpose and unit.
 */

// =============================================================================
// Escalation Confidence Thresholds
// =============================================================================

/** High confidence threshold for escalation - 85% or above is high confidence */
export const ESCALATION_CONFIDENCE_HIGH = 0.85;

/** Medium confidence threshold for escalation - 65% or above is medium confidence */
export const ESCALATION_CONFIDENCE_MEDIUM = 0.65;

/** Low confidence threshold for escalation - 45% or above is low confidence */
export const ESCALATION_CONFIDENCE_LOW = 0.45;

/** Default confidence value when parsing fails or invalid data is provided */
export const ESCALATION_CONFIDENCE_DEFAULT = 0.75;

// =============================================================================
// Consolidation Limits
// =============================================================================

/** Maximum number of memories to fetch for consolidation per sender */
export const CONSOLIDATION_MEMORY_FETCH_LIMIT = 200;

/** Maximum number of similar memories to query when grouping */
export const CONSOLIDATION_QUERY_LIMIT = 20;

/** Minimum character length for consolidated memory content */
export const CONSOLIDATION_MIN_LENGTH = 10;

/** Maximum number of messages to include in a summarization job */
export const CONSOLIDATION_JOB_MESSAGE_LIMIT = 50;

/** Memory count threshold before triggering consolidation */
export const CONSOLIDATION_MEMORY_THRESHOLD = 20;

/** Maximum number of fact memories to process in a consolidation job */
export const CONSOLIDATION_FACT_LIMIT = 1000;

// =============================================================================
// Cleanup Retention (in days)
// =============================================================================

/** Number of days to retain message embeddings before cleanup */
export const CLEANUP_MESSAGE_RETENTION_DAYS = 90;

/** Number of days to retain memory embeddings before cleanup */
export const CLEANUP_MEMORY_RETENTION_DAYS = 180;

/** Number of days to retain preference embeddings before cleanup */
export const CLEANUP_PREFERENCE_RETENTION_DAYS = 180;

// =============================================================================
// Intervals (in milliseconds)
// =============================================================================

/** Default interval for cache cleanup worker runs - 1 hour */
export const CACHE_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

/** Default interval for priority escalation worker runs - 1 minute */
export const PRIORITY_ESCALATION_INTERVAL_MS = 60 * 1000;

/** Default interval for queue cleanup worker runs - 1 hour */
export const QUEUE_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

/** Default interval for DLQ cleanup worker runs - 1 hour */
export const DLQ_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

/** Threshold for detecting stuck jobs - 1 hour */
export const STUCK_JOB_THRESHOLD_MS = 60 * 60 * 1000;

/** Default interval for memory cleanup worker runs - 1 hour */
export const MEMORY_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

// =============================================================================
// Message Limits
// =============================================================================

/** Character length for message preview in escalation logs */
export const ESCALATION_MESSAGE_PREVIEW_LENGTH = 100;

/** Character length for content preview in escalation error logs */
export const ESCALATION_CONTENT_PREVIEW_LENGTH = 200;

/** Maximum number of memories to fetch during orphaned embedding cleanup */
export const MEMORY_CLEANUP_FETCH_LIMIT = 10000;

// =============================================================================
// Time Conversions (for readability)
// =============================================================================

/** Milliseconds in one second */
export const MS_PER_SECOND = 1000;

/** Milliseconds in one minute */
export const MS_PER_MINUTE = 60 * 1000;

/** Milliseconds in one hour */
export const MS_PER_HOUR = 60 * 60 * 1000;

/** Milliseconds in one day */
export const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Seconds in one minute */
export const SECONDS_PER_MINUTE = 60;

/** Seconds in one hour */
export const SECONDS_PER_HOUR = 3600;

/** Seconds in one day */
export const SECONDS_PER_DAY = 86400;

// =============================================================================
// String Preview Lengths
// =============================================================================

/** Character length for message preview in logs */
export const MESSAGE_PREVIEW_LENGTH = 50;

/** Character length for response preview in logs */
export const RESPONSE_PREVIEW_LENGTH = 100;

/** Character length for long content preview in logs */
export const LONG_CONTENT_PREVIEW_LENGTH = 200;

/** Character length for query preview in search logs */
export const QUERY_PREVIEW_LENGTH = 50;

/** Character length for error preview in logs */
export const ERROR_PREVIEW_LENGTH = 100;

/** Character length for hash preview in logs */
export const HASH_PREVIEW_LENGTH = 8;

/** Character length for hash preview in validation */
export const HASH_SHORT_PREVIEW_LENGTH = 16;

/** Character length for stderr preview in logs */
export const STDERR_PREVIEW_LENGTH = 500;

// =============================================================================
// Time Durations (in milliseconds)
// =============================================================================

/** 1 second in milliseconds */
export const SECOND_MS = 1000;

/** 2 seconds in milliseconds */
export const TWO_SECONDS_MS = 2 * SECOND_MS;

/** 5 seconds in milliseconds */
export const FIVE_SECONDS_MS = 5 * SECOND_MS;

/** 10 seconds in milliseconds */
export const TEN_SECONDS_MS = 10 * SECOND_MS;

/** 30 seconds in milliseconds */
export const THIRTY_SECONDS_MS = 30 * SECOND_MS;

/** 3 seconds in milliseconds */
export const THREE_SECONDS_MS = 3 * SECOND_MS;

/** 8 seconds in milliseconds */
export const EIGHT_SECONDS_MS = 8 * SECOND_MS;

// =============================================================================
// Time Durations (in milliseconds) - Minutes and hours
// =============================================================================

/** 5 minutes in milliseconds */
export const FIVE_MINUTES_MS = 5 * MS_PER_MINUTE;

/** 10 minutes in milliseconds */
export const TEN_MINUTES_MS = 10 * MS_PER_MINUTE;

/** 15 minutes in milliseconds */
export const FIFTEEN_MINUTES_MS = 15 * MS_PER_MINUTE;

/** 20 minutes in milliseconds */
export const TWENTY_MINUTES_MS = 20 * MS_PER_MINUTE;

/** 30 minutes in milliseconds */
export const THIRTY_MINUTES_MS = 30 * MS_PER_MINUTE;

/** 1 hour in milliseconds */
export const ONE_HOUR_MS = MS_PER_HOUR;

/** 2 hours in milliseconds */
export const TWO_HOURS_MS = 2 * MS_PER_HOUR;

// =============================================================================
// Token Estimates
// =============================================================================

/** Default estimated output tokens for simple responses */
export const SIMPLE_OUTPUT_TOKENS = 100;

/** Estimated output tokens for code generation */
export const CODE_GEN_OUTPUT_TOKENS = 2500;

/** Estimated output tokens for reasoning tasks */
export const REASONING_OUTPUT_TOKENS = 1500;

/** Estimated output tokens for multi-turn conversations */
export const MULTI_TURN_OUTPUT_TOKENS = 1000;

/** Estimated tokens per image in content */
export const IMAGE_TOKEN_ESTIMATE = 1000;

/** Estimated average input tokens for cost calculation */
export const AVG_INPUT_TOKENS = 1000;

/** Estimated average output tokens for cost calculation */
export const AVG_OUTPUT_TOKENS = 500;

// =============================================================================
// Complexity Thresholds
// =============================================================================

/** Maximum tokens for a simple message */
export const SIMPLE_TOKEN_THRESHOLD = 50;

/** Maximum tokens for quick low-complexity check */
export const QUICK_LOW_TOKEN_THRESHOLD = 30;

/** Threshold for medium complexity */
export const MEDIUM_COMPLEXITY_THRESHOLD = 0.3;

/** Threshold for high complexity */
export const HIGH_COMPLEXITY_THRESHOLD = 0.6;

/** Maximum messages for simple check */
export const SIMPLE_MESSAGE_THRESHOLD = 2;

/** Maximum messages for low complexity check */
export const LOW_MESSAGE_THRESHOLD = 2;

// =============================================================================
// Retry and Recovery
// =============================================================================

/** Default cooldown for retry action */
export const RETRY_COOLDOWN_MS = SECOND_MS;

/** Default cooldown for reconnect action */
export const RECONNECT_COOLDOWN_MS = TWO_SECONDS_MS;

// =============================================================================
// Plan Configuration
// =============================================================================

/** Maximum plan title length */
export const PLAN_TITLE_MAX_LENGTH = 60;

/** Plan title truncation length (with ellipsis) */
export const PLAN_TITLE_TRUNCATE_LENGTH = 57;

/** Maximum words to extract from plan request for title */
export const PLAN_TITLE_WORD_COUNT = 8;

/** Minimum objective length for plan title */
export const PLAN_MIN_OBJECTIVE_LENGTH = 5;

/** Maximum objective length for plan title */
export const PLAN_MAX_OBJECTIVE_LENGTH = 60;

/** Maximum number of plans to list */
export const PLAN_LIST_LIMIT = 10;

/** Progress check interval for execution */
export const EXECUTION_PROGRESS_INTERVAL_MS = 10000;

/** Maximum execution time */
export const MAX_EXECUTION_TIME_MS = 7200000;

/** Graceful shutdown wait time */
export const GRACEFUL_SHUTDOWN_WAIT_MS = 2000;

// =============================================================================
// Memory and Cache
// =============================================================================

/** Health check cache TTL */
export const HEALTH_CACHE_TTL_MS = 30000;

// =============================================================================
// Model Registry
// =============================================================================

/** Default health check timeout */
export const HEALTH_CHECK_TIMEOUT_MS = 5000;

// =============================================================================
// Voice Processing
// =============================================================================

/** Voice transcription health check timeout */
export const VOICE_TRANSCRIPTION_HEALTH_CHECK_TIMEOUT_MS = 5000;

// =============================================================================
// Metrics Service
// =============================================================================

/** Default flush interval for metrics - 10 seconds */
export const METRICS_DEFAULT_FLUSH_INTERVAL_MS = 10000;

/** Default retention period for metrics - 30 days */
export const METRICS_DEFAULT_RETENTION_DAYS = 30;

/** Default aggregation interval - 1 minute */
export const METRICS_DEFAULT_AGGREGATION_INTERVAL_MS = 60000;

/** Maximum pending metrics before emergency flush */
export const METRICS_QUEUE_FLUSH_THRESHOLD = 1000;

/** Maximum pending metrics to prevent memory overflow on failure */
export const METRICS_QUEUE_OVERFLOW_LIMIT = 10000;

// =============================================================================
// Recovery Service
// =============================================================================

/** Maximum recovery history entries to keep */
export const RECOVERY_MAX_HISTORY_SIZE = 1000;

/** Default cooldown period between recovery attempts - 5 seconds */
export const RECOVERY_DEFAULT_COOLDOWN_MS = 5000;

/** Default maximum recovery attempts */
export const RECOVERY_DEFAULT_MAX_ATTEMPTS = 3;

/** Exponential backoff multiplier for cooldown */
export const RECOVERY_BACKOFF_MULTIPLIER = 2;

/** Maximum cooldown period - 5 minutes */
export const RECOVERY_MAX_COOLDOWN_MS = 300000;
