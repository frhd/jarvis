import {
  ollamaCircuitBreaker,
  claudeCircuitBreaker,
  initializeCircuitBreakers,
  filterService,
  mediaService,
  telegramService,
  llmService,
  messageLengthService,
  contactService,
  deduplicationService,
  responseDeduplicationService,
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
  metricsService,
  metricsExporterService,
  alertingService,
  pm2RestartMonitorService,
  experimentService,
  analyticsService,
  userBehaviorService,
  initializeMonitoringServices,
  comicGeneratorService,
  systemService,
  commandHandlerService,
  identityService,
  therapistService,
  dyadDetectorService,
  consentManagerService,
  emotionalAnalyzerService,
  interventionEngineService,
  responseGeneratorService,
  dyadContextBuilderService,
  browserService,
} from './factory/index';
import { ConfigParsers } from '../utils/config-validation.js';

export {
  ollamaCircuitBreaker,
  claudeCircuitBreaker,
  filterService,
  mediaService,
  telegramService,
  llmService,
  messageLengthService,
  contactService,
  deduplicationService,
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
  metricsService,
  metricsExporterService,
  alertingService,
  pm2RestartMonitorService,
  experimentService,
  analyticsService,
  userBehaviorService,
  comicGeneratorService,
  systemService,
  commandHandlerService,
  identityService,
  therapistService,
  dyadDetectorService,
  consentManagerService,
  emotionalAnalyzerService,
  interventionEngineService,
  responseGeneratorService,
  dyadContextBuilderService,
  browserService,
};

import { ProcessorService } from './processor.service';
import { IngestionService } from './ingestion.service';
import { LLMService } from './llm.service';
import { ResponseRouterService } from './responseRouter.service';
import { CalendarService } from './calendar/calendar.service';
import { CalendarClient } from '../clients/calendar.client';

import { IntentRoutingService } from './routing/intent-routing.service';
import { ContextBuildingService } from './routing/context-building.service';
import { ResponseCacheService } from './routing/response-cache.service';
import { AntiLoopService } from './routing/anti-loop.service';
import { LLMRouterService } from './routing/llm-router.service';

import { ExtractionCoordinatorService } from './processing/extraction-coordinator.service';
import { RetryCoordinatorService } from './processing/retry-coordinator.service';
import { TranscriptionCoordinatorService } from './processing/transcription-coordinator.service';

import { MemoryService } from './memory.service';
import { ConsolidationService } from './consolidation.service';
import { UserPreferenceService } from './userPreference.service';
import { ContextManagerService } from './contextManager.service';
import { ContactService } from './contact.service';
import { SemanticCacheService } from './semanticCache.service';
import { MetricsService } from './metrics.service';
import { MetricsExporterService } from './metrics-exporter.service';
import { AlertingService } from './alerting.service';
import { ExperimentService } from './experiment.service';
import { AnalyticsService } from './analytics.service';
import { UserBehaviorService } from './userBehavior.service';
import { PriorityEscalationService } from './priorityEscalation.service';
import { CircuitBreakerService } from './circuitBreaker.service';
import { RetryStrategyService } from './retryStrategy.service';
import { DeadLetterQueueService } from './deadLetterQueue.service';
import { EnhancedIntentClassifierService } from './enhancedIntentClassifier.service';
import { EscalationService } from './escalation.service';
import { ImperativeDetectionService } from './imperativeDetection.service';
import { FrustrationDetectorService } from './frustrationDetector.service';
import { MessageLengthService } from './messageLength.service';
import { ErrorTrackingService, errorTrackingService } from './errorTracking.service';
import {
  HealthService,
  healthService,
  createDatabaseHealthCheck,
  createQueueHealthCheck,
  createLLMHealthCheck,
  createOllamaWarmthHealthCheck,
  createClaudeHealthCheck,
  createTelegramHealthCheck,
  createDLQHealthCheck,
  createCircuitBreakersHealthCheck,
  createMemoryHealthCheck,
  createStuckMessagesHealthCheck,
  createMessageLengthHealthCheck,
  createPM2RestartHealthCheck,
} from './health.service';
import { DegradationService, degradationService } from './degradation.service';
import { RecoveryService, recoveryService } from './recovery.service';
import { piiService, PIIService } from './pii.service';
import { EncryptionService, encryptionService } from './encryption.service';
import { RetentionService, retentionService, initializeRetentionService } from './retention.service';
import { DataPrivacyService, dataPrivacyService } from './dataPrivacy.service';
import { LoopPreventionService } from './loopPrevention.service';
import {
  securityAuditRepository,
  queueRepository,
  senderRepository,
  chatRepository,
  messageRepository,
  llmResponseRepository,
  memoryRepository,
  embeddingRepository,
  userPreferenceRepository,
  intentLogRepository,
  circuitBreakerRepository,
  deadLetterQueueRepository,
  loopPatternRepository,
} from '../repositories';
import { appConfig } from '../config';
import { DEFAULT_PRIORITY_CONFIG } from '../types/queue.types';
import { createLogger } from '../utils/logger.js';

