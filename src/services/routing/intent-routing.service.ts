/**
 * Intent Routing Service
 *
 * Extracts intent classification and routing logic from ResponseRouterService.
 * Handles:
 * - Intent classification (legacy and enhanced)
 * - Routing decision based on intent
 * - Intent classification logging
 */

import type { IntentClassifierService } from '../intentClassifier.service.js';
import type { EnhancedIntentClassifierService } from '../enhancedIntentClassifier.service.js';
import type { IntentLogRepository } from '../../repositories/intentLog.repository.js';
import type { EnhancedIntentResult } from '../../types/intent.types.js';
import type { IntentCategory } from '../intentClassifier.service.js';
import { logger } from '../../utils/logger.js';

/**
 * Result of intent routing classification
 */
export interface IntentRoutingResult {
  // Legacy intent (for backward compatibility)
  intent: IntentCategory;
  confidence: number;
  durationMs: number;

  // Enhanced intent (if available)
  enhancedIntent?: EnhancedIntentResult;

  // Routing decision hints
  useCache: boolean;
  routeTo: 'ollama' | 'claude';
  priority: 'fast' | 'normal' | 'complex';
}

export interface IntentRoutingConfig {
  useEnhancedClassifier: boolean;
  enableIntentLogging: boolean;
}

/**
 * IntentRoutingService
 *
 * Classifies user messages and provides routing decisions based on intent.
 */
export class IntentRoutingService {
  private config: IntentRoutingConfig;

  constructor(
    private intentClassifier: IntentClassifierService,
    private enhancedClassifier?: EnhancedIntentClassifierService,
    private intentLogRepo?: IntentLogRepository,
    config?: Partial<IntentRoutingConfig>
  ) {
    this.config = {
      useEnhancedClassifier: config?.useEnhancedClassifier ?? true,
      enableIntentLogging: config?.enableIntentLogging ?? true,
    };
  }

