/**
 * Imperative Detection Service
 * Detects imperative commands and frustration signals in user messages
 *
 * Based on IMPL.md specification for anti-loop intelligence system.
 * Identifies patterns like "yes do it", "just do it", "proceed" and tracks
 * repeated imperatives as frustration signals.
 */

import { logger } from '../utils/logger';

/**
 * Pattern categories for imperative detection
 */
const IMPERATIVE_PATTERNS = {
  highConfidence: [
    /^yes,?\s+do\s+it$/i,
    /^just\s+do\s+it$/i,
    /^execute$/i,
    /^go\s+ahead$/i,
    /^proceed$/i,
    /^run\s+it$/i,
    /^do\s+it$/i,
    /^make\s+it\s+happen$/i,
    /^get\s+it\s+done$/i,
  ],
  mediumConfidence: [
    /^yes$/i,
    /^okay$/i,
    /^ok$/i,
    /^sure$/i,
    /^do\s+that$/i,
    /^go$/i,
    /^go\s+for\s+it$/i,
    /^yep$/i,
    /^yeah$/i,
    /^affirmative$/i,
    /^confirmed?$/i,
    /^approve[d]?$/i,
  ],
  lowConfidence: [
    /^y$/i,
    /^k$/i,
    /^fine$/i,
    /^good$/i,
    /^alright$/i,
    /^continue$/i,
  ],
};

/**
 * Frustration indicators in messages
 */
const FRUSTRATION_PATTERNS = {
  // Capitalization patterns (all caps)
  allCaps: /^[A-Z\s!?.]+$/,
  // Excessive punctuation
  excessivePunctuation: /[!?]{2,}/,
  // Direct frustration expressions
  directFrustration: [
    /just\s+do\s+it/i,
    /i\s+said/i,
    /i\s+told\s+you/i,
    /why\s+are\s+you\s+asking/i,
    /stop\s+asking/i,
    /enough/i,
    /come\s+on/i,
    /seriously/i,
  ],
};

/**
 * Confidence level for imperative detection
 */
export type ImperativeConfidence = 'high' | 'medium' | 'low' | 'none';

/**
 * Frustration indicators detected in the message
 */
export interface FrustrationIndicators {
  repeatedMessages: number;
  shorterMessages: boolean;
  capsUsage: number;
  punctuationDensity: number;
  timeCompression: boolean;
  directFrustration: boolean;
}

/**
 * Frustration metrics calculated from conversation
 */
export interface FrustrationMetrics {
  level: number; // 0-10
  indicators: FrustrationIndicators;
  threshold: number;
  isAboveThreshold: boolean;
}

/**
 * Result of imperative detection
 */
export interface ImperativeDetectionResult {
  isImperative: boolean;
  confidence: ImperativeConfidence;
  shouldExecute: boolean;
  reasoning: string;
  matchedPattern?: string;
  frustrationLevel: number;
}

/**
 * Conversation state for context-aware detection
 */
export interface ConversationState {
  userId: string;
  recentMessages: Array<{
    content: string;
    timestamp: Date;
    isFromUser: boolean;
  }>;
  pendingAction?: {
    description: string;
    confidence: number;
  };
}

/**
 * Configuration for imperative detection
 */
export interface ImperativeDetectionConfig {
  enabled: boolean;
  frustrationThreshold: number;
  recentMessageWindow: number; // Number of recent messages to analyze
  timeCompressionWindowMs: number; // Time window for detecting rapid messages
}

const DEFAULT_CONFIG: ImperativeDetectionConfig = {
  enabled: true,
  frustrationThreshold: 5,
  recentMessageWindow: 5,
  timeCompressionWindowMs: 60000, // 1 minute
};

/**
 * Service for detecting imperative commands and frustration signals
 */
export class ImperativeDetectionService {
  private config: ImperativeDetectionConfig;

  constructor(config?: Partial<ImperativeDetectionConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    logger.info('[ImperativeDetectionService] Service initialized', { config: this.config });
  }