// ============================================================================
// Named Constants
// ============================================================================

/** Default timeout for critical health checks (5 seconds in milliseconds) */
const CRITICAL_HEALTH_CHECK_TIMEOUT_MS = 5000;

/** Default timeout for standard health checks (10 seconds in milliseconds) */
const STANDARD_HEALTH_CHECK_TIMEOUT_MS = 10000;

/** Default timeout for slow health checks like Claude (15 seconds in milliseconds) */
const SLOW_HEALTH_CHECK_TIMEOUT_MS = 15000;

/** Stuck queue threshold for health checks */
const QUEUE_STUCK_THRESHOLD = 100;

/** Pending queue warning threshold for health checks */
const QUEUE_PENDING_WARNING_THRESHOLD = 1000;

/** Timeout for quick health checks like memory (1 second in milliseconds) */
const QUICK_HEALTH_CHECK_TIMEOUT_MS = 1000;

/** Timeout for PM2 restart health check (60 seconds in milliseconds) */
const PM2_RESTART_CHECK_TIMEOUT_MS = 60000;

const logger = createLogger('Services');

initializeCircuitBreakers().catch((err) => {
  logger.error('Failed to initialize circuit breakers', err);
});

if (appConfig.telegram.enabled) {
  startKeepAlive();
}

initializeMonitoringServices(deadLetterQueueRepository, circuitBreakerRepository);

export const priorityEscalationService = new PriorityEscalationService(
  queueRepository,
  messageRepository,
  DEFAULT_PRIORITY_CONFIG
);

export const retryStrategyService = new RetryStrategyService({
  maxAttempts: appConfig.retry.maxAttempts,
  baseDelayMs: appConfig.retry.baseDelayMs,
  maxDelayMs: appConfig.retry.maxDelayMs,
  backoffMultiplier: appConfig.retry.backoffMultiplier,
  jitterFactor: appConfig.retry.jitterFactor,
});

export const deadLetterQueueService = new DeadLetterQueueService(
  deadLetterQueueRepository,
  queueRepository,
  messageRepository,
  chatRepository
);

export const loopPreventionService = new LoopPreventionService(
  llmService.getClient(),
  loopPatternRepository
);

export const intentRoutingService = new IntentRoutingService(
  intentClassifier,
  enhancedIntentClassifier,
  intentLogRepository
);

export const contextBuildingService = new ContextBuildingService(
  contextManagerService,
  userPreferenceService,
  contactService
);

export const responseCacheService = new ResponseCacheService(
  semanticCacheService,
  { enableCache: appConfig.cache.enabled }
);

export const antiLoopService = new AntiLoopService(
  frustrationDetectorService,
  imperativeDetectionService,
  loopPreventionService
);

export const llmRouterService = new LLMRouterService(
  llmService.getClient(),
  claudeClient,
  llmResponseRepository,
  {
    claudeEnabled: appConfig.claude.enabled,
    claudeModel: appConfig.claude.model,
  }
);

llmRouterService.setOllamaCircuitBreaker(ollamaCircuitBreaker);
llmRouterService.setClaudeCircuitBreaker(claudeCircuitBreaker);
llmRouterService.setMemoryService(memoryService);
llmRouterService.setComicGeneratorService(comicGeneratorService);
if (browserService) {
  llmRouterService.setBrowserService(browserService);
}
llmRouterService.setChatRepository(chatRepository);

