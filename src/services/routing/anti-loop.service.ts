/**
 * Anti-Loop Detection Service
 *
 * Extracts anti-loop detection logic from ResponseRouterService.
 * Detects frustration + imperative patterns that should bypass normal flow
 * and execute immediately.
 *
 * This service combines signals from:
 * - FrustrationDetectorService: User frustration level (0-10)
 * - ImperativeDetectionService: Imperative command detection
 * - LoopPreventionService: Conversation loop detection
 *
 * Decision logic (from ResponseRouterService):
 * - Frustration >= 5 AND imperative shouldExecute = EXECUTE NOW
 * - Loop detected with high confidence (>0.7) AND frustration >= 5 = EXECUTE NOW
 * - Repeated imperatives (2+) = EXECUTE NOW (handled by imperativeResult.shouldExecute)
 */

import type { Message, Chat, Sender } from '../../types/index.js';
import {
  FrustrationDetectorService,
  FrustrationMetrics,
} from '../frustrationDetector.service.js';
import {
  ImperativeDetectionService,
  ConversationState,
  ImperativeDetectionResult,
} from '../imperativeDetection.service.js';
import {
  LoopPreventionService,
  LoopDetectionResult,
} from '../loopPrevention.service.js';
import { logger } from '../../utils/logger.js';

/**
 * Result of pending action detection
 */
export interface PendingAction {
  description: string;
  confidence: number;
}

/**
 * Complete anti-loop override result
 */
export interface AntiLoopResult {
  shouldExecuteImmediately: boolean;
  frustrationLevel: number;
  imperativeConfidence: string;
  loopDetected: boolean;
  reason: string;
}

/**
 * Configuration for anti-loop detection
 */
export interface AntiLoopConfig {
  frustrationThreshold: number;
  loopConfidenceThreshold: number;
  enabled: boolean;
}

const DEFAULT_CONFIG: AntiLoopConfig = {
  frustrationThreshold: 5,
  loopConfidenceThreshold: 0.7,
  enabled: true,
};

/**
 * AntiLoopService
 *
 * Provides anti-loop detection capabilities to identify when users are
 * frustrated and should have their requests executed immediately without
 * further analysis or confirmation loops.
 */
export class AntiLoopService {
  private config: AntiLoopConfig;
  private frustrationDetector: FrustrationDetectorService | null = null;
  private imperativeDetector: ImperativeDetectionService | null = null;
  private loopPreventionService: LoopPreventionService | null = null;

  constructor(
    frustrationDetector?: FrustrationDetectorService,
    imperativeDetector?: ImperativeDetectionService,
    loopPreventionService?: LoopPreventionService,
    config?: Partial<AntiLoopConfig>
  ) {
    this.frustrationDetector = frustrationDetector ?? null;
    this.imperativeDetector = imperativeDetector ?? null;
    this.loopPreventionService = loopPreventionService ?? null;
    this.config = { ...DEFAULT_CONFIG, ...config };

    logger.info('[AntiLoop] Service initialized', {
      config: this.config,
      hasFrustrationDetector: !!this.frustrationDetector,
      hasImperativeDetector: !!this.imperativeDetector,
      hasLoopPrevention: !!this.loopPreventionService,
    });
  }

