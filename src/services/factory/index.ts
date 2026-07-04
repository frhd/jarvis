/**
 * Service Factory Module
 *
 * This module re-exports all service factory modules for centralized access.
 * Each factory module handles instantiation of related services.
 */

// Circuit breaker services
export {
  circuitBreakerConfig,
  ollamaCircuitBreaker,
  claudeCircuitBreaker,
  initializeCircuitBreakers,
} from './circuit-breakers.js';

// Core services
export {
  filterService,
  mediaService,
  telegramService,
  llmService,
  messageLengthService,
  contactService,
  deduplicationService,
  responseDeduplicationService,
  identityService,
} from './core-services.js';

// AI/LLM services
export {
  embeddingClient,
  memoryService,
  consolidationService,
  userPreferenceService,
  contextManagerService,
  semanticCacheService,
  claudeClient,
  intentClassifier,
  enhancedIntentClassifier,
  escalationService,
  imperativeDetectionService,
  frustrationDetectorService,
  voiceTranscriptionFeedbackService,
  startKeepAlive,
  statusHandler,
} from './ai-services.js';

// Command handler service
export { commandHandlerService } from './command-handler.service.js';

// Monitoring services
export {
  metricsService,
  metricsExporterService,
  alertingService,
  pm2RestartMonitorService,
  experimentService,
  analyticsService,
  userBehaviorService,
  initializeMonitoringServices,
  systemService,
} from './monitoring-services.js';

// Comic services
export {
  comicGeneratorService,
} from './comic-services.js';

// Therapist services
export {
  therapistService,
  dyadDetectorService,
  consentManagerService,
  emotionalAnalyzerService,
  interventionEngineService,
  responseGeneratorService,
  dyadContextBuilderService,
} from './therapist-services.js';

// Browser services
export {
  browserService,
} from './browser-services.js';