export const responseRouter = new ResponseRouterService(
  intentRoutingService,
  contextBuildingService,
  responseCacheService,
  antiLoopService,
  llmRouterService
);

// Wire status handler to response router (must be done after both are created)
responseRouter.setStatusHandler(statusHandler);

// Apple Calendar (CalDAV) — optional, owner-only. Client is created only when
// the feature is enabled and credentials are present.
const calendarClient =
  appConfig.calendar.enabled && appConfig.calendar.appleId && appConfig.calendar.appPassword
    ? new CalendarClient({
        serverUrl: appConfig.calendar.caldavUrl,
        appleId: appConfig.calendar.appleId,
        appPassword: appConfig.calendar.appPassword,
        calendarName: appConfig.calendar.calendarName,
      })
    : null;

export const calendarService = new CalendarService(
  { enabled: appConfig.calendar.enabled, timezone: appConfig.calendar.timezone },
  calendarClient,
  llmService.getClient()
);
responseRouter.setCalendarService(calendarService);

export const extractionCoordinatorService = new ExtractionCoordinatorService(
  memoryService,
  userPreferenceService,
  messageRepository,
  { contextWindowSize: 5, enabled: appConfig.memory.enabled }
);

export const retryCoordinatorService = new RetryCoordinatorService(
  queueRepository,
  retryStrategyService,
  deadLetterQueueService,
  { maxAttempts: appConfig.retry.maxAttempts }
);

// TranscriptionService is created later, so we create with null and set it after
export const transcriptionCoordinatorService = new TranscriptionCoordinatorService(
  null,
  { enabled: appConfig.whisper.enabled }
);

// Wire transcription feedback service to transcription coordinator
transcriptionCoordinatorService.setFeedbackService(voiceTranscriptionFeedbackService);

export const processorService = new ProcessorService(
  queueRepository,
  llmService,
  responseRouter,
  messageRepository,
  telegramService,
  extractionCoordinatorService,
  retryCoordinatorService,
  transcriptionCoordinatorService,
  responseDeduplicationService
);

processorService.setMessageLengthService(messageLengthService);
processorService.setMetricsService(metricsService);
if (therapistService) {
  processorService.setTherapistService(therapistService);
}

export const ingestionService = new IngestionService(
  senderRepository,
  chatRepository,
  messageRepository,
  queueRepository,
  filterService,
  mediaService,
  processorService,
  deduplicationService,
  appConfig.telegram.enabled ? telegramService : undefined
);

errorTrackingService.setMetricsService(metricsService);

degradationService.registerHealthListener(healthService, 'health');

healthService.onHealthChange((systemHealth) => {
  for (const component of systemHealth.components) {
    if (component.status === 'unhealthy' && recoveryService.isAutoRecoveryEnabled(component.name)) {
      const error = new Error(component.error || `${component.name} is unhealthy`);
      recoveryService.handleHealthDegradation(component.name, error).catch((err) => {
        logger.error(`Recovery failed for ${component.name}`, err);
      });
    }
  }
});

recoveryService.enableAutoRecovery('database');
if (appConfig.telegram.enabled) {
  recoveryService.enableAutoRecovery('telegram');
}
recoveryService.enableAutoRecovery('ollama');
recoveryService.enableAutoRecovery('claude');
recoveryService.enableAutoRecovery('queue');

initializeRetentionService(appConfig.security.retention, securityAuditRepository);

healthService.registerCheck(
  'database',
  createDatabaseHealthCheck(),
  { critical: true, timeout: CRITICAL_HEALTH_CHECK_TIMEOUT_MS }
);

healthService.registerCheck(
  'queue',
  createQueueHealthCheck(queueRepository, { stuckThreshold: QUEUE_STUCK_THRESHOLD, pendingWarningThreshold: QUEUE_PENDING_WARNING_THRESHOLD }),
  { critical: true, timeout: CRITICAL_HEALTH_CHECK_TIMEOUT_MS }
);

