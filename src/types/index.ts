import { InferSelectModel, InferInsertModel } from 'drizzle-orm';
import {
  senders,
  chats,
  chatFilters,
  messages,
  queue,
  llmResponses,
  memories,
  embeddings,
  userPreferences,
  conversationSummaries,
  intentClassificationLogs,
  semanticCache,
  metrics,
  metricAggregates,
  experiments,
  experimentVariants,
  experimentAssignments,
  experimentEvents,
  deadLetterQueue,
  circuitBreakerStates,
  plans,
  planExecutions,
  planFeedback,
  proactiveJobs,
  proactiveRuns,
  jokeHistory,
  contacts,
  users,
  platformIdentities,
  conversations,
  therapistModeConfig,
  dyadEmotionalStates,
  conversationDynamics as conversationDynamicsTable,
} from '../db/schema';

// ============================================================================
// Core Types - Inferred from Drizzle Schema
// ============================================================================

export type Sender = InferSelectModel<typeof senders>;
export type NewSender = InferInsertModel<typeof senders>;

export type Chat = InferSelectModel<typeof chats>;
export type NewChat = InferInsertModel<typeof chats>;

export type ChatFilter = InferSelectModel<typeof chatFilters>;
export type NewChatFilter = InferInsertModel<typeof chatFilters>;

export type Message = InferSelectModel<typeof messages>;
export type NewMessage = InferInsertModel<typeof messages>;

export type QueueItem = InferSelectModel<typeof queue>;
export type NewQueueItem = InferInsertModel<typeof queue>;

export type LLMResponseRecord = InferSelectModel<typeof llmResponses>;
export type NewLLMResponseRecord = InferInsertModel<typeof llmResponses>;

export type Memory = InferSelectModel<typeof memories>;
export type NewMemory = InferInsertModel<typeof memories>;

export type Embedding = InferSelectModel<typeof embeddings>;
export type NewEmbedding = InferInsertModel<typeof embeddings>;

export type UserPreference = InferSelectModel<typeof userPreferences>;
export type NewUserPreference = InferInsertModel<typeof userPreferences>;

export type ConversationSummary = InferSelectModel<typeof conversationSummaries>;
export type NewConversationSummary = InferInsertModel<typeof conversationSummaries>;

export type IntentClassificationLog = InferSelectModel<typeof intentClassificationLogs>;
export type NewIntentClassificationLog = InferInsertModel<typeof intentClassificationLogs>;

export type SemanticCacheEntry = InferSelectModel<typeof semanticCache>;
export type NewSemanticCacheEntry = InferInsertModel<typeof semanticCache>;

export type MetricEvent = InferSelectModel<typeof metrics>;
export type NewMetricEvent = InferInsertModel<typeof metrics>;

export type MetricAggregate = InferSelectModel<typeof metricAggregates>;
export type NewMetricAggregate = InferInsertModel<typeof metricAggregates>;

export type Experiment = InferSelectModel<typeof experiments>;
export type NewExperiment = InferInsertModel<typeof experiments>;

export type ExperimentVariant = InferSelectModel<typeof experimentVariants>;
export type NewExperimentVariant = InferInsertModel<typeof experimentVariants>;

export type ExperimentAssignment = InferSelectModel<typeof experimentAssignments>;
export type NewExperimentAssignment = InferInsertModel<typeof experimentAssignments>;

export type ExperimentEvent = InferSelectModel<typeof experimentEvents>;
export type NewExperimentEvent = InferInsertModel<typeof experimentEvents>;

export type DeadLetterItem = InferSelectModel<typeof deadLetterQueue>;
export type NewDeadLetterItem = InferInsertModel<typeof deadLetterQueue>;

export type CircuitBreakerStateRecord = InferSelectModel<typeof circuitBreakerStates>;
export type NewCircuitBreakerStateRecord = InferInsertModel<typeof circuitBreakerStates>;

export type Plan = InferSelectModel<typeof plans>;
export type NewPlan = InferInsertModel<typeof plans>;

export type PlanExecution = InferSelectModel<typeof planExecutions>;
export type NewPlanExecution = InferInsertModel<typeof planExecutions>;

export type PlanFeedbackRecord = InferSelectModel<typeof planFeedback>;
export type NewPlanFeedbackRecord = InferInsertModel<typeof planFeedback>;

export type ProactiveJob = InferSelectModel<typeof proactiveJobs>;
export type NewProactiveJob = InferInsertModel<typeof proactiveJobs>;

export type ProactiveRun = InferSelectModel<typeof proactiveRuns>;
export type NewProactiveRun = InferInsertModel<typeof proactiveRuns>;

export type JokeHistoryRecord = InferSelectModel<typeof jokeHistory>;
export type NewJokeHistoryRecord = InferInsertModel<typeof jokeHistory>;

// Contact types
export type Contact = InferSelectModel<typeof contacts>;
export type NewContact = InferInsertModel<typeof contacts>;

