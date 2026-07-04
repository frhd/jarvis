/**
 * Enhanced Intent Classifier Service
 * Phase 2: Granular taxonomy, confidence thresholds, hierarchy, and multi-turn detection
 *
 * This service orchestrates intent classification using:
 * - IntentCacheService: LRU cache for classification results
 * - IntentMetricsTracker: Metrics collection and reporting
 * - withTimeout: Non-blocking timeout utility
 */

import { createHash } from 'crypto';
import { LLMClient, ChatMessage } from '../../clients/llm.client.js';
import { appConfig } from '../../config/index.js';
import { logger } from '../../utils/logger.js';
import { withTimeoutAndWarning } from '../../utils/timeout.js';
import type { IIntentClassifier, ClassifierMetrics } from '../../interfaces/index.js';
import {
  ParentIntent,
  ChildIntent,
  EnhancedIntentResult,
  LegacyIntentCategory,
  ConfidenceThresholds,
  ConversationContextSignals,
  CHILD_TO_PARENT,
  DEFAULT_CONFIDENCE_THRESHOLDS,
  DEFAULT_ROUTING_CONFIG,
  INTENT_PATTERNS,
  CONTEXT_REFERENCE_PATTERNS,
} from '../../types/intent.types.js';
import {
  IntentCacheService,
  DEFAULT_CACHE_MAX_SIZE,
  DEFAULT_CACHE_TTL_MS,
} from './intent-cache.service.js';
import {
  IntentMetricsTracker,
  DEFAULT_METRICS_LOG_INTERVAL_MS,
  DEFAULT_IN_FLIGHT_CLEANUP_INTERVAL_MS,
  DEFAULT_IN_FLIGHT_STALE_THRESHOLD_MS,
} from './intent-metrics-tracker.service.js';

// Re-export for backward compatibility
export type { EnhancedIntentResult, LegacyIntentCategory };
export type IntentCategory = LegacyIntentCategory;
export interface IntentClassificationResult {
  intent: IntentCategory;
  confidence: number;
  durationMs: number;
}

/** Default keep-alive interval in milliseconds */
const DEFAULT_KEEPALIVE_INTERVAL_MS = 120_000; // 2 minutes

/** Timeout warning threshold (50% of timeout) */
const TIMEOUT_WARNING_THRESHOLD = 0.5;

/** Model warmup timeout in milliseconds */
const WARMUP_TIMEOUT_MS = 3000;

const ENHANCED_CLASSIFICATION_PROMPT = `You are an intent classifier. Analyze the user message and classify it into the most specific category.

## Parent Categories:
- greeting: Social interactions (hello, goodbye, thanks)
- question: Information seeking (what, how, why questions)
- command: Action requests (do something, create, search)
- feedback: Reactions (good, bad, ok, opinions)
- continuation: Follow-ups to previous messages

## Child Categories by Parent:

### greeting:
- simple_greeting: "hi", "hello", "hey"
- time_greeting: "good morning", "good evening"
- farewell: "bye", "see you", "talk later"
- gratitude: "thanks", "thank you", "appreciate it"

### question:
- factual_question: "what is X?", "who invented Y?"
- how_to_question: "how do I...", "how can I..."
- opinion_question: "what do you think?", "should I..."
- clarification: "what do you mean?", "can you explain?"
- web_search_question: requires current info (weather, news, prices, scores)
- personal_question: about the assistant ("what's your name?")
- health_status: "health", "status", "how are you doing?" system health inquiries

### command:
- task_request: things the assistant itself can execute via tools — "write code", "create a file", "save to memory", "run the script", "deploy", "commit changes", "implement X". Imperatives directed at *the assistant* about *code, files, system operations, or stored data*. DO NOT use task_request for: messages directed at people the assistant cannot reach ("write Tom a joke", "send a message to my friend", "tell him X", "call her", "schreibe ihm/ihr"). Those are opinion_statement or personal_sharing — the assistant has no tool to deliver messages to third parties.
- search_request: "search for", "find me", "look up"
- reminder_request: "remind me", "set a reminder"
- calculation: math operations
- translation: "translate X to Y"
- summarization: "summarize", "tldr"
- correction: "no, I meant...", "fix that"

### feedback:
- positive_feedback: "great!", "perfect", "that's right"
- negative_feedback: "wrong", "not what I wanted"
- acknowledgment: "ok", "got it", "understood"
- opinion_statement: expressing views
- personal_sharing: "my name is...", "I enjoy...", "I work as...", "I'm [name]"

### continuation:
- follow_up: continuing the same topic
- elaboration_request: "tell me more", "go on"
- topic_change: explicitly changing subject
- reference_previous: "about what you said earlier"

## Multi-turn Context:
If recent conversation is provided, consider:
- Does this message reference previous messages? (pronouns, "that", "it")
- Is it a follow-up or clarification?
- Does it continue or change the topic?

Respond ONLY with valid JSON:
{
  "parentIntent": "<parent_category>",
  "childIntent": "<child_category>",
  "confidence": <0.0-1.0>,
  "isFollowUp": <true/false>,
  "referencesContext": <true/false>,
  "requiresWebSearch": <true/false>,
  "requiresComplexReasoning": <true/false>
}`;

