/**
 * Frustration Detector Service
 *
 * Analyzes conversation history to detect user frustration based on multiple signals:
 * - Message repetition (user repeating the same request)
 * - Message length decline (shorter messages over time)
 * - Caps usage (excessive capitalization)
 * - Punctuation density (excessive !!! or ???)
 * - Time compression (rapid-fire messages)
 *
 * Frustration levels range from 0-10, with 5+ indicating action is needed.
 */

import { logger } from '../utils/logger';
import type { Message } from '../types';

/**
 * Frustration indicators with granular metrics
 */
export interface FrustrationIndicators {
  repeatedMessages: number;        // Count of repeated/similar messages
  shorterMessages: boolean;         // Are messages getting shorter?
  capsUsage: number;                // Ratio of caps to total characters (0-1)
  punctuationDensity: number;       // Ratio of !/? to total characters (0-1)
  timeCompression: boolean;         // Multiple messages in short time window
}

/**
 * Complete frustration analysis result
 */
export interface FrustrationMetrics {
  level: number;                    // Frustration level 0-10
  indicators: FrustrationIndicators;
  threshold: number;                // Action threshold (default: 5)
  needsAction: boolean;             // Whether frustration exceeds threshold
  reasoning: string[];              // Human-readable explanation of score
}

/**
 * Configuration for frustration detection
 */
export interface FrustrationDetectorConfig {
  timeCompressionWindowMs: number;  // Time window for compression detection (default: 60s)
  messageCompressionThreshold: number; // Min messages in window (default: 3)
  repetitionSimilarityThreshold: number; // Similarity threshold 0-1 (default: 0.7)
  messageLengthDeclineThreshold: number; // % decline to trigger (default: 0.4)
  capsUsageThreshold: number;       // Caps ratio to score (default: 0.3)
  punctuationDensityThreshold: number; // Punctuation ratio to score (default: 0.15)
  actionThreshold: number;          // Score at which action needed (default: 5)
  analysisWindowSize: number;       // Number of recent messages to analyze (default: 10)
}

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: FrustrationDetectorConfig = {
  timeCompressionWindowMs: 60 * 1000, // 1 minute
  messageCompressionThreshold: 3,
  repetitionSimilarityThreshold: 0.7,
  messageLengthDeclineThreshold: 0.4, // 40% decline
  capsUsageThreshold: 0.3,
  punctuationDensityThreshold: 0.15,
  actionThreshold: 5,
  analysisWindowSize: 10,
};

/**
 * FrustrationDetectorService
 *
 * Provides comprehensive frustration detection and analysis capabilities
 * to identify when users are becoming frustrated with the assistant.
 */
export class FrustrationDetectorService {
  private config: FrustrationDetectorConfig;

  constructor(config: Partial<FrustrationDetectorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    logger.info('[FrustrationDetector] Service initialized', { config: this.config });
  }

  /**
   * Analyze conversation history for frustration signals
   *
   * @param messages - Recent conversation messages (most recent first, as typical in chat applications)
   * @param senderId - Optional sender ID to filter messages (if not provided, analyzes all user messages)
   * @returns Complete frustration metrics
   */
  async analyze(messages: Message[], senderId?: string): Promise<FrustrationMetrics> {
    logger.debug('[FrustrationDetector] Analyzing messages', {
      totalMessages: messages.length,
      senderId,
    });

    // Filter to only user messages (not bot) and limit to analysis window
    let userMessages = messages.filter(m => {
      const isUserMessage = !this.isBotMessage(m);
      const matchesSender = !senderId || m.senderId === senderId;
      return isUserMessage && matchesSender;
    });

    // Take most recent messages within analysis window
    userMessages = userMessages.slice(0, this.config.analysisWindowSize);

    // Not enough data for analysis
    if (userMessages.length < 2) {
      return this.createNoDataResult();
    }

    // Reverse to chronological order for analysis
    userMessages.reverse();

    const reasoning: string[] = [];
    let level = 0;

    // 1. Detect message repetition
    const repeatedMessages = this.detectRepetition(userMessages);
    if (repeatedMessages > 0) {
      level += repeatedMessages * 2; // Big signal: +2 per repetition
      reasoning.push(`${repeatedMessages} repeated/similar message(s) detected`);
    }

    // 2. Detect message length decline
    const shorterMessages = this.detectLengthDecline(userMessages);
    if (shorterMessages) {
      level += 2;
      reasoning.push('Message length declining (user getting terse)');
    }

    // 3. Calculate caps usage ratio
    const capsUsage = this.calculateCapsRatio(userMessages);
    if (capsUsage > this.config.capsUsageThreshold) {
      level += 2;
      reasoning.push(`High caps usage: ${(capsUsage * 100).toFixed(1)}%`);
    }

    // 4. Calculate punctuation density
    const punctuationDensity = this.calculatePunctuationDensity(userMessages);
    if (punctuationDensity > this.config.punctuationDensityThreshold) {
      level += 1;
      reasoning.push(`High punctuation density: ${(punctuationDensity * 100).toFixed(1)}%`);
    }

    // 5. Detect time compression (rapid messages)
    const timeCompression = this.detectTimeCompression(userMessages);
    if (timeCompression) {
      level += 2;
      reasoning.push('Rapid-fire messages (time compression detected)');
    }

    // Cap level at 10
    level = Math.min(10, level);

    const indicators: FrustrationIndicators = {
      repeatedMessages,
      shorterMessages,
      capsUsage,
      punctuationDensity,
      timeCompression,
    };

    const needsAction = level >= this.config.actionThreshold;

    if (reasoning.length === 0) {
      reasoning.push('No frustration indicators detected');
    }

    logger.info('[FrustrationDetector] Analysis complete', {
      level,
      needsAction,
      indicators,
    });

    return {
      level,
      indicators,
      threshold: this.config.actionThreshold,
      needsAction,
      reasoning,
    };
  }

