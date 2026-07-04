/**
 * Service types (no runtime dependencies)
 *
 * Import from this file when you only need types:
 * import type { HealthStatus, ComponentHealth } from '../services/types';
 */

export type { ErrorCode, ErrorSeverity } from '../errorTracking.service';
export type { RecoveryAction, RecoveryStrategy, RecoveryResult } from '../recovery.service';

export type {
  ComponentHealth,
  SystemHealth,
  HealthStatus,
  HealthCheckOptions,
} from '../health.service';

export type {
  DegradationLevel,
  FallbackStrategy,
  DegradationConfig,
  ServiceHealth,
  FallbackStats,
  DegradationEvent,
  DegradationReport,
} from '../degradation.service';

export type { CircuitBreakerConfig } from '../circuitBreaker.service';

export type {
  FrustrationIndicators,
  FrustrationMetrics,
  FrustrationDetectorConfig,
} from '../frustrationDetector.service';

export type {
  ServiceTier,
  DegradationMode,
  FailoverStrategy,
  IntegrityCheckType,
  RecoveryStrategyType,
  SelfHealingAction,
  HealthCheckSeverity,
  FallbackConfig,
  ChaosInjectionConfig,
  SelfHealingConfig,
  BackupServiceConfig,
  IntegrityCheckConfig,
  IntegrityCheckResult,
  FailoverEvent,
  EnhancedHealthCheck,
  ErrorRecoveryContext,
  ErrorRecoveryResult,
  SelfHealingEvent,
  ReliabilityHardeningConfig,
  ReliabilityHardeningStats,
  ReliabilityReport,
  FailoverConfig,
  FailoverStats,
  SelfHealingServiceConfig,
  SelfHealingStats,
  HealthMonitoringConfig,
  HealthMonitoringStats,
  ChaosError,
} from '../reliability';

export type {
  AudioFormat,
  WhisperTranscription,
  WhisperSegment,
  WhisperWord,
  VoiceActivityResult,
  TranscriptionResult,
  LanguageDetectionResult,
  TTSRequest,
  TTSResult,
  AudioMetadata,
  VoiceProcessingConfig,
} from '../voiceProcessing.service';

export type { IntentRoutingResult, IntentRoutingConfig } from '../routing/intent-routing.service';
export type { RAGContextOptions } from '../routing/context-building.service';
export type { ResponseCacheConfig } from '../routing/response-cache.service';
export type { AntiLoopResult, AntiLoopConfig, PendingAction } from '../routing/anti-loop.service';
export type { LLMRouterConfig, LLMRouterResult } from '../routing/llm-router.service';

export type {
  ExtractionResult as CoordinatorExtractionResult,
  ExtractionCoordinatorConfig,
} from '../processing/extraction-coordinator.service';
export type { FailureAction, RetryCoordinatorConfig } from '../processing/retry-coordinator.service';
export type {
  TranscriptionResult as CoordinatorTranscriptionResult,
  TranscriptionCoordinatorConfig,
} from '../processing/transcription-coordinator.service';

export type {
  ExtractionResult as MemoryExtractionResult,
  RetrievalOptions,
  RetrievalResult,
  MemoryStats,
  ExtractedFact,
} from '../memory.service';

export type {
  ExtractedPreference,
  PreferenceExtractionResult,
  UserProfile,
} from '../userPreference.service';

export type {
  ContextItem,
  RetrievalDebugInfo,
  ContextResult,
  ContextOptions,
} from '../contextManager.service';

export type {
  EnhancedIntentResult,
  LegacyIntentCategory,
  IntentCategory,
  IntentClassificationResult,
  EnhancedClassifierConfig,
} from '../enhancedIntentClassifier.service';

export type { EscalationConfig } from '../escalation.service';

export type {
  ImperativeConfidence,
  ImperativeDetectionResult,
  ConversationState,
  ImperativeDetectionConfig,
} from '../imperativeDetection.service';

export type {
  LoopSignature,
  ConversationPattern,
  LoopDetectionResult,
  LoopType,
} from '../loopPrevention.service';

export type { AnalysisResult } from '../llm.service';
export type { ResponseRouterConfig } from '../responseRouter.service';

export type { MetricData, ExportOptions } from '../metrics-exporter.service';
export type { AlertRule, AlertCallback } from '../alerting.service';

export type {
  UserDataSummary,
  DataExportRequestWithStatus,
  DataDeletionRequestWithStatus,
} from '../dataPrivacy.service';
