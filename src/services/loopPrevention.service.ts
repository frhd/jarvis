import { createHash } from 'crypto';
import { LLMClient, ChatMessage, LLMResponse } from '../clients/llm.client.js';
import {
  LoopPatternRepository,
  LoopPattern,
  LoopDetection,
} from '../repositories/loopPattern.repository.js';
import { Message } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { appConfig } from '../config/index.js';

export interface LoopSignature {
  pattern: string[];
  frequency: number;
  avgDuration: number;
  resolutionStrategy: string;
}

export interface ConversationPattern {
  messageTexts: string[];
  messageRoles: string[]; // 'user' or 'bot'
  messageTimestamps: number[];
  messageLengths: number[];
  rawMessageTexts: string[]; // Original case, for caps analysis
}

export interface LoopDetectionResult {
  detected: boolean;
  loopType?: LoopPattern['loopType'];
  patternId?: string;
  confidence: number;
  suggestedBreakpoint?: string;
  metadata?: {
    repetitionCount?: number;
    timeCompression?: boolean;
    frustrationLevel?: number;
    patternMatch?: string;
  };
}

export interface FrustrationMetrics {
  level: number; // 0-10
  indicators: {
    repeatedMessages: number;
    shorterMessages: boolean;
    capsUsage: number;
    punctuationDensity: number;
    timeCompression: boolean;
  };
}

export type LoopType = LoopPattern['loopType'];

/**
 * Dedicated short timeout for the loop-detection LLM call.
 *
 * This call sits on the hot response path: every incoming message can trigger
 * it, so it must never inherit the LLM client's long default (60s) timeout.
 * When the model is slow we would rather skip the LLM check (fail open on the
 * heuristics) than block the user for a minute.
 */
export const LOOP_DETECTION_LLM_TIMEOUT_MS = 8_000;

/**
 * Number of consecutive LLM loop-detection failures/timeouts that trip the
 * internal circuit breaker.
 */
export const LOOP_DETECTION_FAILURE_THRESHOLD = 3;

/**
 * How long the loop-detection circuit breaker stays open (LLM check skipped)
 * before it probes the LLM again.
 */
export const LOOP_DETECTION_BREAKER_COOLDOWN_MS = 120_000;

/**
 * Minimum model-reported confidence required to treat an LLM-detected pattern
 * as a genuine loop.
 */
export const LLM_LOOP_CONFIDENCE_THRESHOLD = 0.6;

const DEFAULT_LOOP_PATTERNS: Array<{
  type: LoopType;
  keywords: string[];
  resolutionStrategy: string;
}> = [
  {
    type: 'imperative_repeat',
    keywords: ['yes do it', 'just do it', 'execute', 'go ahead', 'proceed', 'run it'],
    resolutionStrategy: 'execute_pending_action',
  },
  {
    type: 'clarification_loop',
    keywords: ['what do you mean', 'i dont understand', 'can you explain', 'clarify'],
    resolutionStrategy: 'provide_detailed_explanation',
  },
  {
    type: 'execution_hesitation',
    keywords: ['should i', 'do you want me to', 'would you like', 'shall i'],
    resolutionStrategy: 'execute_with_confidence',
  },
  {
    type: 'misunderstanding',
    keywords: ['no that is not', 'you misunderstood', 'i meant', 'actually'],
    resolutionStrategy: 'rewind_and_clarify',
  },
  {
    type: 'context_lost',
    keywords: ['we were talking about', 'going back to', 'as i mentioned', 'earlier'],
    resolutionStrategy: 'restore_context',
  },
];

export class LoopPreventionService {
  private llmClient: LLMClient;
  private repository: LoopPatternRepository;
  private patternCache: Map<string, LoopPattern> = new Map();
  private lastCacheUpdate: number = 0;
  private cacheTTL: number = 5 * 60 * 1000; // 5 minutes

  // Internal circuit breaker for the LLM loop-detection step. Protects the hot
  // response path from a slow/failing model: after repeated failures the LLM
  // check is skipped for a cooldown window (heuristic checks still run).
  private loopDetectionFailureCount = 0;
  private loopDetectionBreakerOpenUntil = 0;
  private llmRequestCounter = 0;

