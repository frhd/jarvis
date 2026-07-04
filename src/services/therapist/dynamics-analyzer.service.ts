/**
 * Conversation Dynamics Analyzer Service
 *
 * Analyzes conversation dynamics between dyad participants including
 * tension, conflict detection, turn-taking balance, and topic coherence.
 */

import { logger } from '../../utils/logger.js';
import { nanoid } from 'nanoid';
import type { ConversationDynamics } from './types.js';
import type { Message } from '../../types/index.js';
import type { IConversationDynamicsAnalyzerService } from '../../interfaces/therapist.js';
export type { IConversationDynamicsAnalyzerService };

// ============================================================================
// Constants
// ============================================================================

/** Tension score threshold to flag conflict (0-100 scale) */
const CONFLICT_TENSION_THRESHOLD = 40;

/** Minimum word length for topic coherence analysis */
const MIN_WORD_LENGTH_FOR_TOPICS = 4;

/** Score contribution per tension keyword match */
const TENSION_KEYWORD_SCORE = 8;

/** Score contribution per conflict keyword match */
const CONFLICT_KEYWORD_SCORE = 12;

/** Score contribution per positive keyword match */
const POSITIVE_KEYWORD_SCORE = 1;

/** Maximum tension level */
const MAX_TENSION_LEVEL = 100;

/** Minimum ALL CAPS characters for escalation detection */
const ESCALATION_MIN_CAPS = 3;

/** Minimum consecutive exclamation marks for escalation detection */
const ESCALATION_MIN_EXCLAMATIONS = 2;

// ============================================================================
// Keyword Patterns
// ============================================================================

const TENSION_PATTERNS: RegExp[] = [
  /\b(frustrated|annoyed|irritated|tired of|sick of|fed up)\b/i,
  /\b(unfair|wrong|ridiculous|absurd|unacceptable)\b/i,
  /\b(stop|quit|enough|leave me alone)\b/i,
  /\b(whatever|fine|sure|okay then)\b/i,
  /😤|😒|🙄|😑/,
];