  /**
   * Detect imperative patterns in a message with conversation context
   *
   * @param message - The message to analyze
   * @param conversationState - Current conversation state for context
   * @returns Detection result with confidence and execution recommendation
   */
  detect(message: string, conversationState?: ConversationState): ImperativeDetectionResult {
    if (!this.config.enabled) {
      return this.createNegativeResult('Imperative detection disabled');
    }

    const trimmed = message.trim();

    // Calculate frustration metrics if conversation state is available
    const frustrationMetrics = conversationState
      ? this.analyzeFrustration(conversationState)
      : this.createEmptyFrustrationMetrics();

    // Check for repeated imperatives (strongest signal)
    if (conversationState) {
      const imperativeCount = this.countRecentImperatives(conversationState);

      if (imperativeCount >= 2) {
        logger.warn('[ImperativeDetectionService] Repeated imperative detected', {
          count: imperativeCount,
          frustrationLevel: frustrationMetrics.level,
        });

        return {
          isImperative: true,
          confidence: 'high',
          shouldExecute: true,
          reasoning: 'User repeated imperative - clear frustration signal',
          frustrationLevel: Math.max(frustrationMetrics.level, 8), // Boost frustration level
        };
      }
    }

    // Check if there's a pending action with confirmation
    if (conversationState?.pendingAction) {
      const mediumMatch = this.matchPattern(trimmed, IMPERATIVE_PATTERNS.mediumConfidence);
      const highMatch = this.matchPattern(trimmed, IMPERATIVE_PATTERNS.highConfidence);

      if (mediumMatch || highMatch) {
        logger.info('[ImperativeDetectionService] Imperative confirmed pending action', {
          pattern: mediumMatch || highMatch,
          pendingAction: conversationState.pendingAction.description,
        });

        return {
          isImperative: true,
          confidence: highMatch ? 'high' : 'medium',
          shouldExecute: true,
          reasoning: 'Clear confirmation for pending action',
          matchedPattern: mediumMatch || highMatch,
          frustrationLevel: frustrationMetrics.level,
        };
      }
    }

    // Pattern-based detection (without pending action)
    const highMatch = this.matchPattern(trimmed, IMPERATIVE_PATTERNS.highConfidence);
    if (highMatch) {
      return {
        isImperative: true,
        confidence: 'high',
        shouldExecute: frustrationMetrics.isAboveThreshold,
        reasoning: 'High confidence imperative pattern detected',
        matchedPattern: highMatch,
        frustrationLevel: frustrationMetrics.level,
      };
    }

    const mediumMatch = this.matchPattern(trimmed, IMPERATIVE_PATTERNS.mediumConfidence);
    if (mediumMatch) {
      return {
        isImperative: true,
        confidence: 'medium',
        shouldExecute: frustrationMetrics.isAboveThreshold && Boolean(conversationState?.pendingAction),
        reasoning: 'Medium confidence imperative - execution depends on context and frustration',
        matchedPattern: mediumMatch,
        frustrationLevel: frustrationMetrics.level,
      };
    }

    const lowMatch = this.matchPattern(trimmed, IMPERATIVE_PATTERNS.lowConfidence);
    if (lowMatch) {
      return {
        isImperative: true,
        confidence: 'low',
        shouldExecute: false,
        reasoning: 'Low confidence imperative - needs more context',
        matchedPattern: lowMatch,
        frustrationLevel: frustrationMetrics.level,
      };
    }

    return this.createNegativeResult('No imperative pattern detected', frustrationMetrics.level);
  }

  /**
   * Analyze frustration level from conversation state
   *
   * @param conversationState - Current conversation state
   * @returns Frustration metrics
   */
  analyzeFrustration(conversationState: ConversationState): FrustrationMetrics {
    const userMessages = conversationState.recentMessages
      .filter((m) => m.isFromUser)
      .slice(-this.config.recentMessageWindow);

    if (userMessages.length === 0) {
      return this.createEmptyFrustrationMetrics();
    }

    // Track repetition
    const repeatedMessages = this.detectRepetition(userMessages);

    // Detect message length decline
    const messageLengths = userMessages.map((m) => m.content.length);
    const shorterMessages = this.isDecreasingTrend(messageLengths);

    // Calculate caps usage
    const capsUsage = this.calculateCapsRatio(userMessages);

    // Calculate punctuation density
    const punctuationDensity = this.calculatePunctuationDensity(userMessages);

    // Detect time compression (messages coming faster)
    const timeCompression = this.detectTimeCompression(userMessages);

    // Detect direct frustration expressions
    const directFrustration = this.detectDirectFrustration(userMessages);

    // Calculate frustration level (0-10)
    let level = 0;
    level += repeatedMessages * 2; // Big signal
    level += shorterMessages ? 2 : 0;
    level += capsUsage > 0.3 ? 2 : 0;
    level += punctuationDensity > 0.15 ? 1 : 0;
    level += timeCompression ? 2 : 0;
    level += directFrustration ? 3 : 0;

    const clampedLevel = Math.min(10, level);

    return {
      level: clampedLevel,
      indicators: {
        repeatedMessages,
        shorterMessages,
        capsUsage,
        punctuationDensity,
        timeCompression,
        directFrustration,
      },
      threshold: this.config.frustrationThreshold,
      isAboveThreshold: clampedLevel >= this.config.frustrationThreshold,
    };
  }

