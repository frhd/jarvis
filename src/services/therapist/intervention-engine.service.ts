/**
 * Intervention Engine Service
 *
 * Decides when and how to intervene in dyad conversations.
 */

import { logger } from '../../utils/logger.js';
import type {
  InterventionDecision,
  InterventionType,
  ConversationDynamics,
  DyadParticipant,
  ParticipantEmotionalState,
} from './types.js';
import type { Message } from '../../types/index.js';
import type { TherapistConfig } from './types.js';
import type { EnhancedIntentResult } from '../../types/intent.types.js';

/** Minimum messages before first intervention */
const MIN_MESSAGES_BEFORE_INTERVENTION = 3;

/** Default maximum interventions per hour */
const DEFAULT_MAX_RESPONSES_PER_HOUR = 2;

/** Default cooldown between interventions in ms (10 minutes) */
const DEFAULT_COOLDOWN_MS = 600000;

/** One hour in milliseconds */
const ONE_HOUR_MS = 3600000;

/** Tension level threshold for de-escalation */
const TENSION_THRESHOLD = 60;

/** Positive moment celebration threshold */
const CELEBRATION_CONFIDENCE_THRESHOLD = 0.8;

/** Confidence for de-escalation interventions */
const DE_ESCALATION_CONFIDENCE = 0.9;

/** Intensity threshold for emotional validation (0-100) */
const EMOTIONAL_VALIDATION_INTENSITY_THRESHOLD = 60;

/** Lower turn-taking balance threshold (0-1) */
const TURN_TAKING_BALANCE_LOW_THRESHOLD = 0.3;

/** Upper turn-taking balance threshold (0-1) */
const TURN_TAKING_BALANCE_HIGH_THRESHOLD = 0.7;

/** Probability threshold for bridge building on imbalanced turns */
const BRIDGE_BUILDING_PROBABILITY_THRESHOLD = 0.3;

/** Confidence for bridge building interventions */
const BRIDGE_BUILDING_CONFIDENCE = 0.6;

/** Minimum messages for relationship discussion summation */
const SUMMATION_MIN_MESSAGES = 8;

/** Message interval for relationship discussion summation */
const SUMMATION_MESSAGE_INTERVAL = 6;

/** Confidence for summation interventions */
const SUMMATION_CONFIDENCE = 0.7;

/** Confidence assigned when the bot is directly @mentioned */
const DIRECT_MENTION_CONFIDENCE = 1.0;

import type { IInterventionEngineService } from '../../interfaces/therapist.js';
export type { IInterventionEngineService };

export class InterventionEngineService implements IInterventionEngineService {
  private interventionTimestamps: Map<string, number[]> = new Map();

  constructor(
    private options: {
      minMessagesBeforeIntervention?: number;
      maxResponsesPerHour?: number;
      cooldownMs?: number;
      /** Bot handles (without leading @) that, when mentioned, force a response */
      mentionHandles?: string[];
    } = {}
  ) {}

  /**
   * Whether the message text directly @mentions the bot.
   * Matching is case-insensitive against the configured handles.
   */
  private isBotMentioned(text: string): boolean {
    const handles = this.options.mentionHandles ?? [];
    if (!text || handles.length === 0) {
      return false;
    }
    const lower = text.toLowerCase();
    return handles.some(handle => lower.includes(`@${handle.toLowerCase()}`));
  }