if (appConfig.telegram.enabled) {
  healthService.registerCheck(
    'llm',
    createLLMHealthCheck(llmService.getClient()),
    { critical: false, timeout: STANDARD_HEALTH_CHECK_TIMEOUT_MS }
  );

  healthService.registerCheck(
    'ollamaWarmth',
    createOllamaWarmthHealthCheck({
      baseUrl: appConfig.llm.baseUrl,
      model: appConfig.llm.model,
    }),
    { critical: false, timeout: CRITICAL_HEALTH_CHECK_TIMEOUT_MS }
  );
}

healthService.registerCheck(
  'claude',
  createClaudeHealthCheck(claudeClient),
  { critical: false, timeout: SLOW_HEALTH_CHECK_TIMEOUT_MS }
);

if (appConfig.telegram.enabled) {
  healthService.registerCheck(
    'telegram',
    createTelegramHealthCheck(telegramService),
    { critical: true, timeout: CRITICAL_HEALTH_CHECK_TIMEOUT_MS }
  );
}

healthService.registerCheck(
  'dlq',
  createDLQHealthCheck(deadLetterQueueService, { sizeWarningThreshold: 100, ageWarningThresholdMs: 24 * 60 * 60 * 1000 }),
  { critical: false, timeout: CRITICAL_HEALTH_CHECK_TIMEOUT_MS }
);

healthService.registerCheck(
  'circuitBreakers',
  createCircuitBreakersHealthCheck([ollamaCircuitBreaker, claudeCircuitBreaker]),
  { critical: false, timeout: CRITICAL_HEALTH_CHECK_TIMEOUT_MS }
);

healthService.registerCheck(
  'memory',
  createMemoryHealthCheck({
    warningThreshold: appConfig.performance.memoryWarningThreshold / 100,
    criticalThreshold: appConfig.performance.memoryCriticalThreshold / 100,
  }),
  { critical: false, timeout: QUICK_HEALTH_CHECK_TIMEOUT_MS }
);

healthService.registerCheck(
  'stuckMessages',
  createStuckMessagesHealthCheck(queueRepository, {
    thresholdMs: appConfig.queueCleanup.stuckThresholdMs,
    warningCount: 5,
    criticalCount: 10,
    criticalAgeMinutes: 120,
  }),
  { critical: false, timeout: CRITICAL_HEALTH_CHECK_TIMEOUT_MS }
);

healthService.registerCheck(
  'messageLength',
  createMessageLengthHealthCheck(messageLengthService, {
    summarizationWarningThreshold: 20,
    truncationWarningThreshold: 5,
    truncationCriticalThreshold: 10,
  }),
  { critical: false, timeout: QUICK_HEALTH_CHECK_TIMEOUT_MS }
);

export { healthService };
export { errorTrackingService };
export { degradationService };
export { recoveryService };
export { piiService };
export { encryptionService, retentionService, dataPrivacyService };
export { LLMService, MemoryService, ConsolidationService, UserPreferenceService, ContextManagerService, EnhancedIntentClassifierService, EscalationService, ImperativeDetectionService, FrustrationDetectorService, SemanticCacheService, MetricsService, MetricsExporterService, AlertingService, ExperimentService, AnalyticsService, UserBehaviorService, PriorityEscalationService, CircuitBreakerService, RetryStrategyService, DeadLetterQueueService, ErrorTrackingService, DegradationService, RecoveryService, HealthService, PIIService, EncryptionService, RetentionService, DataPrivacyService, LoopPreventionService, MessageLengthService };
export { IdentityService } from './identity.service';

export { IntentRoutingService } from './routing/intent-routing.service';
export { ContextBuildingService } from './routing/context-building.service';
export { ResponseCacheService } from './routing/response-cache.service';
export { AntiLoopService } from './routing/anti-loop.service';
export { LLMRouterService } from './routing/llm-router.service';
export * from './routing/index';

export { ResponseValidationService } from './responseValidation.service';

export { ExtractionCoordinatorService } from './processing/extraction-coordinator.service';
export { RetryCoordinatorService } from './processing/retry-coordinator.service';
export { TranscriptionCoordinatorService } from './processing/transcription-coordinator.service';

// Comic services
export { ComicGeneratorService } from './comic/comic-generator.service.js';

