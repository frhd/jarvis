/**
 * Response Generator Service
 *
 * Generates therapeutic responses based on intervention type and context.
 */

import { logger } from '../../utils/logger.js';
import type {
  InterventionType,
  InterventionContext,
  TherapeuticResponse,
  ParticipantEmotionalState,
  ConversationDynamics,
} from './types.js';
import { THERAPIST_SYSTEM_PROMPT } from './types.js';
import type { Message } from '../../types/index.js';

/** Temperature for LLM response generation (controls randomness) */
const LLM_RESPONSE_TEMPERATURE = 0.7;

/** Maximum tokens for generated responses (keeps them brief) */
const MAX_RESPONSE_TOKENS = 150;

/** Fallback confidence when LLM fails */
const FALLBACK_CONFIDENCE = 0.5;

/** Number of recent messages per participant to include */
const RECENT_MESSAGES_PER_PARTICIPANT = 3;

/** Number of recent messages for conversation context */
const RECENT_MESSAGES_FOR_CONTEXT = 6;

/** Tension level threshold to include in dynamics context */
const DYNAMICS_TENSION_THRESHOLD = 40;

/** Maximum emotion keywords to extract */
const MAX_EMOTION_KEYWORDS = 5;

import type { IResponseGeneratorService } from '../../interfaces/therapist.js';
export type { IResponseGeneratorService };

export class ResponseGeneratorService implements IResponseGeneratorService {
  constructor(
    private llmClient: {
      chat(request: {
        messages: Array<{ role: string; content: string }>;
        temperature?: number;
        maxTokens?: number;
      }): Promise<{ content: string }>;
    }
  ) {}