  /**
   * Decide whether to intervene and what type
   */
  async shouldIntervene(
    config: TherapistConfig,
    message: Message,
    intent: EnhancedIntentResult | null,
    recentMessages: Message[],
    participants: DyadParticipant[],
    emotionalStates: ParticipantEmotionalState[],
    dynamics: ConversationDynamics | null
  ): Promise<InterventionDecision> {
    const minMessages = this.options.minMessagesBeforeIntervention ?? MIN_MESSAGES_BEFORE_INTERVENTION;
    const maxPerHour = this.options.maxResponsesPerHour ?? DEFAULT_MAX_RESPONSES_PER_HOUR;
    const cooldownMs = this.options.cooldownMs ?? DEFAULT_COOLDOWN_MS;

    // When the bot is directly @mentioned, always respond: skip the throttle
    // gates (min messages, cooldown, rate limit) below. Eligibility gates
    // (enabled / dyad / consent) are still enforced upstream in TherapistService.
    const isMentioned = this.isBotMentioned(message.text || '');

    // 1. Check minimum message count
    if (!isMentioned && recentMessages.length < minMessages) {
      return {
        shouldIntervene: false,
        confidence: 0,
        reason: `Not enough messages yet (${recentMessages.length}/${minMessages})`,
      };
    }

    // 2. Check cooldown period
    const cooldownRemaining = this.getRemainingCooldown(config);
    if (!isMentioned && cooldownRemaining > 0) {
      return {
        shouldIntervene: false,
        confidence: 0,
        reason: 'Cooldown period active',
        cooldownRemaining,
      };
    }

    // 3. Check rate limit (max interventions per hour)
    const timestamps = this.interventionTimestamps.get(config.conversationId) || [];
    const oneHourAgo = Date.now() - ONE_HOUR_MS;
    const recentInterventions = timestamps.filter(t => t > oneHourAgo).length;
    if (!isMentioned && recentInterventions >= maxPerHour) {
      return {
        shouldIntervene: false,
        confidence: 0,
        reason: `Rate limit reached (${recentInterventions}/${maxPerHour} per hour)`,
      };
    }

    const messageText = message.text || '';

    // 4. Check for conflict/tension requiring de-escalation
    if (dynamics && dynamics.tensionLevel >= TENSION_THRESHOLD) {
      return {
        shouldIntervene: true,
        interventionType: 'DE_ESCALATION',
        confidence: DE_ESCALATION_CONFIDENCE,
        reason: `High tension level detected: ${dynamics.tensionLevel}`,
      };
    }

    // 5. Check for conflict moment intent
    if (intent?.childIntent === 'conflict_moment') {
      return {
        shouldIntervene: true,
        interventionType: 'BRIDGE_BUILDING',
        confidence: intent.confidence,
        reason: 'Conflict moment detected from intent',
      };
    }

    // 6. Check for emotional expression needing validation
    if (intent?.childIntent === 'emotional_expression') {
      const senderState = emotionalStates.find(
        s => message.senderId === s.userId
      );

      if (senderState && senderState.analysis.intensity >= EMOTIONAL_VALIDATION_INTENSITY_THRESHOLD) {
        return {
          shouldIntervene: true,
          interventionType: 'VALIDATION',
          confidence: intent.confidence,
          reason: 'Strong emotional expression detected',
        };
      }
    }

    // 7. Check for seeking validation intent
    if (intent?.childIntent === 'seeking_validation') {
      return {
        shouldIntervene: true,
        interventionType: 'VALIDATION',
        confidence: intent.confidence,
        reason: 'User seeking validation',
      };
    }

    // 8. Check for celebration moment
    if (intent?.childIntent === 'celebration_moment') {
      if (intent.confidence >= CELEBRATION_CONFIDENCE_THRESHOLD) {
        return {
          shouldIntervene: true,
          interventionType: 'CELEBRATION',
          confidence: intent.confidence,
          reason: 'Positive celebration moment detected',
        };
      }
    }

    // 9. Check for support request
    if (intent?.childIntent === 'support_request') {
      return {
        shouldIntervene: true,
        interventionType: 'ACTIVE_LISTENING',
        confidence: intent.confidence,
        reason: 'Support request detected',
      };
    }

    // 10. Check dynamics for patterns requiring intervention
    if (dynamics) {
      // Imbalanced turn-taking might need bridge building
      if (
        dynamics.turnTakingBalance < TURN_TAKING_BALANCE_LOW_THRESHOLD ||
        dynamics.turnTakingBalance > TURN_TAKING_BALANCE_HIGH_THRESHOLD
      ) {
        if (Math.random() < BRIDGE_BUILDING_PROBABILITY_THRESHOLD) {
          return {
            shouldIntervene: true,
            interventionType: 'BRIDGE_BUILDING',
            confidence: BRIDGE_BUILDING_CONFIDENCE,
            reason: 'Imbalanced turn-taking detected',
          };
        }
      }
    }

    // 11. Check for relationship discussion that might benefit from summation
    if (intent?.childIntent === 'relationship_discussion') {
      const recentCount = recentMessages.length;
      if (recentCount >= SUMMATION_MIN_MESSAGES && recentCount % SUMMATION_MESSAGE_INTERVAL === 0) {
        return {
          shouldIntervene: true,
          interventionType: 'SUMMATION',
          confidence: SUMMATION_CONFIDENCE,
          reason: 'Relationship discussion could benefit from summary',
        };
      }
    }

    // Default when directly mentioned but no specific trigger matched:
    // respond anyway with neutral active listening.
    if (isMentioned) {
      return {
        shouldIntervene: true,
        interventionType: 'ACTIVE_LISTENING',
        confidence: DIRECT_MENTION_CONFIDENCE,
        reason: 'Directly mentioned',
      };
    }

    // Default: do not intervene
    return {
      shouldIntervene: false,
      confidence: 0,
      reason: 'No intervention triggers met',
    };
  }

  /**
   * Record an intervention for rate limiting
   */
  async recordIntervention(conversationId: string): Promise<void> {
    const now = Date.now();
    const timestamps = this.interventionTimestamps.get(conversationId) || [];

    // Keep only timestamps from the last hour
    const oneHourAgo = now - ONE_HOUR_MS;
    const recentTimestamps = timestamps.filter(t => t > oneHourAgo);
    recentTimestamps.push(now);

    this.interventionTimestamps.set(conversationId, recentTimestamps);

    logger.debug('[InterventionEngine] Recorded intervention', {
      conversationId,
      hourlyCount: recentTimestamps.length,
    });
  }

  /**
   * Get remaining cooldown time in ms
   */
  getRemainingCooldown(config: TherapistConfig): number {
    if (!config.lastInterventionAt) {
      return 0;
    }

    const cooldownMs = this.options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
    const elapsed = Date.now() - config.lastInterventionAt.getTime();
    const remaining = cooldownMs - elapsed;

    return Math.max(0, remaining);
  }
}