  /**
   * Detect repeated or very similar messages
   */
  private detectRepetition(messages: Message[]): number {
    if (messages.length < 2) return 0;

    let repetitionCount = 0;
    const seenMessages: string[] = [];

    for (const message of messages) {
      const text = this.normalizeText(message.text);
      if (!text) continue;

      // Check for exact or very similar matches
      for (const seenText of seenMessages) {
        const similarity = this.calculateSimilarity(text, seenText);
        if (similarity >= this.config.repetitionSimilarityThreshold) {
          repetitionCount++;
          break; // Count each message only once
        }
      }

      seenMessages.push(text);
    }

    return repetitionCount;
  }

  /**
   * Detect if message lengths are declining (user getting terse)
   * Messages should be in chronological order (oldest first)
   */
  private detectLengthDecline(messages: Message[]): boolean {
    if (messages.length < 3) return false;

    const lengths = messages
      .map(m => m.text?.length || 0)
      .filter(l => l > 0);

    if (lengths.length < 3) return false;

    // Calculate trend: compare first half average to second half average
    const midpoint = Math.floor(lengths.length / 2);
    const firstHalf = lengths.slice(0, midpoint);
    const secondHalf = lengths.slice(midpoint);

    const firstAvg = firstHalf.reduce((sum, l) => sum + l, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((sum, l) => sum + l, 0) / secondHalf.length;

    // Check if second half is significantly shorter than first half
    // Avoid division by zero
    if (firstAvg === 0) return false;

    const decline = (firstAvg - secondAvg) / firstAvg;
    return decline >= this.config.messageLengthDeclineThreshold;
  }

  /**
   * Calculate ratio of uppercase characters
   */
  private calculateCapsRatio(messages: Message[]): number {
    let totalChars = 0;
    let capsChars = 0;

    for (const message of messages) {
      if (!message.text) continue;

      for (const char of message.text) {
        if (/[a-zA-Z]/.test(char)) {
          totalChars++;
          if (char === char.toUpperCase()) {
            capsChars++;
          }
        }
      }
    }

    return totalChars > 0 ? capsChars / totalChars : 0;
  }

  /**
   * Calculate density of exclamation marks and question marks
   */
  private calculatePunctuationDensity(messages: Message[]): number {
    let totalChars = 0;
    let punctuationChars = 0;

    for (const message of messages) {
      if (!message.text) continue;

      totalChars += message.text.length;
      const matches = message.text.match(/[!?]/g);
      punctuationChars += matches ? matches.length : 0;
    }

    return totalChars > 0 ? punctuationChars / totalChars : 0;
  }

  /**
   * Detect if messages are coming in rapid succession (time compression)
   */
  private detectTimeCompression(messages: Message[]): boolean {
    if (messages.length < this.config.messageCompressionThreshold) return false;

    // Check most recent N messages
    const recentMessages = messages.slice(-this.config.messageCompressionThreshold);

    if (recentMessages.length < this.config.messageCompressionThreshold) return false;

    // Calculate time span of these messages
    const timestamps = recentMessages.map(m => new Date(m.createdAt).getTime());
    const timeSpan = Math.max(...timestamps) - Math.min(...timestamps);

    return timeSpan < this.config.timeCompressionWindowMs;
  }

  /**
   * Normalize text for comparison (lowercase, trim, remove extra spaces)
   */
  private normalizeText(text: string | null | undefined): string {
    if (!text) return '';
    return text
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/[.,!?]+/g, ''); // Remove punctuation for comparison
  }

  /**
   * Calculate similarity between two texts using Jaccard similarity
   * Returns value between 0 (no similarity) and 1 (identical)
   */
  private calculateSimilarity(text1: string, text2: string): number {
    const words1 = new Set(text1.split(' '));
    const words2 = new Set(text2.split(' '));

    const intersection = new Set([...words1].filter(x => words2.has(x)));
    const union = new Set([...words1, ...words2]);

    return union.size > 0 ? intersection.size / union.size : 0;
  }

  /**
   * Check if a message is from the bot
   * Uses heuristics since we don't have a direct isBot flag in Message type
   */
  private isBotMessage(message: Message): boolean {
    // If senderId is null or matches bot's sender ID, it's a bot message
    // This is a simplification - in production you'd check against actual bot ID
    return message.senderId === null;
  }

  /**
   * Create result when insufficient data for analysis
   */
  private createNoDataResult(): FrustrationMetrics {
    return {
      level: 0,
      indicators: {
        repeatedMessages: 0,
        shorterMessages: false,
        capsUsage: 0,
        punctuationDensity: 0,
        timeCompression: false,
      },
      threshold: this.config.actionThreshold,
      needsAction: false,
      reasoning: ['Insufficient data for frustration analysis'],
    };
  }

  /**
   * Get current configuration
   */
  getConfig(): FrustrationDetectorConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<FrustrationDetectorConfig>): void {
    this.config = { ...this.config, ...updates };
    logger.info('[FrustrationDetector] Configuration updated', { config: this.config });
  }

  /**
   * Quick check: is user showing frustration?
   */
  async isFrustrated(messages: Message[], senderId?: string): Promise<boolean> {
    const metrics = await this.analyze(messages, senderId);
    return metrics.needsAction;
  }

  /**
   * Get frustration level only (0-10)
   */
  async getFrustrationLevel(messages: Message[], senderId?: string): Promise<number> {
    const metrics = await this.analyze(messages, senderId);
    return metrics.level;
  }
}