const VALID_PARENT_INTENTS: ParentIntent[] = [
  'greeting',
  'question',
  'command',
  'feedback',
  'continuation',
];

const VALID_CHILD_INTENTS: ChildIntent[] = [
  'simple_greeting', 'time_greeting', 'farewell', 'gratitude',
  'factual_question', 'how_to_question', 'opinion_question', 'clarification',
  'web_search_question', 'personal_question', 'health_status',
  'task_request', 'search_request', 'reminder_request', 'calculation',
  'translation', 'summarization', 'correction',
  'positive_feedback', 'negative_feedback', 'acknowledgment', 'opinion_statement', 'personal_sharing',
  'follow_up', 'elaboration_request', 'topic_change', 'reference_previous',
];

export interface EnhancedClassifierConfig {
  timeoutMs: number;
  temperature: number;
  confidenceThresholds: ConfidenceThresholds;
  enableEscalation: boolean;
  keepAliveIntervalMs: number;
  /** Enable result caching for cacheable intents */
  enableCache: boolean;
  /** Maximum number of cached results */
  cacheMaxSize: number;
  /** TTL for cached results in milliseconds */
  cacheTtlMs: number;
}

/** In-flight request with timestamp for stale cleanup */
interface InFlightEntry {
  promise: Promise<Omit<EnhancedIntentResult, 'durationMs'>>;
  startTime: number;
}

export class EnhancedIntentClassifierService implements IIntentClassifier {
  private llmClient: LLMClient;
  private config: EnhancedClassifierConfig;
  private keepAliveTimer?: NodeJS.Timeout;
  private metricsTracker: IntentMetricsTracker;
  private inFlightCleanupInterval?: NodeJS.Timeout;
  private inFlightRequests = new Map<string, InFlightEntry>();
  private cacheService: IntentCacheService<Omit<EnhancedIntentResult, 'durationMs'>>;

  constructor(
    llmClient: LLMClient,
    config?: Partial<EnhancedClassifierConfig>
  ) {
    this.llmClient = llmClient;
    this.config = {
      timeoutMs: config?.timeoutMs ?? appConfig.intentClassification.timeoutMs,
      temperature: config?.temperature ?? appConfig.intentClassification.temperature,
      confidenceThresholds: config?.confidenceThresholds ?? DEFAULT_CONFIDENCE_THRESHOLDS,
      enableEscalation: config?.enableEscalation ?? true,
      keepAliveIntervalMs: config?.keepAliveIntervalMs ?? DEFAULT_KEEPALIVE_INTERVAL_MS,
      enableCache: config?.enableCache ?? true,
      cacheMaxSize: config?.cacheMaxSize ?? DEFAULT_CACHE_MAX_SIZE,
      cacheTtlMs: config?.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS,
    };

    // Initialize cache service
    this.cacheService = new IntentCacheService({
      enabled: this.config.enableCache,
      maxSize: this.config.cacheMaxSize,
      ttlMs: this.config.cacheTtlMs,
    });

    // Initialize metrics tracker
    this.metricsTracker = new IntentMetricsTracker(DEFAULT_METRICS_LOG_INTERVAL_MS);
    this.metricsTracker.startPeriodicLogging();

    // Warm up model on initialization
    this.warmupModel();

    // Periodic cleanup of stale in-flight requests
    this.inFlightCleanupInterval = setInterval(() => {
      this.cleanupStaleInFlightRequests();
    }, DEFAULT_IN_FLIGHT_CLEANUP_INTERVAL_MS);
  }