  constructor(llmClient: LLMClient, repository: LoopPatternRepository) {
    this.llmClient = llmClient;
    this.repository = repository;
    this.initializeDefaultPatterns();
  }

  /**
   * Initialize default loop patterns in the database
   */
  private async initializeDefaultPatterns(): Promise<void> {
    try {
      for (const defaultPattern of DEFAULT_LOOP_PATTERNS) {
        const pattern = JSON.stringify(defaultPattern.keywords);
        const hash = this.hashPattern(pattern);

        // Check if pattern already exists
        const existing = await this.repository.findPatternByHash(hash);
        if (!existing) {
          await this.repository.createPattern({
            patternHash: hash,
            pattern,
            loopType: defaultPattern.type,
            frequency: 0,
            avgDurationMs: 0,
            avgMessageCount: 3,
            resolutionStrategy: defaultPattern.resolutionStrategy,
            confidence: 0.8,
            metadata: JSON.stringify({ isDefault: true, keywords: defaultPattern.keywords }),
          });

          logger.info('[LoopPrevention] Initialized default pattern', {
            type: defaultPattern.type,
          });
        }
      }
    } catch (error) {
      logger.error('[LoopPrevention] Failed to initialize default patterns', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Detect if a conversation is in a loop
   */
  async detectLoop(
    recentMessages: Message[],
    chatId: string,
    senderId?: string
  ): Promise<LoopDetectionResult> {
    // Check feature flag — allow disabling loop detection entirely as an escape hatch
    const { appConfig } = await import('../config/index.js');
    if (appConfig.loopDetection && !appConfig.loopDetection.enabled) {
      return { detected: false, confidence: 0 };
    }

    const MIN_MESSAGES_FOR_LOOP_DETECTION = 6;
    if (recentMessages.length < MIN_MESSAGES_FOR_LOOP_DETECTION) {
      return { detected: false, confidence: 0 };
    }

    try {
      // Extract conversation pattern
      const conversationPattern = this.extractConversationPattern(recentMessages);

      // Check for frustration signals first (high priority)
      const frustration = this.detectFrustration(conversationPattern);
      if (frustration.level >= 5) {
        const imperativeLoop = await this.detectImperativeLoop(
          conversationPattern,
          frustration
        );
        if (imperativeLoop.detected) {
          // Record this detection
          await this.recordDetection(
            imperativeLoop,
            chatId,
            senderId,
            recentMessages,
            conversationPattern
          );
          return imperativeLoop;
        }
      }

      // Check for pattern matches (known loops)
      const patternMatch = await this.matchKnownPatterns(conversationPattern);
      if (patternMatch.detected) {
        await this.recordDetection(patternMatch, chatId, senderId, recentMessages, conversationPattern);
        return patternMatch;
      }

      // Detect new potential loops using LLM
      const newLoop = await this.detectNewLoop(conversationPattern);
      if (newLoop.detected) {
        await this.recordDetection(newLoop, chatId, senderId, recentMessages, conversationPattern);
        return newLoop;
      }

      return { detected: false, confidence: 0 };
    } catch (error) {
      logger.error('[LoopPrevention] Loop detection failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return { detected: false, confidence: 0 };
    }
  }

  /**
   * Extract conversation pattern from messages
   */
  private extractConversationPattern(messages: Message[]): ConversationPattern {
    return {
      messageTexts: messages.map((m) => (m.text || '').toLowerCase().trim()),
      messageRoles: messages.map((m) => (m.isBot ? 'bot' : 'user')),
      messageTimestamps: messages.map((m) => m.createdAt.getTime()),
      messageLengths: messages.map((m) => (m.text || '').length),
      rawMessageTexts: messages.map((m) => (m.text || '').trim()),
    };
  }

  /**
   * Detect frustration in conversation
   */
  private detectFrustration(pattern: ConversationPattern): FrustrationMetrics {
    // Filter to user-only messages for frustration signals
    const userTexts = pattern.messageTexts.filter((_, i) => pattern.messageRoles[i] === 'user');
    const userRawTexts = pattern.rawMessageTexts.filter((_, i) => pattern.messageRoles[i] === 'user');
    const userTimestamps = pattern.messageTimestamps.filter((_, i) => pattern.messageRoles[i] === 'user');
    const userLengths = pattern.messageLengths.filter((_, i) => pattern.messageRoles[i] === 'user');

    const indicators = {
      repeatedMessages: this.countRepetitions(userTexts),
      shorterMessages: this.detectDecreasingLength(userLengths),
      capsUsage: this.calculateCapsRatio(userRawTexts),
      punctuationDensity: this.calculatePunctuationDensity(userRawTexts),
      timeCompression: this.detectTimeCompression(userTimestamps),
    };

    // Calculate frustration level (0-10)
    let level = 0;
    level += indicators.repeatedMessages * 2; // Big signal
    level += indicators.shorterMessages ? 2 : 0;
    level += indicators.capsUsage > 0.3 ? 2 : 0;
    level += indicators.punctuationDensity > 0.15 ? 1 : 0;
    level += indicators.timeCompression ? 2 : 0;

    return {
      level: Math.min(10, level),
      indicators,
    };
  }

  /**
   * Count message repetitions
   */
  private countRepetitions(texts: string[]): number {
    const uniqueTexts = new Set(texts);
    return texts.length - uniqueTexts.size;
  }

  /**
   * Detect if message lengths are decreasing (frustration signal)
   */
  private detectDecreasingLength(lengths: number[]): boolean {
    if (lengths.length < 3) return false;

    const recent = lengths.slice(-3);
    return recent[2] < recent[1] && recent[1] < recent[0];
  }

  /**
   * Calculate caps usage ratio
   */
  private calculateCapsRatio(texts: string[]): number {
    const allText = texts.join('');
    if (allText.length === 0) return 0;

    const capsCount = (allText.match(/[A-Z]/g) || []).length;
    const letterCount = (allText.match(/[a-zA-Z]/g) || []).length;

    return letterCount > 0 ? capsCount / letterCount : 0;
  }

  /**
   * Calculate punctuation density
   */
  private calculatePunctuationDensity(texts: string[]): number {
    const allText = texts.join('');
    if (allText.length === 0) return 0;

    const punctCount = (allText.match(/[!?]+/g) || []).length;
    return punctCount / allText.length;
  }

  /**
   * Detect time compression (messages coming faster)
   */
  private detectTimeCompression(timestamps: number[]): boolean {
    if (timestamps.length < 3) return false;

    const intervals = [];
    for (let i = 1; i < timestamps.length; i++) {
      intervals.push(timestamps[i] - timestamps[i - 1]);
    }

    // Check if recent intervals are getting shorter
    const recent = intervals.slice(-2);
    const earlier = intervals.slice(0, -2);

    if (earlier.length === 0) return false;

    const avgRecent = recent.reduce((a, b) => a + b, 0) / recent.length;
    const avgEarlier = earlier.reduce((a, b) => a + b, 0) / earlier.length;

    return avgRecent < avgEarlier * 0.5; // 50% faster
  }

  /**
   * Detect imperative loop (user repeating commands)
   */
  private async detectImperativeLoop(
    pattern: ConversationPattern,
    frustration: FrustrationMetrics
  ): Promise<LoopDetectionResult> {
    const imperativePatterns = [
      /^yes,?\s+do\s+it$/i,
      /^just\s+do\s+it$/i,
      /^execute$/i,
      /^go\s+ahead$/i,
      /^proceed$/i,
      /^run\s+it$/i,
      /^yes$/i,
      /^okay$/i,
      /^sure$/i,
      /^do\s+that$/i,
    ];

    const userMessages = pattern.messageTexts.filter(
      (_, idx) => pattern.messageRoles[idx] === 'user'
    );

    const imperativeCount = userMessages.filter((text) =>
      imperativePatterns.some((p) => p.test(text))
    ).length;

    if (imperativeCount >= 2) {
      return {
        detected: true,
        loopType: 'imperative_repeat',
        confidence: 0.95,
        suggestedBreakpoint: 'execute_pending_action',
        metadata: {
          repetitionCount: imperativeCount,
          frustrationLevel: frustration.level,
          patternMatch: 'imperative_commands',
        },
      };
    }

    return { detected: false, confidence: 0 };
  }

  /**
   * Match against known loop patterns
   */
  private async matchKnownPatterns(
    pattern: ConversationPattern
  ): Promise<LoopDetectionResult> {
    await this.refreshPatternCache();

    for (const [hash, loopPattern] of this.patternCache) {
      const keywords = this.parsePatternKeywords(loopPattern.pattern);
      const matchCount = this.countKeywordMatches(pattern.messageTexts, keywords);

      const KEYWORD_MATCH_THRESHOLD = 0.75;
      if (matchCount >= keywords.length * KEYWORD_MATCH_THRESHOLD) {
        return {
          detected: true,
          loopType: loopPattern.loopType,
          patternId: loopPattern.id,
          confidence: 0.8 + matchCount / keywords.length * 0.2,
          suggestedBreakpoint: loopPattern.resolutionStrategy,
          metadata: {
            patternMatch: hash,
          },
        };
      }
    }

    return { detected: false, confidence: 0 };
  }

  /**
   * Detect new loops using LLM analysis
   */
  private async detectNewLoop(
    pattern: ConversationPattern
  ): Promise<LoopDetectionResult> {
    const NO_LOOP: LoopDetectionResult = { detected: false, confidence: 0 };

    // Circuit breaker: while open, skip the LLM step entirely (fail open).
    // The cheaper heuristic checks in detectLoop() have already run.
    if (this.isLoopDetectionBreakerOpen()) {
      return NO_LOOP;
    }

    const conversationText = pattern.messageTexts
      .map((text, idx) => `${pattern.messageRoles[idx]}: ${text}`)
      .join('\n');

    const prompt = `Analyze this conversation for repetitive patterns or loops:

${conversationText}

Is this conversation stuck in a loop? Consider:
- User repeating similar questions or requests
- Bot providing similar responses repeatedly
- Lack of progress toward a goal
- Frustration signals

Respond with JSON:
{
  "isLoop": boolean,
  "loopType": "imperative_repeat" | "clarification_loop" | "execution_hesitation" | "misunderstanding" | "context_lost" | "custom",
  "confidence": 0.0-1.0,
  "resolutionStrategy": "description of how to break the loop"
}`;

    const messages: ChatMessage[] = [
      { role: 'system', content: 'You are an expert at detecting conversation patterns.' },
      { role: 'user', content: prompt },
    ];

    let response: LLMResponse;
    try {
      response = await this.runLoopDetectionLLM(messages);
      this.recordLoopDetectionSuccess();
    } catch (error) {
      this.recordLoopDetectionFailure();
      logger.error('[LoopPrevention] LLM loop detection failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return NO_LOOP;
    }

    // Parse JSON response (a parse failure is fail-open but does not count
    // against the breaker — the model responded, it was just malformed).
    try {
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return NO_LOOP;
      }

      const parsed = JSON.parse(jsonMatch[0]);

      if (parsed.isLoop && parsed.confidence >= LLM_LOOP_CONFIDENCE_THRESHOLD) {
        return {
          detected: true,
          loopType: parsed.loopType || 'custom',
          confidence: parsed.confidence,
          suggestedBreakpoint: parsed.resolutionStrategy,
        };
      }

      return NO_LOOP;
    } catch (error) {
      logger.error('[LoopPrevention] LLM loop detection response parse failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return NO_LOOP;
    }
  }

  /**
   * Run the loop-detection LLM call with a short dedicated timeout.
   *
   * The LLM client only exposes a fixed per-instance timeout, so we enforce a
   * tighter one here: race the request against a timer that aborts the
   * underlying request (via cancelRequest) and rejects, keeping this off the
   * critical response path for at most LOOP_DETECTION_LLM_TIMEOUT_MS.
   */
  private async runLoopDetectionLLM(messages: ChatMessage[]): Promise<LLMResponse> {
    const requestId = `loop-detection-${++this.llmRequestCounter}`;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        this.llmClient.cancelRequest(requestId);
        reject(
          new Error(
            `Loop detection LLM request timed out after ${LOOP_DETECTION_LLM_TIMEOUT_MS}ms`
          )
        );
      }, LOOP_DETECTION_LLM_TIMEOUT_MS);
    });

    try {
      return await Promise.race([
        this.llmClient.chat(messages, requestId, {
          maxTokens: appConfig.llm.extractionMaxTokens,
        }),
        timeoutPromise,
      ]);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  /**
   * Whether the LLM loop-detection breaker is currently open. When the cooldown
   * has elapsed the breaker is closed and a fresh probe is allowed through.
   */
  private isLoopDetectionBreakerOpen(): boolean {
    if (this.loopDetectionBreakerOpenUntil === 0) {
      return false;
    }

    if (Date.now() >= this.loopDetectionBreakerOpenUntil) {
      // Cooldown elapsed — close the breaker and allow one probe.
      this.loopDetectionBreakerOpenUntil = 0;
      this.loopDetectionFailureCount = 0;
      return false;
    }

    return true;
  }

  /**
   * Record a successful LLM loop-detection call, resetting breaker state.
   */
  private recordLoopDetectionSuccess(): void {
    this.loopDetectionFailureCount = 0;
    this.loopDetectionBreakerOpenUntil = 0;
  }

  /**
   * Record a failed/timed-out LLM loop-detection call. Trips the breaker (once)
   * after LOOP_DETECTION_FAILURE_THRESHOLD consecutive failures.
   */
  private recordLoopDetectionFailure(): void {
    this.loopDetectionFailureCount += 1;

    if (this.loopDetectionFailureCount >= LOOP_DETECTION_FAILURE_THRESHOLD) {
      this.loopDetectionBreakerOpenUntil = Date.now() + LOOP_DETECTION_BREAKER_COOLDOWN_MS;
      // Logged once per trip: while the breaker is open no further LLM calls
      // (and thus no further failures) occur until the cooldown elapses.
      logger.warn(
        '[LoopPrevention] LLM loop detection circuit breaker tripped — skipping LLM checks during cooldown',
        {
          failureCount: this.loopDetectionFailureCount,
          cooldownMs: LOOP_DETECTION_BREAKER_COOLDOWN_MS,
        }
      );
    }
  }

  /**
   * Learn a new loop pattern
   */
  async learnPattern(
    conversationPattern: ConversationPattern,
    loopType: LoopType,
    resolutionStrategy: string,
    durationMs: number
  ): Promise<LoopPattern | null> {
    try {
      // Extract keywords from user messages
      const keywords = conversationPattern.messageTexts.filter(
        (_, idx) => conversationPattern.messageRoles[idx] === 'user'
      );

      const pattern = JSON.stringify(keywords);
      const hash = this.hashPattern(pattern);

      // Check if pattern already exists
      const existing = await this.repository.findPatternByHash(hash);
      if (existing) {
        // Update existing pattern
        await this.repository.updateAverages(
          existing.id,
          durationMs,
          conversationPattern.messageTexts.length
        );
        return existing;
      }

      // Create new pattern
      const newPattern = await this.repository.createPattern({
        patternHash: hash,
        pattern,
        loopType,
        frequency: 1,
        avgDurationMs: durationMs,
        avgMessageCount: conversationPattern.messageTexts.length,
        resolutionStrategy,
        confidence: 0.5, // Start with lower confidence
        metadata: JSON.stringify({ learned: true }),
      });

      // Refresh cache
      this.patternCache.set(hash, newPattern);

      logger.info('[LoopPrevention] Learned new pattern', {
        type: loopType,
        patternId: newPattern.id,
      });

      return newPattern;
    } catch (error) {
      logger.error('[LoopPrevention] Failed to learn pattern', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  }

  /**
   * Record a loop detection
   */
  private async recordDetection(
    detection: LoopDetectionResult,
    chatId: string,
    senderId: string | undefined,
    messages: Message[],
    pattern: ConversationPattern
  ): Promise<void> {
    try {
      // If no pattern ID, learn this as a new pattern
      let patternId = detection.patternId;
      if (!patternId && detection.loopType) {
        const startTime = pattern.messageTimestamps[0];
        const endTime = pattern.messageTimestamps[pattern.messageTimestamps.length - 1];
        const durationMs = endTime - startTime;

        const learned = await this.learnPattern(
          pattern,
          detection.loopType,
          detection.suggestedBreakpoint || 'manual_intervention',
          durationMs
        );

        if (learned) {
          patternId = learned.id;
        }
      }

      if (!patternId) {
        logger.warn('[LoopPrevention] Cannot record detection without pattern ID');
        return;
      }

      const messageIds = JSON.stringify(messages.map((m) => m.id));
      const startTime = pattern.messageTimestamps[0];
      const endTime = pattern.messageTimestamps[pattern.messageTimestamps.length - 1];
      const durationMs = endTime - startTime;

      await this.repository.createDetection({
        patternId,
        chatId,
        senderId: senderId || null,
        messageIds,
        messageCount: messages.length,
        durationMs,
        wasResolved: false,
      });

      logger.info('[LoopPrevention] Recorded loop detection', {
        patternId,
        chatId,
        loopType: detection.loopType,
        confidence: detection.confidence,
      });
    } catch (error) {
      logger.error('[LoopPrevention] Failed to record detection', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Mark a detection as resolved
   */
  async markResolved(
    detectionId: string,
    resolutionAction: string,
    userFeedback?: number
  ): Promise<void> {
    try {
      await this.repository.updateDetectionResolution(
        detectionId,
        resolutionAction,
        userFeedback
      );

      logger.info('[LoopPrevention] Marked detection as resolved', {
        detectionId,
        resolutionAction,
        userFeedback,
      });
    } catch (error) {
      logger.error('[LoopPrevention] Failed to mark resolved', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Get loop statistics
   */
  async getStats(): Promise<{
    totalPatterns: number;
    activePatterns: number;
    totalDetections: number;
    resolvedDetections: number;
    topLoopTypes: Array<{ type: string; count: number }>;
  }> {
    return await this.repository.getOverallStats();
  }

  /**
   * Get pattern library (all known patterns)
   */
  async getPatternLibrary(): Promise<LoopSignature[]> {
    const patterns = await this.repository.findActivePatterns(100);

    return patterns.map((p) => ({
      pattern: this.parsePatternKeywords(p.pattern),
      frequency: p.frequency,
      avgDuration: p.avgDurationMs,
      resolutionStrategy: p.resolutionStrategy,
    }));
  }

  /**
   * Suggest breakpoint strategy for detected loop
   */
  suggestBreakpoint(detection: LoopDetectionResult): string {
    if (detection.suggestedBreakpoint) {
      return detection.suggestedBreakpoint;
    }

    // Default strategies by type
    switch (detection.loopType) {
      case 'imperative_repeat':
        return 'Execute the pending action immediately without further confirmation';
      case 'clarification_loop':
        return 'Provide a concrete example or step-by-step breakdown';
      case 'execution_hesitation':
        return 'Act decisively with current information, explain reasoning';
      case 'misunderstanding':
        return 'Acknowledge the misunderstanding, rewind to the point of confusion';
      case 'context_lost':
        return 'Summarize previous context and resume from there';
      default:
        return 'Acknowledge the pattern and ask how to proceed differently';
    }
  }

  /**
   * Refresh pattern cache
   */
  private async refreshPatternCache(): Promise<void> {
    const now = Date.now();
    if (now - this.lastCacheUpdate < this.cacheTTL) {
      return; // Cache still valid
    }

    try {
      const patterns = await this.repository.findActivePatterns(100);
      this.patternCache.clear();

      for (const pattern of patterns) {
        this.patternCache.set(pattern.patternHash, pattern);
      }

      this.lastCacheUpdate = now;
    } catch (error) {
      logger.error('[LoopPrevention] Failed to refresh cache', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Parse keywords from pattern JSON
   */
  private parsePatternKeywords(patternJson: string): string[] {
    try {
      return JSON.parse(patternJson);
    } catch {
      return [];
    }
  }

  /**
   * Count keyword matches in messages
   */
  private countKeywordMatches(messageTexts: string[], keywords: string[]): number {
    let matches = 0;
    const allText = messageTexts.join(' ');

    for (const keyword of keywords) {
      if (allText.includes(keyword.toLowerCase())) {
        matches++;
      }
    }

    return matches;
  }

  /**
   * Hash a pattern for deduplication
   */
  private hashPattern(pattern: string): string {
    return createHash('sha256').update(pattern).digest('hex');
  }
}
