/**
 * Therapist service and repository interfaces for dependency inversion
 */

import type {
  Message,
  User,
  TherapistModeConfigRow,
  TherapistModeConfigInsert,
  DyadEmotionalStateRow,
  DyadEmotionalStateInsert,
  ConversationDynamicsRow,
  ConversationDynamicsInsert,
} from '../types/index.js';
import type { EnhancedIntentResult } from '../types/intent.types.js';
import type { TherapistModeType, ResponseFrequencyLevel } from '../db/schema.js';
import type {
  DyadInfo,
  DyadParticipant,
  ConsentStatus,
  TherapistConfig,
  EmotionAnalysis,
  ParticipantEmotionalState,
  ConversationDynamics,
  InterventionDecision,
  InterventionContext,
  TherapeuticResponse,
} from '../services/therapist/types.js';
import type { IRepository } from './repositories.js';

// Dyad context result type (moved here to break circular dependency)
export interface DyadContextResult {
  /** Both participants with their context */
  participants: Array<{
    emotionalState?: ParticipantEmotionalState;
    recentMessages: Message[];
    relevantMemories: string[];
  } & Partial<DyadParticipant>>;
  /** Combined conversation context */
  conversationContext: string;
  /** Conversation dynamics */
  dynamics: ConversationDynamics | null;
  /** Topic summary */
  topicSummary: string;
}

// ============================================================================
// Service Interfaces
// ============================================================================

export interface ITherapistService {
  /** Check if therapist mode is enabled for a conversation */
  isEnabledForChat(conversationId: string): Promise<boolean>;

  /** Check if should intervene for a specific message */
  shouldIntervene(
    conversationId: string,
    message: Message,
    recentMessages: Message[],
  ): Promise<InterventionDecision>;

  /** Process a message and generate and send a therapeutic response */
  processAndGenerateResponse(
    conversationId: string,
    message: Message,
    sender: User | null,
    identityOptions?: { userId?: string; conversationId?: string },
  ): Promise<TherapeuticResponse | null>;
}

export interface IDyadDetectorService {
  /** Check if a conversation is a dyad (2-person group) */
  isDyad(conversationId: string): Promise<boolean>;

  /** Get detailed dyad information including participants */
  getDyadInfo(conversationId: string): Promise<DyadInfo | null>;

  /** Get participants in a dyad */
  getParticipants(conversationId: string): Promise<DyadParticipant[]>;

  /** Update participant count for a conversation */
  updateParticipantCount(conversationId: string, count: number): Promise<void>;
}

export interface IConsentManagerService {
  /** Check consent status for a conversation */
  getConsentStatus(conversationId: string, participantIds: string[]): Promise<ConsentStatus>;

  /** Grant consent for a user */
  grantConsent(userId: string, conversationId: string): Promise<boolean>;

  /** Revoke consent for a user */
  revokeConsent(userId: string, conversationId: string): Promise<boolean>;

  /** Enable therapist mode (requires full consent) */
  enableTherapistMode(
    conversationId: string,
    modeType: TherapistModeType,
    responseFrequency: ResponseFrequencyLevel
  ): Promise<boolean>;

  /** Disable therapist mode */
  disableTherapistMode(conversationId: string): Promise<boolean>;

  /** Get therapist config for a conversation */
  getConfig(conversationId: string): Promise<TherapistConfig | null>;
}

export interface IEmotionalAnalyzerService {
  /** Analyze emotional state from messages */
  analyzeEmotion(messages: Message[]): EmotionAnalysis;

  /** Get stored emotional state for a participant */
  getEmotionalState(conversationId: string, userId: string): Promise<ParticipantEmotionalState | null>;

  /** Update stored emotional state */
  updateEmotionalState(
    conversationId: string,
    userId: string,
    analysis: EmotionAnalysis
  ): Promise<void>;

  /** Analyze all participants in a dyad */
  analyzeDyadEmotions(
    conversationId: string,
    messages: Message[]
  ): Promise<ParticipantEmotionalState[]>;
}

export interface IInterventionEngineService {
  /** Decide whether to intervene and what type */
  shouldIntervene(
    config: TherapistConfig,
    message: Message,
    intent: EnhancedIntentResult | null,
    recentMessages: Message[],
    participants: DyadParticipant[],
    emotionalStates: ParticipantEmotionalState[],
    dynamics: ConversationDynamics | null
  ): Promise<InterventionDecision>;

  /** Record an intervention for rate limiting */
  recordIntervention(conversationId: string): Promise<void>;

  /** Get remaining cooldown time */
  getRemainingCooldown(config: TherapistConfig): number;
}

export interface IResponseGeneratorService {
  /** Generate a therapeutic response */
  generateResponse(context: InterventionContext): Promise<TherapeuticResponse>;
}

export interface IConversationDynamicsAnalyzerService {
  /** Analyze conversation dynamics from messages */
  analyzeDynamics(
    conversationId: string,
    messages: Message[]
  ): Promise<ConversationDynamics>;
}

export interface IDyadContextService {
  /** Build comprehensive context for a dyad */
  buildDyadContext(
    conversationId: string,
    participants: DyadParticipant[],
    recentMessages: Message[],
    options?: {
      includeMemories?: boolean;
      includeDynamics?: boolean;
    }
  ): Promise<DyadContextResult>;
}

// ============================================================================
// Repository Interfaces
// ============================================================================

export interface ITherapistModeRepository extends IRepository<TherapistModeConfigRow, TherapistModeConfigInsert> {
  findByConversationId(conversationId: string): Promise<TherapistModeConfigRow | null>;
  upsert(data: TherapistModeConfigInsert): Promise<void>;
  setEnabled(conversationId: string, enabled: boolean): Promise<void>;
  updateIntervention(params: {
    conversationId: string;
    lastInterventionAt: Date;
    interventionsCount: number;
  }): Promise<void>;
}

export interface IEmotionalStateRepository extends IRepository<DyadEmotionalStateRow, DyadEmotionalStateInsert> {
  findByConversationAndUser(conversationId: string, userId: string): Promise<DyadEmotionalStateRow | null>;
  upsert(data: DyadEmotionalStateInsert): Promise<void>;
}

export interface IConversationDynamicsRepository extends IRepository<ConversationDynamicsRow, ConversationDynamicsInsert> {
  findByConversationId(conversationId: string): Promise<ConversationDynamicsRow | null>;
  upsert(data: ConversationDynamicsInsert): Promise<void>;
}
