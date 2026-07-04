import { SenderRepository } from './sender.repository';
export { BaseRepository } from './base.repository.js';
import { ChatRepository } from './chat.repository';
import { ChatFilterRepository } from './chatFilter.repository';
import { MessageRepository } from './message.repository';
import { QueueRepository } from './queue.repository';
import { LLMResponseRepository } from './llmResponse.repository';
import { MemoryRepository } from './memory.repository';
import { EmbeddingRepository } from './embedding.repository';
import { UserPreferenceRepository } from './userPreference.repository';
import { ConversationSummaryRepository } from './conversationSummary.repository';
import { IntentLogRepository } from './intentLog.repository';
import { SemanticCacheRepository } from './semanticCache.repository';
import { MetricsRepository } from './metrics.repository';
import { ExperimentRepository } from './experiment.repository';
import { AnalyticsRepository } from './analytics.repository';
import { UserBehaviorRepository } from './userBehavior.repository';
import { CircuitBreakerRepository } from './circuitBreaker.repository';
import { DeadLetterQueueRepository } from './deadLetterQueue.repository';
import { SecurityAuditRepository } from './securityAudit.repository';
import { LoopPatternRepository } from './loopPattern.repository';
import { PlanRepository, PlanExecutionRepository, PlanFeedbackRepository } from './plan.repository';
import { ProactiveJobRepository } from './proactiveJob.repository';
import { ProactiveRunRepository } from './proactiveRun.repository';
import { JokeHistoryRepository } from './jokeHistory.repository';
import { ContactRepository } from './contact.repository';
import { UserRepository } from './user.repository';
import { PlatformIdentityRepository } from './platform-identity.repository';
import { ConversationRepository as UnifiedConversationRepository } from './conversation.repository';
import { TherapistModeRepository } from './therapist-mode.repository';
import { EmotionalStateRepository } from './emotional-state.repository';
import { ConversationDynamicsRepository } from './conversation-dynamics.repository';

export const senderRepository = new SenderRepository();
export const chatRepository = new ChatRepository();
export const chatFilterRepository = new ChatFilterRepository();
export const messageRepository = new MessageRepository();
export const queueRepository = new QueueRepository();
export const llmResponseRepository = new LLMResponseRepository();
export const memoryRepository = new MemoryRepository();
export const embeddingRepository = new EmbeddingRepository();
export const userPreferenceRepository = new UserPreferenceRepository();
export const conversationSummaryRepository = new ConversationSummaryRepository();
export const intentLogRepository = new IntentLogRepository();
export const semanticCacheRepository = new SemanticCacheRepository();
export const metricsRepository = new MetricsRepository();
export const experimentRepository = new ExperimentRepository();
export const analyticsRepository = new AnalyticsRepository();
export const userBehaviorRepository = new UserBehaviorRepository();
export const circuitBreakerRepository = new CircuitBreakerRepository();
export const deadLetterQueueRepository = new DeadLetterQueueRepository();
export const securityAuditRepository = new SecurityAuditRepository();
export const loopPatternRepository = new LoopPatternRepository();
export const planRepository = new PlanRepository();
export const planExecutionRepository = new PlanExecutionRepository();
export const planFeedbackRepository = new PlanFeedbackRepository();
export const proactiveJobRepository = new ProactiveJobRepository();
export const proactiveRunRepository = new ProactiveRunRepository();
export const jokeHistoryRepository = new JokeHistoryRepository();
export const contactRepository = new ContactRepository();
export const userRepository = new UserRepository();
export const platformIdentityRepository = new PlatformIdentityRepository();
export const unifiedConversationRepository = new UnifiedConversationRepository();
export const therapistModeRepository = new TherapistModeRepository();
export const emotionalStateRepository = new EmotionalStateRepository();
export const conversationDynamicsRepository = new ConversationDynamicsRepository();

export {
  LLMResponseRepository,
  MemoryRepository,
  EmbeddingRepository,
  UserPreferenceRepository,
  ConversationSummaryRepository,
  IntentLogRepository,
  SemanticCacheRepository,
  MetricsRepository,
  ExperimentRepository,
  AnalyticsRepository,
  UserBehaviorRepository,
  CircuitBreakerRepository,
  DeadLetterQueueRepository,
  SecurityAuditRepository,
  LoopPatternRepository,
  PlanRepository,
  PlanExecutionRepository,
  PlanFeedbackRepository,
  ProactiveJobRepository,
  ProactiveRunRepository,
  JokeHistoryRepository,
  ContactRepository,
  UserRepository,
  PlatformIdentityRepository,
  UnifiedConversationRepository as ConversationRepository,
  TherapistModeRepository,
  EmotionalStateRepository,
  ConversationDynamicsRepository,
};
