/**
 * Dyad Context Service
 *
 * Builds comprehensive context for both participants in a dyad conversation.
 */

import type { DyadParticipant, ParticipantEmotionalState, ConversationDynamics } from './types.js';
import type { Message } from '../../types/index.js';
import type { IDyadContextService, DyadContextResult } from '../../interfaces/therapist.js';

export type { IDyadContextService };

/** Maximum messages to include in dyad context */
const MAX_CONTEXT_MESSAGES = 15;

/** Maximum memories per participant */
const MAX_MEMORIES_PER_PARTICIPANT = 5;

/** Divisor to split context messages between participants */
const CONTEXT_MESSAGES_PER_PARTICIPANT_DIVISOR = 2;

/** Minimum word length for topic extraction */
const MIN_TOPIC_WORD_LENGTH = 4;

/** Number of top words to include in topic summary */
const TOP_WORDS_COUNT = 3;

/** Threshold for positive tone detection based on positive moments */
const POSITIVE_TONE_THRESHOLD = 2;

export class DyadContextService implements IDyadContextService {
  constructor(
    private memoryRepo: {
      findActiveForUser(userId: string, limit: number): Promise<Array<{
        content: string;
        memoryType: string;
        createdAt: Date;
      }>>;
    },
    private emotionalAnalyzer: {
      analyzeDyadEmotions(conversationId: string, messages: Message[]): Promise<ParticipantEmotionalState[]>;
    },
    private dynamicsAnalyzer: {
      analyzeDynamics(conversationId: string, messages: Message[]): Promise<ConversationDynamics>;
    }
  ) {}

  /**
   * Build comprehensive context for a dyad
   */
  async buildDyadContext(
    conversationId: string,
    participants: DyadParticipant[],
    recentMessages: Message[],
    options: {
      includeMemories?: boolean;
      includeDynamics?: boolean;
    } = {}
  ): Promise<DyadContextResult> {
    const { includeMemories = true, includeDynamics = true } = options;

    // 1. Get emotional states for all participants
    const emotionalStates = await this.emotionalAnalyzer.analyzeDyadEmotions(
      conversationId,
      recentMessages
    );

    // 2. Get conversation dynamics
    let dynamics: ConversationDynamics | null = null;
    if (includeDynamics) {
      dynamics = await this.dynamicsAnalyzer.analyzeDynamics(conversationId, recentMessages);
    }

    // 3. Build participant-specific contexts
    const participantContexts = await Promise.all(
      participants.map(async (participant) => {
        // Get participant's recent messages
        const participantMessages = recentMessages
          .filter(m => m.senderId === participant.userId)
          .slice(-Math.floor(MAX_CONTEXT_MESSAGES / CONTEXT_MESSAGES_PER_PARTICIPANT_DIVISOR));

        // Get relevant memories
        let relevantMemories: string[] = [];
        if (includeMemories) {
          const memories = await this.memoryRepo.findActiveForUser(
            participant.userId,
            MAX_MEMORIES_PER_PARTICIPANT
          );
          relevantMemories = memories.map(m => `[${m.memoryType}] ${m.content}`);
        }

        // Find emotional state
        const emotionalState = emotionalStates.find(
          s => s.userId === participant.userId
        );

        return {
          ...participant,
          emotionalState,
          recentMessages: participantMessages,
          relevantMemories,
        };
      })
    );

    // 4. Build combined conversation context
    const conversationContext = this.buildConversationContext(
      recentMessages,
      participantContexts
    );

    // 5. Generate topic summary
    const topicSummary = this.generateTopicSummary(recentMessages, dynamics);

    return {
      participants: participantContexts,
      conversationContext,
      dynamics,
      topicSummary,
    };
  }

  /**
   * Build combined conversation context string
   */
  private buildConversationContext(
    messages: Message[],
    participants: Array<{ displayName?: string | null; userId: string }>
  ): string {
    const nameMap = new Map<string, string>();
    for (const p of participants) {
      nameMap.set(p.userId, p.displayName || 'Participant');
    }

    const formattedMessages = messages
      .slice(-MAX_CONTEXT_MESSAGES)
      .map(m => {
        const name = m.isBot
          ? 'Jarvis'
          : nameMap.get(m.senderId || '') || 'User';
        return `${name}: ${m.text || '[non-text]'}`;
      })
      .join('\n');

    return formattedMessages;
  }

  /**
   * Generate a brief topic summary
   */
  private generateTopicSummary(
    messages: Message[],
    dynamics: ConversationDynamics | null
  ): string {
    // Extract potential topics from recent messages
    const allText = messages
      .map(m => m.text || '')
      .join(' ')
      .toLowerCase();

    // Simple topic extraction based on keyword frequency
    const words = allText.split(/\s+/).filter(w => w.length > MIN_TOPIC_WORD_LENGTH);
    const wordCounts = new Map<string, number>();

    for (const word of words) {
      const count = wordCounts.get(word) || 0;
      wordCounts.set(word, count + 1);
    }

    const topWords = Array.from(wordCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_WORDS_COUNT)
      .map(([word]) => word);

    let summary = topWords.length > 0
      ? `Discussing: ${topWords.join(', ')}`
      : 'General conversation';

    if (dynamics) {
      if (dynamics.conflictDetected) {
        summary += ' (with some tension)';
      } else if (dynamics.positiveMomentsCount > POSITIVE_TONE_THRESHOLD) {
        summary += ' (positive tone)';
      }
    }

    return summary;
  }
}
