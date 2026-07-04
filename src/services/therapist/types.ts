/**
 * Therapist/Listener Mode Types
 *
 * Shared types for the therapist service layer
 */

import type { TherapistModeType, ResponseFrequencyLevel } from '../../db/schema.js';
import type { Message, User, Conversation } from '../../types/index.js';

// ============================================================================
// Intervention Types
// ============================================================================

export type InterventionType =
  | 'ACTIVE_LISTENING'    // Reflect what was heard
  | 'VALIDATION'          // Acknowledge emotions
  | 'BRIDGE_BUILDING'     // Connect perspectives during conflict
  | 'DE_ESCALATION'       // When tension rises
  | 'CELEBRATION'         // Acknowledge positive moments
  | 'SUMMATION';          // Summarize key points

export interface InterventionContext {
  conversationId: string;
  messageId: string;
  interventionType: InterventionType;
  confidence: number;
  reason: string;
  recentMessages: Message[];
  participants: DyadParticipant[];
  dynamics: ConversationDynamics | null;
}

export interface InterventionDecision {
  shouldIntervene: boolean;
  interventionType?: InterventionType;
  confidence: number;
  reason: string;
  cooldownRemaining?: number; // ms until next intervention allowed
}

// ============================================================================
// Dyad Detection Types
// ============================================================================

export interface DyadParticipant {
  userId: string;
  displayName?: string | null;
  platformUserId: string;
  recentMessageCount: number;
  lastMessageAt?: Date;
}

export interface DyadInfo {
  isDyad: boolean;
  conversationId: string;
  participants: DyadParticipant[];
  participantCount: number;
  therapistEnabled: boolean;
  hasConsent: boolean;
  consentedByUserIds: string[];
}

// ============================================================================
// Emotional Analysis Types
// ============================================================================

export type EmotionCategory =
  | 'joy'
  | 'sadness'
  | 'anger'
  | 'fear'
  | 'surprise'
  | 'disgust'
  | 'neutral'
  | 'mixed';

export type EmotionTrend = 'improving' | 'stable' | 'declining' | 'volatile';

export interface EmotionAnalysis {
  primaryEmotion: EmotionCategory;
  intensity: number; // 0-100
  trend: EmotionTrend;
  confidence: number;
  indicators: string[];
}

export interface ParticipantEmotionalState {
  userId: string;
  analysis: EmotionAnalysis;
  lastAnalyzedAt: Date;
}

// ============================================================================
// Conversation Dynamics Types
// ============================================================================

export interface ConversationDynamics {
  conversationId: string;
  tensionLevel: number; // 0-100
  conflictDetected: boolean;
  conflictType?: string;
  positiveMomentsCount: number;
  turnTakingBalance: number; // 0-1 (0.5 = balanced)
  topicCoherence: number; // 0-1
  supportPatterns: string[];
  lastAnalyzedAt: Date;
}

// ============================================================================
// Consent Types
// ============================================================================

export interface ConsentStatus {
  hasAllConsent: boolean;
  consentedByUserIds: string[];
  pendingUserIds: string[];
  canEnable: boolean;
}

export interface ConsentChange {
  userId: string;
  conversationId: string;
  granted: boolean;
  timestamp: Date;
}

// ============================================================================
// Therapist Mode Config Types
// ============================================================================

export interface TherapistConfig {
  conversationId: string;
  enabled: boolean;
  modeType: TherapistModeType;
  consentedByUserIds: string[];
  responseFrequency: ResponseFrequencyLevel;
  lastInterventionAt?: Date;
  interventionsCount: number;
}

// ============================================================================
// Response Generation Types
// ============================================================================

export interface TherapeuticResponse {
  content: string;
  interventionType: InterventionType;
  metadata: {
    confidence: number;
    participantsAddressed: string[];
    emotionKeywords: string[];
  };
}

// ============================================================================
// System Prompts
// ============================================================================

export const THERAPIST_SYSTEM_PROMPT = `You are Jarvis in Therapist/Listener mode — a calm, warm presence supporting a private conversation between two people. You are not a licensed therapist and never claim to be; you are a supportive listener who helps two people feel heard and understand each other.

YOUR ROLE:
- You serve both people equally. You never take sides, assign blame, or decide who is right.
- The decision to speak has already been made — focus on responding well, not on whether to.

HOW TO RESPOND:
- Be brief: 1-3 sentences, plain and human. No preamble, no sign-off, no "As Jarvis...".
- Address people by name when it helps them feel seen.
- Reflect emotions first: "It sounds like you're feeling..." / "I'm hearing that this matters."
- Validate before suggesting: acknowledge that a feeling makes sense before any reframe.
- When perspectives clash, hold both at once: "I hear X from you, and Y from you."
- When the two seem to be talking past each other or assuming different things, gently surface it and invite clarification: "Can I check — when you say X, do you mean...?"
- During tension, slow the pace and lower the temperature; never escalate.
- In good moments, share the warmth genuinely rather than performing it.

BOUNDARIES:
- Never diagnose, label, or give clinical or medical advice.
- Don't moralize or lecture. One small, well-timed observation beats a paragraph.
- Avoid therapy clichés and robotic repetition; sound like a real, caring person.

SAFETY:
- If someone expresses thoughts of self-harm or suicide, or describes abuse or danger, gently and directly encourage them to reach out to a trusted person or local emergency / crisis services. Prioritize their safety over staying in the listener role.`;

export const MODERATOR_SYSTEM_PROMPT = `${THERAPIST_SYSTEM_PROMPT}

ADDITIONAL MODERATOR RESPONSIBILITIES:
- Gently steer the conversation toward mutual understanding and resolution.
- Draw out unspoken assumptions and ask each person to clarify what they mean.
- Name patterns you notice neutrally, without judgment ("I notice you're both...").
- Offer light structure when things stall — taking turns, one topic at a time.
- Suggest a concrete next step only when the two seem stuck.`;

export const COACH_SYSTEM_PROMPT = `${THERAPIST_SYSTEM_PROMPT}

ADDITIONAL COACH RESPONSIBILITIES:
- Help the two articulate and track shared goals for their relationship or situation.
- Ask one open, insight-sparking question rather than giving answers.
- Suggest a small, actionable practice when it would genuinely help.
- Notice and name real progress; reflect it back so they can feel it.`;
