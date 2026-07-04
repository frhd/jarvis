/**
 * System-wide limit constants
 *
 * These values define hard limits and defaults across the application.
 * Changes here affect the entire system - modify with caution.
 */

// ============================================================================
// Logging Limits
// ============================================================================
export const LOG_LIMITS = {
  /** Maximum size of a single log file before rotation (bytes) */
  MAX_FILE_SIZE_BYTES: 10 * 1024 * 1024, // 10 MB
  /** Maximum number of rotated log files to keep */
  MAX_ROTATED_FILES: 5,
  /** Maximum length of a single log line before truncation */
  MAX_LINE_LENGTH: 10000,
} as const;

// ============================================================================
// Timeout Limits
// ============================================================================
export const TIMEOUT_LIMITS = {
  /** Default timeout for external service calls (ms) */
  DEFAULT_MS: 30000,
  /** Minimum allowed timeout (ms) */
  MIN_MS: 1000,
  /** Maximum allowed timeout (ms) */
  MAX_MS: 11700000, // 3 hours 15 minutes
} as const;

// ============================================================================
// Buffer/Collection Limits
// ============================================================================
export const BUFFER_LIMITS = {
  /** Maximum response times to track for rolling average */
  RESPONSE_TIMES_BUFFER: 1000,
  /** Maximum sync events to keep in memory */
  MAX_SYNC_EVENTS: 1000,
  /** Maximum items in a batch request */
  MAX_BATCH_SIZE: 100,
} as const;

// ============================================================================
// Retry Limits
// ============================================================================
export const RETRY_LIMITS = {
  /** Minimum retry attempts */
  MIN_ATTEMPTS: 1,
  /** Maximum retry attempts */
  MAX_ATTEMPTS: 10,
  /** Minimum base delay (ms) */
  MIN_BASE_DELAY_MS: 100,
  /** Maximum base delay (ms) */
  MAX_BASE_DELAY_MS: 60000,
  /** Minimum max delay (ms) */
  MIN_MAX_DELAY_MS: 1000,
  /** Maximum max delay (ms) */
  MAX_MAX_DELAY_MS: 3600000, // 1 hour
} as const;

// ============================================================================
// Queue Limits
// ============================================================================
export const QUEUE_LIMITS = {
  /** Minimum priority value */
  MIN_PRIORITY: -100,
  /** Maximum priority value */
  MAX_PRIORITY: 100,
  /** Default retention days */
  DEFAULT_RETENTION_DAYS: 7,
  /** Maximum retention days */
  MAX_RETENTION_DAYS: 365,
} as const;

// ============================================================================
// Memory/Cache Limits
// ============================================================================
export const MEMORY_LIMITS = {
  /** Maximum memories per sender */
  MAX_MEMORIES_PER_SENDER: 10000,
  /** Maximum cache entries */
  MAX_CACHE_ENTRIES: 100000,
  /** Default context window size */
  DEFAULT_CONTEXT_WINDOW: 10,
  /** Maximum context window size */
  MAX_CONTEXT_WINDOW: 100,
} as const;

// ============================================================================
// Token Limits
// ============================================================================
export const TOKEN_LIMITS = {
  /** Minimum max tokens */
  MIN_MAX_TOKENS: 1,
  /** Maximum max tokens (Claude) */
  MAX_MAX_TOKENS: 100000,
  /** Default max tokens */
  DEFAULT_MAX_TOKENS: 1024,
} as const;

// ============================================================================
// Port Limits
// ============================================================================
export const PORT_LIMITS = {
  /** Minimum port number */
  MIN: 1,
  /** Maximum port number */
  MAX: 65535,
} as const;