// Therapist services
export { TherapistService } from './therapist/therapist.service.js';
export { DyadDetectorService } from './therapist/dyad-detector.service.js';
export { ConsentManagerService } from './therapist/consent-manager.service.js';
export { EmotionalAnalyzerService } from './therapist/emotional-analyzer.service.js';
export { InterventionEngineService } from './therapist/intervention-engine.service.js';
export { ResponseGeneratorService } from './therapist/response-generator.service.js';
export { DyadContextService } from './therapist/dyad-context.service.js';

export type * from './types/index';

export {
  getFilterService,
  getMediaService,
  getTelegramService,
  getLLMService,
  getMessageLengthService,
  getContactService,
  getIdentityService,
  resetCoreServices,
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
  getMetricsService,
  getMetricsExporterService,
  getAlertingService,
  getAnalyticsService,
  getHealthService,
  getExperimentService,
  getPM2RestartMonitorService,
  resetMonitoringServices,
  getTherapistService,
  getDyadDetectorService,
  getConsentManagerService,
  getEmotionalAnalyzerService,
  getInterventionEngineService,
  getResponseGeneratorService,
  getDyadContextBuilderService,
  resetTherapistServices,
  resetAllServices,
} from './instances/index';

export { CircuitOpenError } from './circuitBreaker.service';
export { AppError } from './errorTracking.service';
export { RecoveryError } from './recovery.service';

export {
  createDatabaseHealthCheck,
  createQueueHealthCheck,
  createLLMHealthCheck,
  createOllamaWarmthHealthCheck,
  createWhisperHealthCheck,
  createClaudeHealthCheck,
  createTelegramHealthCheck,
  createDLQHealthCheck,
  createCircuitBreakersHealthCheck,
  createMemoryHealthCheck,
  createStuckMessagesHealthCheck,
  createMessageLengthHealthCheck,
} from './health.service';

import { ReliabilityHardeningService, reliabilityHardeningService } from './reliability';

reliabilityHardeningService.registerHealthCheck(
  'database',
  createDatabaseHealthCheck(),
  'critical'
);

reliabilityHardeningService.registerHealthCheck(
  'queue',
  createQueueHealthCheck(queueRepository, { stuckThreshold: QUEUE_STUCK_THRESHOLD, pendingWarningThreshold: QUEUE_PENDING_WARNING_THRESHOLD }),
  'critical'
);

reliabilityHardeningService.registerHealthCheck(
  'llm',
  createLLMHealthCheck(llmService.getClient()),
  'warning'
);

reliabilityHardeningService.registerHealthCheck(
  'claude',
  createClaudeHealthCheck(claudeClient),
  'warning'
);

if (appConfig.telegram.enabled) {
  reliabilityHardeningService.registerHealthCheck(
    'telegram',
    createTelegramHealthCheck(telegramService),
    'critical'
  );
}

reliabilityHardeningService.registerBackupService({
  primaryService: 'claude',
  backupService: 'ollama',
  strategy: 'priority',
  priority: 1,
  healthCheckIntervalMs: 30000,
  failoverThreshold: 3,
  enabled: true,
});

reliabilityHardeningService.registerFallback('llm', {
  fallbackFn: async (_args, _error) => {
    return "I'm having trouble processing your request right now. Please try again in a moment.";
  },
  priority: 100,
  enabled: true,
  maxAttempts: 1,
  delayMs: 0,
});

reliabilityHardeningService.setServiceTier('database', 'critical');
if (appConfig.telegram.enabled) {
  reliabilityHardeningService.setServiceTier('telegram', 'critical');
}
reliabilityHardeningService.setServiceTier('queue', 'critical');
reliabilityHardeningService.setServiceTier('llm', 'important');
reliabilityHardeningService.setServiceTier('claude', 'important');
reliabilityHardeningService.setServiceTier('embedding', 'standard');
reliabilityHardeningService.setServiceTier('cache', 'standard');

export { ReliabilityHardeningService, reliabilityHardeningService };
export { ReliabilityError, FailoverService, SelfHealingService, HealthMonitoringService } from './reliability';

import { VoiceProcessingService } from './voiceProcessing.service';

export const voiceProcessingService = new VoiceProcessingService();

import { TranscriptionService } from './transcription.service';
export const transcriptionService = new TranscriptionService(
  voiceProcessingService,
  messageRepository,
  voiceTranscriptionFeedbackService ?? undefined
);
transcriptionCoordinatorService.setTranscriptionService(transcriptionService);