  /**
   * Cleanup stale in-flight requests that may have been orphaned.
   * This is a safety net for edge cases where .finally() doesn't run.
   */
  private cleanupStaleInFlightRequests(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of Array.from(this.inFlightRequests.entries())) {
      if (now - entry.startTime > DEFAULT_IN_FLIGHT_STALE_THRESHOLD_MS) {
        this.inFlightRequests.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.metricsTracker.increment('staleInFlightCleanups', cleaned);
      logger.warn('[IntentClassifier] Cleaned up stale in-flight requests', {
        count: cleaned,
        remaining: this.inFlightRequests.size,
      });
    }
  }

  /**
   * Cleanup method for graceful shutdown
   */
  destroy(): void {
    this.metricsTracker.destroy();
    if (this.inFlightCleanupInterval) {
      clearInterval(this.inFlightCleanupInterval);
    }
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
    }
    this.cacheService.clear();
    this.inFlightRequests.clear();
  }

  /**
   * Main classification method with enhanced features
   */
  async classifyIntent(
    message: string,
    conversationContext?: string,
    previousIntents?: ChildIntent[]
  ): Promise<EnhancedIntentResult> {
    const startTime = Date.now();

    if (!appConfig.intentClassification.enabled) {
      logger.debug('Intent classification disabled, defaulting to general response');
      return this.createDefaultResult(startTime);
    }

    // Handle empty/minimal input early
    const trimmed = message.trim();
    if (!trimmed || this.isMinimalInput(trimmed)) {
      logger.debug('Empty or minimal input detected, returning clarification intent', {
        message: message.substring(0, 20),
        isEmpty: !trimmed,
      });
      return {
        parentIntent: 'question',
        childIntent: 'clarification',
        confidence: 0.90,
        confidenceLevel: 'high',
        shouldEscalate: false,
        isFollowUp: false,
        referencesContext: false,
        suggestedContextDepth: 0,
        requiresWebSearch: false,
        requiresComplexReasoning: false,
        canUseCache: false,
        classificationMethod: 'pattern',
        durationMs: Date.now() - startTime,
      };
    }

    // Analyze context signals first
    const contextSignals = this.analyzeContextSignals(message, conversationContext);

    // Check cache for messages without context references
    if (!contextSignals.hasPronounReferences && !contextSignals.hasExplicitReferences) {
      const cachedResult = this.cacheService.get(message);
      if (cachedResult) {
        this.metricsTracker.recordCacheHit();
        const durationMs = Date.now() - startTime;
        return { ...cachedResult, durationMs };
      }
      this.metricsTracker.recordCacheMiss();
    }

    // Fast path: pattern-based classification
    const fastResult = this.fastClassify(message, contextSignals);
    if (fastResult) {
      this.metricsTracker.increment('patternClassifications');

      // Cache pattern results if cacheable
      this.cacheService.set(message, fastResult);

      const durationMs = Date.now() - startTime;
      logger.debug('Enhanced intent classified via fast path', {
        message: message.substring(0, 50),
        parentIntent: fastResult.parentIntent,
        childIntent: fastResult.childIntent,
        confidence: fastResult.confidence,
        durationMs,
      });
      return { ...fastResult, durationMs };
    }

    // LLM-based classification
    try {
      const result = await this.classifyWithLLM(message, conversationContext, contextSignals);
      const durationMs = Date.now() - startTime;

      // Check if escalation is needed
      if (this.shouldEscalate(result.confidence)) {
        result.shouldEscalate = true;
        result.classificationMethod = 'llm';
      }

      this.metricsTracker.increment('llmClassifications');

      // Cache the result if cacheable
      this.cacheService.set(message, result);

      logger.debug('Enhanced intent classified via LLM', {
        message: message.substring(0, 50),
        parentIntent: result.parentIntent,
        childIntent: result.childIntent,
        confidence: result.confidence,
        confidenceLevel: result.confidenceLevel,
        shouldEscalate: result.shouldEscalate,
        durationMs,
      });

      return { ...result, durationMs };
    } catch (error) {
      this.metricsTracker.increment('fallbackClassifications');
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const durationMs = Date.now() - startTime;
      const isTimeout = errorMessage.toLowerCase().includes('timed out');

      if (isTimeout) {
        this.metricsTracker.recordTimeout(durationMs);
        const metrics = this.metricsTracker.getMetrics();
        logger.warn('Intent classification timed out, using fallback', {
          durationMs,
          configuredTimeoutMs: this.config.timeoutMs,
          timeoutCount: metrics.timeoutCount,
          avgTimeoutDurationMs: metrics.timeoutCount > 0
            ? Math.round(metrics.totalTimeoutDurationMs / metrics.timeoutCount)
            : 0,
        });
      } else {
        logger.warn('Enhanced intent classification failed, using fallback', {
          error: errorMessage,
          durationMs,
        });
      }

      // Always return a valid fallback result, never throw
      const fallback = this.createFallbackResult(message, contextSignals, durationMs);
      return fallback;
    }
  }

  /**
   * Legacy-compatible classification method
   */
  async classifyIntentLegacy(
    message: string,
    conversationContext?: string
  ): Promise<IntentClassificationResult> {
    const enhanced = await this.classifyIntent(message, conversationContext);
    return {
      intent: this.toLegacyIntent(enhanced),
      confidence: enhanced.confidence,
      durationMs: enhanced.durationMs,
    };
  }

  /**
   * Convert enhanced intent to legacy format
   */
  toLegacyIntent(result: EnhancedIntentResult): LegacyIntentCategory {
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
   * Analyze context signals from message and conversation history
   */
  private analyzeContextSignals(
    message: string,
    conversationContext?: string
  ): ConversationContextSignals {
    const hasPronounReferences = this.hasExternalPronounReferences(message);
    const hasExplicitReferences = CONTEXT_REFERENCE_PATTERNS.explicit.test(message);
    const hasContinuationMarkers = CONTEXT_REFERENCE_PATTERNS.continuation.test(message);
    const hasFollowUpMarkers = CONTEXT_REFERENCE_PATTERNS.followUp.test(message);

    // Determine conversation flow
    let conversationFlow: ConversationContextSignals['conversationFlow'] = 'new_topic';
    if (hasExplicitReferences || (hasPronounReferences && conversationContext)) {
      conversationFlow = 'continuation';
    } else if (hasContinuationMarkers) {
      conversationFlow = 'continuation';
    } else if (hasFollowUpMarkers) {
      conversationFlow = 'topic_shift';
    }

    // Simple topic coherence based on word overlap
    let topicCoherence = 0;
    if (conversationContext) {
      const messageWords = new Set(message.toLowerCase().split(/\s+/));
      const contextWords = conversationContext.toLowerCase().split(/\s+/);
      const commonWords = contextWords.filter(w => messageWords.has(w) && w.length > 3);
      topicCoherence = Math.min(1, commonWords.length / 5);
    }

    return {
      hasPronounReferences,
      hasExplicitReferences,
      hasContinuationMarkers,
      topicCoherence,
      conversationFlow,
    };
  }

  /**
   * Check if message contains external/context-referencing pronouns.
   */
  private hasExternalPronounReferences(text: string): boolean {
    const externalPronounPattern = /\b(it|this|that|these|those|they|them|he|she|him|her|its|their|theirs)\b/i;
    return externalPronounPattern.test(text);
  }

  /**
   * Check if input is minimal/unclear (just punctuation, confused sounds, etc.)
   */
  private isMinimalInput(text: string): boolean {
    // Just punctuation
    if (/^[?!.…,;:\-_*#@]+$/.test(text)) {
      return true;
    }
    // Confused sounds / minimal utterances
    if (/^(huh|um+|uh+|hmm+|ah+|oh+|eh+|meh)$/i.test(text)) {
      return true;
    }
    // Single character (excluding common single-char commands)
    if (text.length === 1 && !/^[a-zA-Z0-9]$/.test(text)) {
      return true;
    }
    return false;
  }

  /**
   * Fast pattern-based classification
   */
  private fastClassify(
    message: string,
    contextSignals: ConversationContextSignals
  ): Omit<EnhancedIntentResult, 'durationMs'> | null {
    const trimmed = message.trim();

    for (const pattern of INTENT_PATTERNS) {
      if (pattern.requiresContext && contextSignals.conversationFlow === 'new_topic') {
        continue;
      }

      for (const regex of pattern.patterns) {
        if (regex.test(trimmed)) {
          const parentIntent = CHILD_TO_PARENT[pattern.intent];
          return this.buildResult(
            parentIntent,
            pattern.intent,
            pattern.confidence,
            contextSignals,
            'pattern'
          );
        }
      }
    }

    return null;
  }

  /**
   * Create a content hash for request deduplication
   */
  private createContentHash(message: string, conversationContext: string | undefined): string {
    const content = `${message}|${conversationContext ?? ''}`;
    return createHash('sha256').update(content).digest('hex').substring(0, 16);
  }

  /**
   * LLM-based classification with non-blocking timeout and request deduplication
   */
  private async classifyWithLLM(
    message: string,
    conversationContext: string | undefined,
    contextSignals: ConversationContextSignals
  ): Promise<Omit<EnhancedIntentResult, 'durationMs'>> {
    const contentHash = this.createContentHash(message, conversationContext);
    const existingEntry = this.inFlightRequests.get(contentHash);

    if (existingEntry) {
      this.metricsTracker.increment('deduplicatedRequests');
      logger.debug('Reusing in-flight classification request', { contentHash });
      return existingEntry.promise;
    }

    const classificationPromise = this.executeClassification(
      message,
      conversationContext,
      contextSignals
    );

    // Attach catch immediately to prevent unhandled rejection
    classificationPromise.catch(() => {});

    const entry: InFlightEntry = {
      promise: classificationPromise,
      startTime: Date.now(),
    };
    this.inFlightRequests.set(contentHash, entry);
    classificationPromise.finally(() => {
      this.inFlightRequests.delete(contentHash);
    });

    return classificationPromise;
  }

  /**
   * Execute the actual LLM classification using withTimeoutAndWarning utility
   */
  private async executeClassification(
    message: string,
    conversationContext: string | undefined,
    contextSignals: ConversationContextSignals
  ): Promise<Omit<EnhancedIntentResult, 'durationMs'>> {
    const messages: ChatMessage[] = [
      { role: 'system', content: ENHANCED_CLASSIFICATION_PROMPT },
    ];

    if (conversationContext) {
      messages.push({
        role: 'user',
        content: `Recent conversation:\n${conversationContext}\n\nClassify this message: ${message}`,
      });
    } else {
      messages.push({
        role: 'user',
        content: `Classify this message: ${message}`,
      });
    }

    const requestId = `enhanced-intent-${Date.now()}`;
    const startTime = Date.now();

    const llmPromise = this.llmClient.chat(messages, requestId).then((response) => {
      const parsed = this.parseResponse(response.content);
      return this.buildResult(
        parsed.parentIntent,
        parsed.childIntent,
        parsed.confidence,
        contextSignals,
        'llm',
        parsed
      );
    });

    return withTimeoutAndWarning(llmPromise, {
      timeoutMs: this.config.timeoutMs,
      warningThreshold: TIMEOUT_WARNING_THRESHOLD,
      onWarning: (elapsedMs) => {
        this.metricsTracker.increment('timeoutWarnings');
        logger.warn('Intent classification taking longer than 50% timeout threshold', {
          elapsedMs,
          thresholdMs: this.config.timeoutMs * TIMEOUT_WARNING_THRESHOLD,
          timeoutMs: this.config.timeoutMs,
          message: message.substring(0, 50),
        });
      },
      onTimeout: () => {
        this.llmClient.cancelRequest(requestId);
      },
    });
  }

  /**
   * Parse LLM response
   */
  private parseResponse(content: string): {
    parentIntent: ParentIntent;
    childIntent: ChildIntent;
    confidence: number;
    isFollowUp?: boolean;
    referencesContext?: boolean;
    requiresWebSearch?: boolean;
    requiresComplexReasoning?: boolean;
  } {
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

      let parentIntent = parsed.parentIntent as ParentIntent;
      if (!VALID_PARENT_INTENTS.includes(parentIntent)) {
        parentIntent = 'question';
      }

      let childIntent = parsed.childIntent as ChildIntent;
      if (!VALID_CHILD_INTENTS.includes(childIntent)) {
        childIntent = 'factual_question';
      }

      let confidence = parsed.confidence as number;
      if (typeof confidence !== 'number' || confidence < 0 || confidence > 1) {
        confidence = 0.7;
      }

      return {
        parentIntent,
        childIntent,
        confidence,
        isFollowUp: Boolean(parsed.isFollowUp),
        referencesContext: Boolean(parsed.referencesContext),
        requiresWebSearch: Boolean(parsed.requiresWebSearch),
        requiresComplexReasoning: Boolean(parsed.requiresComplexReasoning),
      };
    } catch (error) {
      logger.warn('Failed to parse enhanced intent response', {
        content: content.substring(0, 100),
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return this.inferFromContent(content);
    }
  }

  /**
   * Infer intent from raw content when JSON parsing fails
   */
  private inferFromContent(content: string): {
    parentIntent: ParentIntent;
    childIntent: ChildIntent;
    confidence: number;
  } {
    const lowerContent = content.toLowerCase();

    const childIntentMatches: Array<[ChildIntent, string[]]> = [
      ['simple_greeting', ['simple_greeting', 'greeting', 'hello', 'hi']],
      ['web_search_question', ['web_search', 'search', 'weather', 'news', 'current']],
      ['task_request', ['task_request', 'task', 'code', 'create', 'write']],
      ['clarification', ['clarification', 'clarify', 'explain', 'what do you mean']],
      ['follow_up', ['follow_up', 'follow-up', 'continuation']],
      ['positive_feedback', ['positive_feedback', 'positive', 'great', 'thanks']],
      ['negative_feedback', ['negative_feedback', 'negative', 'wrong', 'incorrect']],
    ];

    for (const [intent, keywords] of childIntentMatches) {
      if (keywords.some(k => lowerContent.includes(k))) {
        return {
          parentIntent: CHILD_TO_PARENT[intent],
          childIntent: intent,
          confidence: 0.6,
        };
      }
    }

    return {
      parentIntent: 'question',
      childIntent: 'factual_question',
      confidence: 0.5,
    };
  }

  /**
   * Build result object
   */
  private buildResult(
    parentIntent: ParentIntent,
    childIntent: ChildIntent,
    confidence: number,
    contextSignals: ConversationContextSignals,
    method: 'pattern' | 'llm' | 'escalated',
    parsed?: {
      isFollowUp?: boolean;
      referencesContext?: boolean;
      requiresWebSearch?: boolean;
      requiresComplexReasoning?: boolean;
    }
  ): Omit<EnhancedIntentResult, 'durationMs'> {
    const confidenceLevel = this.getConfidenceLevel(confidence);
    const shouldEscalate = this.shouldEscalate(confidence);

    const requiresWebSearch = parsed?.requiresWebSearch ||
      DEFAULT_ROUTING_CONFIG.webSearchIntents.includes(childIntent);

    const requiresComplexReasoning = parsed?.requiresComplexReasoning ||
      DEFAULT_ROUTING_CONFIG.powerfulModelIntents.includes(childIntent);

    const canUseCache = DEFAULT_ROUTING_CONFIG.cacheableIntents.includes(childIntent) &&
      !contextSignals.hasPronounReferences &&
      !contextSignals.hasExplicitReferences;

    const isFollowUp = parsed?.isFollowUp ||
      contextSignals.conversationFlow === 'continuation' ||
      parentIntent === 'continuation';

    const referencesContext = parsed?.referencesContext ||
      contextSignals.hasPronounReferences ||
      contextSignals.hasExplicitReferences;

    let suggestedContextDepth = 0;
    if (isFollowUp || referencesContext) {
      suggestedContextDepth = contextSignals.topicCoherence > 0.5 ? 5 : 3;
    }

    return {
      parentIntent,
      childIntent,
      confidence,
      confidenceLevel,
      shouldEscalate,
      isFollowUp,
      referencesContext,
      suggestedContextDepth,
      requiresWebSearch,
      requiresComplexReasoning,
      canUseCache,
      classificationMethod: method,
    };
  }

  /**
   * Get confidence level
   */
  private getConfidenceLevel(confidence: number): 'high' | 'medium' | 'low' | 'uncertain' {
    const { high, medium, low } = this.config.confidenceThresholds;

    if (confidence >= high) return 'high';
    if (confidence >= medium) return 'medium';
    if (confidence >= low) return 'low';
    return 'uncertain';
  }

  /**
   * Check if escalation is needed
   */
  private shouldEscalate(confidence: number): boolean {
    return this.config.enableEscalation &&
      confidence < this.config.confidenceThresholds.escalate;
  }

  /**
   * Get classification metrics
   */
  getMetrics(): ClassifierMetrics {
    const metrics = this.metricsTracker.getMetrics();
    return {
      patternClassifications: metrics.patternClassifications,
      llmClassifications: metrics.llmClassifications,
      fallbackClassifications: metrics.fallbackClassifications,
      timeoutCount: metrics.timeoutCount,
      deduplicatedRequests: metrics.deduplicatedRequests,
      cacheHits: metrics.cacheHits,
      cacheMisses: metrics.cacheMisses,
    };
  }

  /**
   * Create default result when classification is disabled
   */
  private createDefaultResult(startTime: number): EnhancedIntentResult {
    return {
      parentIntent: 'question',
      childIntent: 'factual_question',
      confidence: 1.0,
      confidenceLevel: 'high',
      shouldEscalate: false,
      isFollowUp: false,
      referencesContext: false,
      suggestedContextDepth: 0,
      requiresWebSearch: false,
      requiresComplexReasoning: false,
      canUseCache: false,
      durationMs: Date.now() - startTime,
      classificationMethod: 'pattern',
    };
  }

  /**
   * Create fallback result on error
   */
  private createFallbackResult(
    message: string,
    contextSignals: ConversationContextSignals,
    durationMs: number
  ): EnhancedIntentResult {
    let parentIntent: ParentIntent = 'question';
    let childIntent: ChildIntent = 'factual_question';

    if (contextSignals.conversationFlow === 'continuation') {
      parentIntent = 'continuation';
      childIntent = 'follow_up';
    }

    return {
      parentIntent,
      childIntent,
      confidence: 0.5,
      confidenceLevel: 'low',
      shouldEscalate: true,
      isFollowUp: contextSignals.conversationFlow === 'continuation',
      referencesContext: contextSignals.hasPronounReferences || contextSignals.hasExplicitReferences,
      suggestedContextDepth: 3,
      requiresWebSearch: false,
      requiresComplexReasoning: false,
      canUseCache: false,
      durationMs,
      classificationMethod: 'pattern',
    };
  }

  /**
   * Warm up the model to prevent cold start timeouts
   */
  private async warmupModel(): Promise<void> {
    const startTime = Date.now();

    logger.debug('Warming up intent classification model');

    const warmupMessage: ChatMessage[] = [
      { role: 'user', content: 'ping' },
    ];

    const requestId = `warmup-${Date.now()}`;

    try {
      await withTimeoutAndWarning(
        this.llmClient.chat(warmupMessage, requestId),
        {
          timeoutMs: WARMUP_TIMEOUT_MS,
          warningThreshold: 1, // No warning needed for warmup
          onWarning: () => {},
          onTimeout: () => {
            this.llmClient.cancelRequest(requestId);
          },
        }
      );

      const durationMs = Date.now() - startTime;
      logger.info('Intent classification model warmed up', { durationMs });
    } catch {
      logger.debug('Model warmup failed (this is ok if model is already loaded)');
    }
  }

  /**
   * Start periodic keep-alive to prevent model unloading
   */
  startKeepAlive(): void {
    if (this.keepAliveTimer) {
      logger.debug('Keep-alive already running');
      return;
    }

    logger.info('Starting intent model keep-alive', {
      intervalMs: this.config.keepAliveIntervalMs,
    });

    this.keepAliveTimer = setInterval(() => {
      this.warmupModel().catch(err => {
        logger.debug('Keep-alive ping failed', {
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      });
    }, this.config.keepAliveIntervalMs);
  }

  /**
   * Stop keep-alive timer
   */
  stopKeepAlive(): void {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = undefined;
      logger.info('Intent model keep-alive stopped');
    }
  }
}