  /**
   * Generate a therapeutic response
   */
  async generateResponse(context: InterventionContext): Promise<TherapeuticResponse> {
    const { interventionType, recentMessages, participants, dynamics } = context;

    // Build participant context
    const participantContext = this.buildParticipantContext(participants, recentMessages);

    // Build conversation context
    const conversationContext = this.buildConversationContext(recentMessages, dynamics);

    // Get intervention-specific guidance
    const interventionGuidance = this.getInterventionGuidance(interventionType, context);

    // Build the prompt
    const prompt = this.buildPrompt(
      interventionType,
      participantContext,
      conversationContext,
      interventionGuidance
    );

    try {
      const response = await this.llmClient.chat({
        messages: [
          { role: 'system', content: THERAPIST_SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        temperature: LLM_RESPONSE_TEMPERATURE,
        maxTokens: MAX_RESPONSE_TOKENS,
      });

      const content = response.content.trim();

      logger.info('[ResponseGenerator] Generated therapeutic response', {
        interventionType,
        responseLength: content.length,
      });

      return {
        content,
        interventionType,
        metadata: {
          confidence: context.confidence,
          participantsAddressed: participants.map(p => p.userId),
          emotionKeywords: this.extractEmotionKeywords(recentMessages),
        },
      };
    } catch (error) {
      logger.error('[ResponseGenerator] Failed to generate response', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      // Return a fallback response
      return {
        content: this.getFallbackResponse(interventionType),
        interventionType,
        metadata: {
          confidence: FALLBACK_CONFIDENCE,
          participantsAddressed: participants.map(p => p.userId),
          emotionKeywords: [],
        },
      };
    }
  }

  /**
   * Build participant context string
   */
  private buildParticipantContext(
    participants: InterventionContext['participants'],
    recentMessages: Message[]
  ): string {
    const contexts: string[] = [];

    for (const participant of participants) {
      const recentTexts = recentMessages
        .filter(m => m.senderId === participant.userId)
        .slice(-RECENT_MESSAGES_PER_PARTICIPANT)
        .map(m => m.text)
        .filter(Boolean)
        .join(' | ');

      contexts.push(
        `- ${participant.displayName || 'Participant'}: ${recentTexts ? `Recent: "${recentTexts}"` : 'No recent messages'}`
      );
    }

    return contexts.join('\n');
  }

  /**
   * Build conversation context string
   */
  private buildConversationContext(
    recentMessages: Message[],
    dynamics: ConversationDynamics | null
  ): string {
    const formattedMessages = recentMessages
      .slice(-RECENT_MESSAGES_FOR_CONTEXT)
      .map(m => {
        const speaker = m.isBot ? 'Jarvis' : 'User';
        return `${speaker}: ${m.text || '[non-text message]'}`;
      })
      .join('\n');

    let dynamicsContext = '';
    if (dynamics) {
      const parts: string[] = [];
      if (dynamics.tensionLevel > DYNAMICS_TENSION_THRESHOLD) {
        parts.push(`Tension level: ${dynamics.tensionLevel}/100`);
      }
      if (dynamics.conflictDetected) {
        parts.push(`Conflict type: ${dynamics.conflictType || 'unspecified'}`);
      }
      if (dynamics.positiveMomentsCount > 0) {
        parts.push(`Positive moments: ${dynamics.positiveMomentsCount}`);
      }
      if (parts.length > 0) {
        dynamicsContext = `\n\nConversation dynamics:\n${parts.join('\n')}`;
      }
    }

    return `Recent conversation:\n${formattedMessages}${dynamicsContext}`;
  }

  /**
   * Get intervention-specific guidance
   */
  private getInterventionGuidance(
    type: InterventionType,
    context: InterventionContext
  ): string {
    const participantNames = context.participants
      .map(p => p.displayName || 'Participant')
      .join(' and ');

    switch (type) {
      case 'ACTIVE_LISTENING':
        return `Reflect what you're hearing from both participants. Show you understand their perspectives. Use phrases like "It sounds like..." or "I'm hearing that..."`;

      case 'VALIDATION':
        return `Validate the emotions being expressed. Acknowledge feelings without judgment. Use phrases like "That makes sense..." or "It's understandable that..."`;

      case 'BRIDGE_BUILDING':
        return `Help connect the two perspectives. Find common ground or clarify misunderstandings. Use phrases like "I hear ${participantNames} saying..." or "It seems like you both..."`;

      case 'DE_ESCALATION':
        return `Help slow things down. Acknowledge the tension and suggest taking a breath. Use phrases like "Let's take a moment..." or "I can see this is important to both of you..."`;

      case 'CELEBRATION':
        return `Celebrate this positive moment together. Share in their joy. Use phrases like "This is wonderful!" or "It's great to see..."`;

      case 'SUMMATION':
        return `Summarize what you've heard to help clarify. Focus on key points from both sides. Use phrases like "Let me make sure I understand..." or "So far we've discussed..."`;

      default:
        return 'Provide a brief, supportive response that adds value to the conversation.';
    }
  }

  /**
   * Build the full prompt for the LLM
   */
  private buildPrompt(
    interventionType: InterventionType,
    participantContext: string,
    conversationContext: string,
    interventionGuidance: string
  ): string {
    return `You are observing a 2-person conversation. Your intervention type: ${interventionType}

Participants:
${participantContext}

${conversationContext}

Guidance for this intervention:
${interventionGuidance}

Generate a brief (1-3 sentences) therapeutic response:`;
  }

  /**
   * Extract emotion keywords from messages
   */
  private extractEmotionKeywords(messages: Message[]): string[] {
    const emotionWords = [
      'feel', 'feeling', 'sad', 'happy', 'angry', 'frustrated', 'anxious',
      'worried', 'excited', 'scared', 'hurt', 'upset', 'love', 'hate',
    ];

    const found: string[] = [];
    const text = messages.map(m => m.text || '').join(' ').toLowerCase();

    for (const word of emotionWords) {
      if (text.includes(word) && !found.includes(word)) {
        found.push(word);
      }
    }

    return found.slice(0, MAX_EMOTION_KEYWORDS);
  }

  /**
   * Get a fallback response for when LLM fails
   */
  private getFallbackResponse(type: InterventionType): string {
    const fallbacks: Record<InterventionType, string> = {
      ACTIVE_LISTENING: 'I hear both of you sharing important perspectives.',
      VALIDATION: 'Your feelings on this matter are completely valid.',
      BRIDGE_BUILDING: 'It seems like there might be some common ground here.',
      DE_ESCALATION: 'Let\'s take a moment to breathe and hear each other out.',
      CELEBRATION: 'This is a wonderful moment to celebrate together!',
      SUMMATION: 'Let me reflect on what I\'ve heard from both of you...',
    };

    return fallbacks[type];
  }
}