  /**
   * Classify intent and provide routing decision
   */
  async classifyIntent(
    messageText: string,
    contextText?: string
  ): Promise<IntentRoutingResult> {
    const startTime = Date.now();

    // Try enhanced classifier first if available and enabled
    let enhancedResult: EnhancedIntentResult | null = null;
    let legacyIntent: IntentCategory = 'general_chat';
    let confidence = 0.5;

    if (this.config.useEnhancedClassifier && this.enhancedClassifier) {
      try {
        enhancedResult = await this.enhancedClassifier.classifyIntent(messageText, contextText);

        // Convert to legacy format for backward compatibility
        legacyIntent = this.toLegacyIntent(enhancedResult);
        confidence = enhancedResult.confidence;

        logger.debug('[IntentRouting] Enhanced intent classified', {
          parentIntent: enhancedResult.parentIntent,
          childIntent: enhancedResult.childIntent,
          confidence: enhancedResult.confidence,
          confidenceLevel: enhancedResult.confidenceLevel,
          shouldEscalate: enhancedResult.shouldEscalate,
          classificationMethod: enhancedResult.classificationMethod,
          durationMs: enhancedResult.durationMs,
        });
      } catch (error) {
        logger.warn('[IntentRouting] Enhanced classification failed, falling back to legacy', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        // Fall through to legacy classifier
        enhancedResult = null;
      }
    }

    // Fallback to legacy classifier
    if (!enhancedResult) {
      try {
        const legacyResult = await this.intentClassifier.classifyIntent(messageText, contextText);
        legacyIntent = legacyResult.intent;
        confidence = legacyResult.confidence;

        logger.debug('[IntentRouting] Legacy intent classified', {
          intent: legacyIntent,
          confidence,
          durationMs: legacyResult.durationMs,
        });
      } catch (error) {
        logger.warn('[IntentRouting] Intent classification failed, defaulting to general_chat', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        legacyIntent = 'general_chat';
        confidence = 0.5;
      }
    }

    const durationMs = Date.now() - startTime;

    // Determine routing based on intent
    const routingDecision = enhancedResult
      ? this.getEnhancedRoutingDecision(enhancedResult, messageText)
      : this.getLegacyRoutingDecision(legacyIntent, messageText);

    return {
      intent: legacyIntent,
      confidence,
      durationMs,
      enhancedIntent: enhancedResult || undefined,
      ...routingDecision,
    };
  }

  /**
   * Convert enhanced intent to legacy format
   */
  toLegacyIntent(result: EnhancedIntentResult): IntentCategory {
    // Map to legacy categories
    if (result.childIntent === 'simple_greeting' ||
        result.childIntent === 'time_greeting') {
      return 'simple_greeting';
    }

    if (result.requiresWebSearch ||
        result.childIntent === 'web_search_question' ||
        result.childIntent === 'search_request') {
      return 'needs_web_search';
    }

    if (result.requiresComplexReasoning ||
        result.childIntent === 'task_request' ||
        result.childIntent === 'summarization' ||
        result.childIntent === 'how_to_question') {
      return 'complex_task';
    }

    return 'general_chat';
  }

  /**
   * Log intent classification for accuracy monitoring
   */
  async logClassification(messageId: string, result: EnhancedIntentResult): Promise<void> {
    if (!this.config.enableIntentLogging || !this.intentLogRepo) {
      return;
    }

    try {
      await this.intentLogRepo.create({
        messageId,
        parentIntent: result.parentIntent,
        childIntent: result.childIntent,
        confidence: result.confidence,
        confidenceLevel: result.confidenceLevel,
        classificationMethod: result.classificationMethod,
        wasEscalated: result.shouldEscalate,
        durationMs: result.durationMs,
      });

      logger.debug('[IntentRouting] Classification logged', {
        messageId,
        childIntent: result.childIntent,
        confidence: result.confidence,
      });
    } catch (error) {
      logger.warn('[IntentRouting] Failed to log intent classification', {
        messageId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Operational commands that require Claude (not Ollama)
   * These involve system actions, file operations, or code execution
   */
  private static readonly OPERATIONAL_PATTERNS = [
    /\b(commit|push|pull|merge|rebase|checkout)\b/i,
    /\b(restart|stop|start|kill|deploy|build)\b/i,
    /\b(clear|delete|remove|drop)\s+(cache|logs?|data|table)/i,
    /\b(run|execute|install|update|upgrade)\b/i,
    /\b(fix|debug|patch|hotfix)\s+(the|this|that)?\s*(bug|error|issue|code)/i,
    /\b(modify|edit|change|update)\s+(the|this)?\s*(file|code|config|database)/i,
    /\b(create|write|generate)\s+(a|the)?\s*(file|script|function|code)/i,
    /\b(check|show|get)\s+(the)?\s*(status|logs?|memory|cpu|disk)/i,
    /\b(talk\s+to|ask|tell|message)\s+(claude|gpt|ai|llm)/i,
  ];

  /**
   * Check if message contains operational commands that Ollama shouldn't handle
   */
  private isOperationalCommand(messageText: string): boolean {
    const text = messageText.toLowerCase();
    return IntentRoutingService.OPERATIONAL_PATTERNS.some(pattern => pattern.test(text));
  }

  /**
   * Get routing decision based on enhanced intent
   */
  private getEnhancedRoutingDecision(
    intent: EnhancedIntentResult,
    messageText: string
  ): {
    useCache: boolean;
    routeTo: 'ollama' | 'claude';
    priority: 'fast' | 'normal' | 'complex';
  } {
    // ALWAYS route operational commands to Claude - Ollama cannot perform these
    if (this.isOperationalCommand(messageText)) {
      logger.debug('[IntentRouting] Operational command detected, routing to Claude', {
        childIntent: intent.childIntent,
        pattern: 'operational_command',
      });
      return {
        useCache: false,
        routeTo: 'claude',
        priority: 'complex',
      };
    }

    // Simple greetings and acknowledgments go to Ollama with caching
    if (
      intent.childIntent === 'simple_greeting' ||
      intent.childIntent === 'time_greeting' ||
      intent.childIntent === 'farewell' ||
      intent.childIntent === 'gratitude' ||
      (intent.childIntent === 'acknowledgment' && intent.confidence >= 0.8)
    ) {
      return {
        useCache: intent.canUseCache,
        routeTo: 'ollama',
        priority: 'fast',
      };
    }

    // Personal sharing requires meaningful engagement - route to Claude
    if (intent.childIntent === 'personal_sharing') {
      return {
        useCache: false,
        routeTo: 'claude',
        priority: 'normal',
      };
    }

    // Clarification requests with low/no context go to Ollama for quick friendly response
    if (intent.childIntent === 'clarification' && !intent.referencesContext) {
      return {
        useCache: false,
        routeTo: 'ollama',
        priority: 'fast',
      };
    }

    // Plan workflow intents require Claude with full context
    if (intent.parentIntent === 'plan') {
      logger.debug('[IntentRouting] Plan intent detected, routing to Claude', {
        childIntent: intent.childIntent,
      });
      return {
        useCache: false, // Never cache plan operations
        routeTo: 'claude',
        priority: 'complex',
      };
    }

    // Complex tasks and high-confidence commands go to Claude
    if (
      intent.requiresComplexReasoning ||
      intent.requiresWebSearch ||
      intent.childIntent === 'task_request' ||
      intent.childIntent === 'summarization' ||
      intent.childIntent === 'how_to_question'
    ) {
      return {
        useCache: false,
        routeTo: 'claude',
        priority: 'complex',
      };
    }

    // Default to Claude for quality
    return {
      useCache: intent.canUseCache,
      routeTo: 'claude',
      priority: 'normal',
    };
  }

  /**
   * Get routing decision based on legacy intent
   */
  private getLegacyRoutingDecision(
    intent: IntentCategory,
    messageText: string
  ): {
    useCache: boolean;
    routeTo: 'ollama' | 'claude';
    priority: 'fast' | 'normal' | 'complex';
  } {
    // ALWAYS route operational commands to Claude - Ollama cannot perform these
    if (this.isOperationalCommand(messageText)) {
      logger.debug('[IntentRouting] Operational command detected (legacy), routing to Claude', {
        intent,
        pattern: 'operational_command',
      });
      return {
        useCache: false,
        routeTo: 'claude',
        priority: 'complex',
      };
    }

    switch (intent) {
      case 'simple_greeting':
        return {
          useCache: true,
          routeTo: 'ollama',
          priority: 'fast',
        };

      case 'needs_web_search':
      case 'complex_task':
        return {
          useCache: false,
          routeTo: 'claude',
          priority: 'complex',
        };

      case 'general_chat':
      default:
        return {
          useCache: false,
          routeTo: 'claude',
          priority: 'normal',
        };
    }
  }
}