  /**
   * Count recent imperative messages
   */
  private countRecentImperatives(conversationState: ConversationState): number {
    const recentUserMessages = conversationState.recentMessages
      .filter((m) => m.isFromUser)
      .slice(-3); // Last 3 user messages

    return recentUserMessages.filter((m) => {
      const trimmed = m.content.trim();
      return (
        this.matchPattern(trimmed, IMPERATIVE_PATTERNS.highConfidence) ||
        this.matchPattern(trimmed, IMPERATIVE_PATTERNS.mediumConfidence)
      );
    }).length;
  }

  /**
   * Match message against pattern array
   */
  private matchPattern(message: string, patterns: RegExp[]): string | undefined {
    for (const pattern of patterns) {
      if (pattern.test(message)) {
        return pattern.source;
      }
    }
    return undefined;
  }

  /**
   * Detect message repetition
   */
  private detectRepetition(messages: Array<{ content: string }>): number {
    if (messages.length < 2) return 0;

    const contents = messages.map((m) => m.content.toLowerCase().trim());
    let repetitionCount = 0;

    for (let i = 1; i < contents.length; i++) {
      if (contents[i] === contents[i - 1]) {
        repetitionCount++;
      }
    }

    return repetitionCount;
  }

  /**
   * Detect decreasing message length trend
   */
  private isDecreasingTrend(lengths: number[]): boolean {
    if (lengths.length < 3) return false;

    const recentLengths = lengths.slice(-3);
    return (
      recentLengths[1] < recentLengths[0] &&
      recentLengths[2] < recentLengths[1]
    );
  }

  /**
   * Calculate caps usage ratio
   */
  private calculateCapsRatio(messages: Array<{ content: string }>): number {
    let totalChars = 0;
    let capsChars = 0;

    for (const message of messages) {
      const letters = message.content.replace(/[^a-zA-Z]/g, '');
      totalChars += letters.length;
      capsChars += (message.content.match(/[A-Z]/g) || []).length;
    }

    return totalChars > 0 ? capsChars / totalChars : 0;
  }

  /**
   * Calculate punctuation density
   */
  private calculatePunctuationDensity(messages: Array<{ content: string }>): number {
    let totalChars = 0;
    let punctuationChars = 0;

    for (const message of messages) {
      totalChars += message.content.length;
      punctuationChars += (message.content.match(/[!?]/g) || []).length;
    }

    return totalChars > 0 ? punctuationChars / totalChars : 0;
  }

  /**
   * Detect time compression (messages coming faster)
   */
  private detectTimeCompression(messages: Array<{ timestamp: Date }>): boolean {
    if (messages.length < 2) return false;

    // Check if last 2 messages came within the time compression window
    const lastTwo = messages.slice(-2);
    const timeDiff = lastTwo[1].timestamp.getTime() - lastTwo[0].timestamp.getTime();

    return timeDiff < this.config.timeCompressionWindowMs;
  }

  /**
   * Detect direct frustration expressions
   */
  private detectDirectFrustration(messages: Array<{ content: string }>): boolean {
    for (const message of messages) {
      for (const pattern of FRUSTRATION_PATTERNS.directFrustration) {
        if (pattern.test(message.content)) {
          return true;
        }
      }

      // Check for all caps or excessive punctuation
      if (
        message.content.length > 3 &&
        (FRUSTRATION_PATTERNS.allCaps.test(message.content) ||
          FRUSTRATION_PATTERNS.excessivePunctuation.test(message.content))
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * Create empty frustration metrics
   */
  private createEmptyFrustrationMetrics(): FrustrationMetrics {
    return {
      level: 0,
      indicators: {
        repeatedMessages: 0,
        shorterMessages: false,
        capsUsage: 0,
        punctuationDensity: 0,
        timeCompression: false,
        directFrustration: false,
      },
      threshold: this.config.frustrationThreshold,
      isAboveThreshold: false,
    };
  }

  /**
   * Create negative detection result
   */
  private createNegativeResult(reasoning: string, frustrationLevel = 0): ImperativeDetectionResult {
    return {
      isImperative: false,
      confidence: 'none',
      shouldExecute: false,
      reasoning,
      frustrationLevel,
    };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<ImperativeDetectionConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info('[ImperativeDetectionService] Configuration updated', { config: this.config });
  }

  /**
   * Get current configuration
   */
  getConfig(): ImperativeDetectionConfig {
    return { ...this.config };
  }
}
