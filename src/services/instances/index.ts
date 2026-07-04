/**
 * Lazy-loaded service instances
 *
 * This module provides lazy getters for all service instances to:
 * 1. Avoid circular dependencies by deferring instantiation
 * 2. Enable tree-shaking for unused services
 * 3. Improve cold-start performance
 *
 * Usage:
 * ```typescript
 * import { getFilterService, getMemoryService } from './instances';
 *
 * // Service is only loaded when first accessed
 * const filter = getFilterService();
 * ```
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// Core services (telegram, filter, media, llm, identity)
export {
  getFilterService,
  getMediaService,
  getTelegramService,
  getLLMService,
  getMessageLengthService,
  getContactService,
  getIdentityService,
  resetCoreServices,
} from './core';

// AI services (memory, intent, context, cache)
export {
  getMemoryService,
  getConsolidationService,
  getUserPreferenceService,
  getContextManagerService,
  getSemanticCacheService,
  getEnhancedIntentClassifier,
  getEscalationService,
  getImperativeDetectionService,
  getFrustrationDetectorService,
  getEmbeddingClient,
  getClaudeClient,
  resetAIServices,
} from './ai';

// Monitoring services (metrics, health, alerting)
export {
  getMetricsService,
  getMetricsExporterService,
  getAlertingService,
  getAnalyticsService,
  getHealthService,
  getExperimentService,
  getPM2RestartMonitorService,
  resetMonitoringServices,
} from './monitoring';

// Therapist services
export {
  getTherapistService,
  getDyadDetectorService,
  getConsentManagerService,
  getEmotionalAnalyzerService,
  getInterventionEngineService,
  getResponseGeneratorService,
  getDyadContextBuilderService,
  resetTherapistServices,
} from './therapist';

/**
 * Reset all lazy-loaded service instances (for testing)
 */
export function resetAllServices(): void {
  // Import lazily to avoid circular dependency
  const { resetCoreServices } = require('./core');

  const { resetAIServices } = require('./ai');

  const { resetMonitoringServices } = require('./monitoring');

  const { resetTherapistServices } = require('./therapist');

  resetCoreServices();
  resetAIServices();
  resetMonitoringServices();
  resetTherapistServices();
}