  /**
   * Check for anti-loop override conditions
   * Detects frustration + imperative patterns that should bypass normal flow
   *
   * @param message - Current message
   * @param chat - Chat context
   * @param sender - Sender information
   * @param conversationHistory - Recent conversation messages
   * @returns Anti-loop detection result
   */
  async checkForOverride(
    message: Message,
    chat: Chat,
    sender: Sender | null,
    conversationHistory: Message[]
  ): Promise<AntiLoopResult> {
    if (!this.config.enabled) {
      return this.createNoOverrideResult('Anti-loop detection disabled');
    }

    const messageText = message.text || '';

    // Default: no override
    const noOverride = this.createNoOverrideResult('No anti-loop conditions detected');

    // Skip if no anti-loop services configured
    if (!this.frustrationDetector && !this.imperativeDetector && !this.loopPreventionService) {
      return noOverride;
    }

    try {
      // Build conversation state for imperative detection
      const conversationState: ConversationState = {
        userId: sender?.id || 'unknown',
        recentMessages: conversationHistory.slice(0, 10).map((m) => ({
          content: m.text || '',
          timestamp: m.createdAt,
          isFromUser: !m.isBot,
        })),
        pendingAction: this.detectPendingAction(conversationHistory),
      };

      // 1. Check imperative detection
      let imperativeResult: ImperativeDetectionResult | null = null;
      if (this.imperativeDetector) {
        imperativeResult = this.imperativeDetector.detect(messageText, conversationState);
      }

      // 2. Check frustration level
      let frustrationMetrics: FrustrationMetrics | null = null;
      if (this.frustrationDetector) {
        frustrationMetrics = await this.frustrationDetector.analyze(
          [message, ...conversationHistory],
          sender?.id
        );
      }

      // 3. Check loop detection
      let loopResult: LoopDetectionResult | null = null;
      if (this.loopPreventionService) {
        loopResult = await this.loopPreventionService.detectLoop(
          [message, ...conversationHistory],
          chat.id,
          sender?.id
        );
      }

      // Combine signals to determine if we should execute immediately
      const frustrationLevel = frustrationMetrics?.level ?? imperativeResult?.frustrationLevel ?? 0;
      const imperativeConfidence = imperativeResult?.confidence ?? 'none';
      const loopDetected = loopResult?.detected ?? false;

      // Decision logic (from IMPL.md spec):
      // - Frustration >= 5 AND imperative shouldExecute = EXECUTE NOW
      // - Loop detected with high confidence (>0.7) AND frustration >= 5 = EXECUTE NOW
      // - Repeated imperatives (2+) = EXECUTE NOW (handled by imperativeResult.shouldExecute)

      if (imperativeResult?.shouldExecute && frustrationLevel >= this.config.frustrationThreshold) {
        return {
          shouldExecuteImmediately: true,
          frustrationLevel,
          imperativeConfidence,
          loopDetected,
          reason: `Frustration (${frustrationLevel}/10) + imperative (${imperativeConfidence}) = execute immediately`,
        };
      }

      if (
        loopDetected &&
        (loopResult?.confidence ?? 0) > this.config.loopConfidenceThreshold &&
        frustrationLevel >= this.config.frustrationThreshold
      ) {
        return {
          shouldExecuteImmediately: true,
          frustrationLevel,
          imperativeConfidence,
          loopDetected,
          reason: `Loop detected (${((loopResult?.confidence ?? 0) * 100).toFixed(0)}% confidence) + frustration (${frustrationLevel}/10)`,
        };
      }

      // Log detection results for monitoring
      if (frustrationLevel >= 3 || loopDetected || imperativeResult?.isImperative) {
        logger.info('[AntiLoop] Signals detected (no override)', {
          messageId: message.id,
          frustrationLevel,
          imperativeConfidence,
          imperativeShouldExecute: imperativeResult?.shouldExecute,
          loopDetected,
          loopConfidence: loopResult?.confidence,
        });
      }

      return noOverride;
    } catch (error) {
      logger.error('[AntiLoop] Check failed', {
        messageId: message.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return noOverride;
    }
  }

  /**
   * Detect if there's a pending action from recent conversation
   *
   * Looks for bot messages that suggest a pending action (e.g., "would you like me to...")
   *
   * @param conversationHistory - Recent conversation messages
   * @returns Pending action description or undefined
   */
  detectPendingAction(conversationHistory: Message[]): PendingAction | undefined {
    // Look for bot messages that suggest a pending action
    const recentBotMessages = conversationHistory
      .filter((m) => m.isBot && m.text)
      .slice(0, 3);

    for (const msg of recentBotMessages) {
      const text = msg.text?.toLowerCase() || '';

      // Patterns that suggest a pending action
      if (
        text.includes('would you like me to') ||
        text.includes('should i ') ||
        text.includes('do you want me to') ||
        text.includes('shall i ') ||
        text.includes('can i ')
      ) {
        // Extract the action description
        const actionMatch = text.match(
          /(?:would you like me to|should i|do you want me to|shall i|can i)\s+(.+?)(?:\?|$)/i
        );

        return {
          description: actionMatch?.[1] || 'perform the suggested action',
          confidence: 0.8,
        };
      }
    }

    return undefined;
  }

  /**
   * Create a "no override" result
   */
  private createNoOverrideResult(reason: string): AntiLoopResult {
    return {
      shouldExecuteImmediately: false,
      frustrationLevel: 0,
      imperativeConfidence: 'none',
      loopDetected: false,
      reason,
    };
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<AntiLoopConfig>): void {
    this.config = { ...this.config, ...updates };
    logger.info('[AntiLoop] Configuration updated', { config: this.config });
  }

  /**
   * Get current configuration
   */
  getConfig(): AntiLoopConfig {
    return { ...this.config };
  }

  /**
   * Set frustration detector service
   */
  setFrustrationDetector(detector: FrustrationDetectorService): void {
    this.frustrationDetector = detector;
    logger.info('[AntiLoop] Frustration detector set');
  }

  /**
   * Set imperative detector service
   */
  setImperativeDetector(detector: ImperativeDetectionService): void {
    this.imperativeDetector = detector;
    logger.info('[AntiLoop] Imperative detector set');
  }

  /**
   * Set loop prevention service
   */
  setLoopPreventionService(service: LoopPreventionService): void {
    this.loopPreventionService = service;
    logger.info('[AntiLoop] Loop prevention service set');
  }
}