// Unified identity types
export type User = InferSelectModel<typeof users>;
export type NewUser = InferInsertModel<typeof users>;

export type PlatformIdentity = InferSelectModel<typeof platformIdentities>;
export type NewPlatformIdentity = InferInsertModel<typeof platformIdentities>;

export type Conversation = InferSelectModel<typeof conversations>;
export type NewConversation = InferInsertModel<typeof conversations>;

// Therapist mode types
export type TherapistModeConfigRow = InferSelectModel<typeof therapistModeConfig>;
export type TherapistModeConfigInsert = InferInsertModel<typeof therapistModeConfig>;

export type DyadEmotionalStateRow = InferSelectModel<typeof dyadEmotionalStates>;
export type DyadEmotionalStateInsert = InferInsertModel<typeof dyadEmotionalStates>;

export type ConversationDynamicsRow = InferSelectModel<typeof conversationDynamicsTable>;
export type ConversationDynamicsInsert = InferInsertModel<typeof conversationDynamicsTable>;

// Re-export contact-related types from schema
export { ContactCategoryType } from '../db/schema.js';

// ============================================================================
// Enum Type Unions
// ============================================================================

export type QueueStatus = 'pending' | 'processing' | 'completed' | 'failed';

export type MediaType = 'photo' | 'document' | 'voice' | 'video' | 'audio' | 'sticker';

export type ChatType = 'private' | 'group' | 'supergroup' | 'channel';

export type FilterType = 'allow' | 'block';

export type MemoryType = 'fact' | 'preference' | 'event' | 'relationship';

export type EmbeddingSourceType = 'message' | 'memory' | 'preference' | 'cache';

export type PreferenceCategory = 'communication' | 'interests' | 'behavior' | 'context';

export type MetricType = 'counter' | 'gauge' | 'histogram' | 'timing';

export type MetricPeriod = 'minute' | 'hour' | 'day';

export type ExperimentStatus = 'draft' | 'running' | 'paused' | 'completed';

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

// ============================================================================
// Service Types
// ============================================================================

export interface ProcessingResult {
  success: boolean;
  error?: string;
  response?: string;
  llmResponseId?: string;
}

export interface IngestMessageInput {
  chatId: string;
  senderId?: string;
  telegramMessageId: number;
  text?: string;
  mediaType?: MediaType;
  mediaPath?: string;
  mediaFileId?: string;
  replyToMessageId?: number;
  forwardFromChatId?: string;
  forwardFromMessageId?: number;
  rawJson: string;
}

export interface FilterCheckResult {
  allowed: boolean;
  priority: number;
}

// ============================================================================
// LLM Types
// ============================================================================

export type PromptType = 'analysis' | 'summary' | 'classification' | 'extraction' | 'response';

// Re-export intent types
export * from './intent.types';

// Re-export metrics types
export * from './metrics.types';

// Re-export LLM types
export * from './llm.types';

// Re-export dashboard types
export * from './dashboard.types';

// Re-export queue types
export * from './queue.types';

// Re-export plan types
export * from './plan.types';

// Re-export analytics types (selective to avoid conflicts with dashboard types)
export type {
  // A/B Testing types
  CreateExperimentInput,
  CreateVariantInput,
  ABTestConfig,
  VariantConfig,
  ExperimentResult,
  StatisticalTestResult,
  ExperimentAnalysis,
  ExperimentEventQueryOptions,
  EndExperimentInput,
  // Conversation Flow types
  AnalyticsTimeRange,
  ConversationSession,
  ConversationTurn,
  FlowPattern,
  ConversationTransition,
  ConversationFlowMetrics,
  ConversationQualityMetrics,
  ConversationFlowOptions,
  SessionIdentificationOptions,
  IntentTransitionMatrix,
  ConversationLengthDistribution,
  ResponseTimeGroupBy,
  ResponseTimeStats,
  ResponseTimeGroup,
  // Report Generation types
  ReportType,
  ReportFormat,
  ReportMetricSnapshot,
  ReportSection,
  ReportMetricsConfig,
  ReportConfig,
  GeneratedReportData,
  GeneratedReport,
  ReportSchedule,
  GenerateReportOptions,
  ReportHistoryOptions,
  CreateReportConfigInput,
  UpdateReportConfigInput,
  CreateReportScheduleInput,
  UpdateReportScheduleInput,
  PerformanceInsight,
  // Model Performance types
  ModelPerformanceMetrics,
  ModelComparison,
  ModelRecommendation,
  ModelBenchmark,
  BenchmarkMetric,
  CostAnalysis,
  CostOptimization,
  PerformanceTrend,
  PerformanceIssue,
  PerformanceIssueType,
  LatencyPercentiles,
  ModelPerformanceReport,
  ModelPerformanceQueryOptions,
} from './analytics.types';

// Re-export security types
export * from './security.types';

// Re-export proactive messaging types
export * from './proactive.types';

// Re-export comic types
export * from './comic.types';
