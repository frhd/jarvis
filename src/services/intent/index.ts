/**
 * Intent classification module
 * Re-exports for convenient imports.
 */

export { IntentCacheService, DEFAULT_CACHE_MAX_SIZE, DEFAULT_CACHE_TTL_MS } from './intent-cache.service.js';
export type { IntentCacheConfig } from './intent-cache.service.js';

export {
  IntentMetricsTracker,
  createInitialMetrics,
  DEFAULT_METRICS_LOG_INTERVAL_MS,
  DEFAULT_IN_FLIGHT_CLEANUP_INTERVAL_MS,
  DEFAULT_IN_FLIGHT_STALE_THRESHOLD_MS,
} from './intent-metrics-tracker.service.js';
export type { IntentMetrics, IntentMetricsSnapshot } from './intent-metrics-tracker.service.js';

export { EnhancedIntentClassifierService } from './enhanced-intent-classifier.service.js';
export type {
  EnhancedClassifierConfig,
  IntentCategory,
  IntentClassificationResult,
} from './enhanced-intent-classifier.service.js';

// Re-export types from intent.types for convenience
export type { EnhancedIntentResult, LegacyIntentCategory } from '../../types/intent.types.js';