const CONFLICT_PATTERNS: Record<string, RegExp[]> = {
  accusation: [
    /\b(you always|you never|you don't|you won't|you can't)\b/i,
    /\b(your fault|blame you|because of you)\b/i,
  ],
  disagreement: [
    /\b(disagree|wrong|incorrect|that's not|no way|absolutely not)\b/i,
    /\b(I don't think so|that's false|not true)\b/i,
  ],
  escalation: [
    /\b(yelling|screaming|shouting|shut up|go away)\b/i,
    /\b(hate|can't stand|despise|loathe)\b/i,
    new RegExp(`[A-Z]{${ESCALATION_MIN_CAPS},}`), // ALL CAPS words
    new RegExp(`!{${ESCALATION_MIN_EXCLAMATIONS},}`), // Multiple exclamation marks
  ],
};

const POSITIVE_PATTERNS: RegExp[] = [
  /\b(thank|thanks|appreciate|grateful|love|proud)\b/i,
  /\b(agree|exactly|right|great point|well said|good idea)\b/i,
  /\b(happy|wonderful|amazing|beautiful|celebrate)\b/i,
  /\b(support|help|together|we can|let's)\b/i,
  /❤️|💕|😊|😄|🥰|🎉|👏|💪|🤝/,
];

const SUPPORT_PATTERN_LABELS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\b(I understand|I hear you|I see what you mean|I get it)\b/i, label: 'empathy' },
  { pattern: /\b(I'm here|I'm listening|tell me more|go on)\b/i, label: 'active_listening' },
  { pattern: /\b(it's okay|it'll be|it will be|don't worry|no worries)\b/i, label: 'reassurance' },
  { pattern: /\b(we can|let's try|how about|what if we)\b/i, label: 'collaboration' },
  { pattern: /\b(I'm sorry|sorry about|my bad|I apologize)\b/i, label: 'accountability' },
];

// ============================================================================
// Service
// ============================================================================

export class ConversationDynamicsAnalyzerService implements IConversationDynamicsAnalyzerService {
  constructor(
    private dynamicsRepo: {
      findByConversationId(conversationId: string): Promise<{
        tensionLevel: number;
        conflictDetected: number | boolean;
        conflictType: string | null;
        positiveMomentsCount: number;
        turnTakingBalance: number;
        topicCoherence: number;
        supportPatterns: string;
        lastAnalyzedAt: Date | number;
      } | null>;
      upsert(data: {
        id: string;
        conversationId: string;
        tensionLevel: number;
        conflictDetected: boolean;
        conflictType: string | null;
        positiveMomentsCount: number;
        turnTakingBalance: number;
        topicCoherence: number;
        supportPatterns: string;
        lastAnalyzedAt: Date;
      }): Promise<void>;
    }
  ) {}

  /**
   * Analyze conversation dynamics from messages and persist results.
   */
  async analyzeDynamics(
    conversationId: string,
    messages: Message[]
  ): Promise<ConversationDynamics> {
    if (messages.length === 0) {
      return this.createNeutralDynamics(conversationId);
    }

    const turnTakingBalance = this.computeTurnTakingBalance(messages);
    const tensionLevel = this.computeTensionLevel(messages);
    const { conflictDetected, conflictType } = this.detectConflict(messages, tensionLevel);
    const positiveMomentsCount = this.countPositiveMoments(messages);
    const topicCoherence = this.computeTopicCoherence(messages);
    const supportPatterns = this.detectSupportPatterns(messages);

    const dynamics: ConversationDynamics = {
      conversationId,
      tensionLevel,
      conflictDetected,
      conflictType,
      positiveMomentsCount,
      turnTakingBalance,
      topicCoherence,
      supportPatterns,
      lastAnalyzedAt: new Date(),
    };

    // Persist to database
    await this.dynamicsRepo.upsert({
      id: nanoid(),
      conversationId,
      tensionLevel,
      conflictDetected,
      conflictType: conflictType ?? null,
      positiveMomentsCount,
      turnTakingBalance,
      topicCoherence,
      supportPatterns: JSON.stringify(supportPatterns),
      lastAnalyzedAt: new Date(),
    });

    logger.debug('[DynamicsAnalyzer] Analyzed conversation dynamics', {
      conversationId,
      tensionLevel,
      conflictDetected,
      turnTakingBalance: turnTakingBalance.toFixed(2),
      positiveMomentsCount,
    });

    return dynamics;
  }

  /**
   * Compute turn-taking balance (0-1, 0.5 = perfectly balanced).
   */
  private computeTurnTakingBalance(messages: Message[]): number {
    const senderCounts = new Map<string, number>();

    for (const msg of messages) {
      if (msg.isBot || !msg.senderId) continue;
      const count = senderCounts.get(msg.senderId) || 0;
      senderCounts.set(msg.senderId, count + 1);
    }

    const counts = Array.from(senderCounts.values());
    if (counts.length < 2) return 0.5;

    const total = counts.reduce((a, b) => a + b, 0);
    if (total === 0) return 0.5;

    // Balance = min(count) / max(count), normalized to 0-1
    const minCount = Math.min(...counts);
    const maxCount = Math.max(...counts);
    if (maxCount === 0) return 0.5;

    return minCount / maxCount;
  }

  /**
   * Compute tension level (0-100) based on keyword patterns.
   */
  private computeTensionLevel(messages: Message[]): number {
    let tensionScore = 0;

    for (const msg of messages) {
      const text = msg.text || '';
      if (!text.trim() || msg.isBot) continue;

      for (const pattern of TENSION_PATTERNS) {
        if (pattern.test(text)) {
          tensionScore += TENSION_KEYWORD_SCORE;
        }
      }

      // Check conflict patterns also add to tension
      for (const patterns of Object.values(CONFLICT_PATTERNS)) {
        for (const pattern of patterns) {
          if (pattern.test(text)) {
            tensionScore += CONFLICT_KEYWORD_SCORE;
          }
        }
      }
    }

    return Math.min(MAX_TENSION_LEVEL, tensionScore);
  }

  /**
   * Detect conflict presence and classify type.
   */
  private detectConflict(
    messages: Message[],
    tensionLevel: number
  ): { conflictDetected: boolean; conflictType?: string } {
    if (tensionLevel < CONFLICT_TENSION_THRESHOLD) {
      return { conflictDetected: false };
    }

    // Find dominant conflict type
    const typeCounts: Record<string, number> = {};

    for (const msg of messages) {
      const text = msg.text || '';
      if (!text.trim() || msg.isBot) continue;

      for (const [type, patterns] of Object.entries(CONFLICT_PATTERNS)) {
        for (const pattern of patterns) {
          if (pattern.test(text)) {
            typeCounts[type] = (typeCounts[type] || 0) + 1;
          }
        }
      }
    }

    const dominantType = Object.entries(typeCounts)
      .sort((a, b) => b[1] - a[1])[0];

    return {
      conflictDetected: true,
      conflictType: dominantType?.[0],
    };
  }

  /**
   * Count positive moments in messages.
   */
  private countPositiveMoments(messages: Message[]): number {
    let count = 0;

    for (const msg of messages) {
      const text = msg.text || '';
      if (!text.trim() || msg.isBot) continue;

      for (const pattern of POSITIVE_PATTERNS) {
        const matches = text.match(pattern);
        if (matches) {
          count += POSITIVE_KEYWORD_SCORE;
        }
      }
    }

    return count;
  }

  /**
   * Compute topic coherence (0-1) based on keyword overlap between consecutive messages.
   */
  private computeTopicCoherence(messages: Message[]): number {
    const nonBotMessages = messages.filter(m => !m.isBot && m.text?.trim());
    if (nonBotMessages.length < 2) return 0.5;

    let totalOverlap = 0;
    let comparisons = 0;

    for (let i = 1; i < nonBotMessages.length; i++) {
      const prevWords = this.extractTopicWords(nonBotMessages[i - 1].text || '');
      const currWords = this.extractTopicWords(nonBotMessages[i].text || '');

      if (prevWords.size === 0 || currWords.size === 0) continue;

      // Jaccard similarity
      const intersection = new Set([...prevWords].filter(w => currWords.has(w)));
      const union = new Set([...prevWords, ...currWords]);
      totalOverlap += intersection.size / union.size;
      comparisons++;
    }

    if (comparisons === 0) return 0.5;
    return totalOverlap / comparisons;
  }

  /**
   * Extract significant topic words from text.
   */
  private extractTopicWords(text: string): Set<string> {
    return new Set(
      text
        .toLowerCase()
        .split(/\s+/)
        .filter(w => w.length >= MIN_WORD_LENGTH_FOR_TOPICS)
        .map(w => w.replace(/[^a-z]/g, ''))
        .filter(w => w.length >= MIN_WORD_LENGTH_FOR_TOPICS)
    );
  }

  /**
   * Detect support patterns in messages.
   */
  private detectSupportPatterns(messages: Message[]): string[] {
    const found = new Set<string>();

    for (const msg of messages) {
      const text = msg.text || '';
      if (!text.trim() || msg.isBot) continue;

      for (const { pattern, label } of SUPPORT_PATTERN_LABELS) {
        if (pattern.test(text)) {
          found.add(label);
        }
      }
    }

    return Array.from(found);
  }

  /**
   * Create neutral dynamics for empty conversations.
   */
  private createNeutralDynamics(conversationId: string): ConversationDynamics {
    return {
      conversationId,
      tensionLevel: 0,
      conflictDetected: false,
      positiveMomentsCount: 0,
      turnTakingBalance: 0.5,
      topicCoherence: 0.5,
      supportPatterns: [],
      lastAnalyzedAt: new Date(),
    };
  }
}