import { createWhisperHealthCheck } from './health.service';
if (appConfig.whisper.enabled) {
  healthService.registerCheck(
    'whisper',
    createWhisperHealthCheck(voiceProcessingService),
    { critical: false, timeout: STANDARD_HEALTH_CHECK_TIMEOUT_MS }
  );
}

// PM2 restart monitoring for stability alerting
healthService.registerCheck(
  'pm2Restart',
  createPM2RestartHealthCheck({
    warningThreshold: appConfig.pm2.restartWarningThreshold,
    criticalThreshold: appConfig.pm2.restartCriticalThreshold,
    restartRateThresholdPerHour: appConfig.pm2.restartRateThresholdPerHour,
    checkIntervalMs: appConfig.pm2.checkIntervalMs,
  }),
  { critical: false, timeout: PM2_RESTART_CHECK_TIMEOUT_MS }
);

export {
  VoiceProcessingService,
  TranscriptionService,
};

// Plan execution services
import {
  ExecutionCoordinatorService,
  executionCoordinatorService,
} from './executionCoordinator.service';
import { PlanManagementService, planManagementService } from './planManagement.service';
import { PlanIntentHandlerService } from './planIntentHandler.service';
import { ProgressReporterService, progressReporterService } from './progressReporter.service';

// Configure progress reporter with Telegram service (only when Telegram is enabled)
if (appConfig.telegram.enabled) {
  progressReporterService.setTelegramService(telegramService);
}

export {
  ExecutionCoordinatorService,
  executionCoordinatorService,
  PlanManagementService,
  planManagementService,
  PlanIntentHandlerService,
  ProgressReporterService,
  progressReporterService,
};

// ---------------------------------------------------------------------------
// Proactive Messaging Services
// ---------------------------------------------------------------------------

import {
  ProactiveSchedulerService,
  ProactiveExecutorService,
  ProactiveMessageGenerator,
} from './proactive/index';
import {
  proactiveJobRepository,
  proactiveRunRepository,
} from '../repositories';

let proactiveSchedulerService: ProactiveSchedulerService | null = null;
let proactiveExecutorService: ProactiveExecutorService | null = null;
let proactiveMessageGenerator: ProactiveMessageGenerator | null = null;

if (appConfig.proactive.enabled && appConfig.telegram.enabled) {
  proactiveMessageGenerator = new ProactiveMessageGenerator(
    llmService.getClient(),
    { defaultModel: appConfig.llm.model },
  );

  proactiveExecutorService = new ProactiveExecutorService(
    proactiveRunRepository,
    messageRepository,
    proactiveMessageGenerator,
    telegramService,
    {
      targetChatId: appConfig.proactive.targetChatId,
      defaultTimezone: appConfig.proactive.defaultTimezone,
      defaultContextMessages: appConfig.proactive.defaultContextMessages,
    },
    userPreferenceService,
    contextManagerService,
    senderRepository,
  );

  proactiveSchedulerService = new ProactiveSchedulerService(
    proactiveJobRepository,
    {
      enabled: appConfig.proactive.enabled,
      defaultTimezone: appConfig.proactive.defaultTimezone,
      maxConcurrentJobs: appConfig.proactive.maxConcurrentJobs,
      stuckJobThresholdMs: appConfig.proactive.stuckJobThresholdMs,
      defaultContextMessages: appConfig.proactive.defaultContextMessages,
      quietHoursStart: appConfig.proactive.quietHoursStart,
      quietHoursEnd: appConfig.proactive.quietHoursEnd,
      respectQuietHours: appConfig.proactive.respectQuietHours,
      targetChatId: appConfig.proactive.targetChatId,
      workerIntervalMs: appConfig.proactive.workerIntervalMs,
      runHistoryRetentionDays: appConfig.proactive.runHistoryRetentionDays,
    },
  );

  proactiveSchedulerService.setExecutor(proactiveExecutorService);
  logger.info('[Proactive] Services initialized');
}

export {
  proactiveSchedulerService,
  proactiveExecutorService,
  proactiveMessageGenerator,
  ProactiveSchedulerService,
  ProactiveExecutorService,
  ProactiveMessageGenerator,
};
