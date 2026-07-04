import type { SemanticCacheService, CacheResult } from '../semanticCache.service.js';
import { logger } from '../../utils/logger.js';
import { appConfig } from '../../config/index.js';

/**
 * Configuration for the response cache service
 */
export interface ResponseCacheConfig {
  enableCache: boolean;
  greetingSimilarityThreshold: number;
  maxGreetingWordCount: number;
}

/**
 * Patterns that indicate personal information sharing
 * These messages should bypass cache to ensure personalized responses
 */
const PERSONAL_INFO_PATTERNS = [
  /\bmy name is\b/i,
  /\bi'?m\s+[A-Z][a-z]+\b/,  // "I'm Alex", "Im Sarah"
  /\bcall me\s+\w+/i,
  /\bi work (?:at|for|as)\b/i,
  /\bi live (?:in|at)\b/i,
  /\bi'?m from\b/i,
];

/**
 * Service that handles caching logic for response routing.
 * Extracted from ResponseRouterService to separate concerns.
 */
export class ResponseCacheService {
  private config: ResponseCacheConfig;

  constructor(
    private semanticCache: SemanticCacheService | null = null,
    config?: Partial<ResponseCacheConfig>
  ) {
    this.config = {
      enableCache: config?.enableCache ?? true,
      greetingSimilarityThreshold: config?.greetingSimilarityThreshold ?? 0.88,
      maxGreetingWordCount: config?.maxGreetingWordCount ?? 12,
    };
  }

  /**
   * Check if caching is enabled
   */
  isEnabled(): boolean {
    return this.config.enableCache && this.semanticCache !== null;
  }

  /**
   * Check if an intent is cacheable
   */
  isCacheable(intent: string): boolean {
    if (!this.semanticCache) {
      return false;
    }
    return this.semanticCache.isCacheable(intent);
  }

  /**
   * Try to get response from cache
   *
   * @param prompt - The user prompt to look up
   * @param intent - The classified intent of the message
   * @param options - Additional options for cache lookup
   * @returns Cache result if found, null otherwise
   */
  async lookup(
    prompt: string,
    intent: string,
    options: { isFirstMessage?: boolean; conversationLength?: number } = {}
  ): Promise<CacheResult | null> {
    if (!this.isEnabled() || !this.semanticCache) {
      return null;
    }

    const trimmedPrompt = prompt.trim();

    // Skip cache for messages containing personal information patterns
    if (this.containsPersonalInfo(trimmedPrompt)) {
      logger.debug('[ResponseCache] Skipping cache - personal info detected', {
        intent,
        promptLength: trimmedPrompt.length,
      });
      return null;
    }

    // For first message, only skip cache if it contains personalization markers
    // Generic greetings like "hi" can still use cache for faster response
    if (options.isFirstMessage && this.containsPersonalization(trimmedPrompt)) {
      logger.debug('[ResponseCache] Skipping cache - first message with personalization', {
        intent,
      });
      return null;
    }

    const isGreeting = this.isGreetingIntent(intent);
    const wordCount = trimmedPrompt.split(/\s+/).length;

    // For greeting intents, skip cache if message is too long (likely contains more than just a greeting)
    if (isGreeting && wordCount > this.config.maxGreetingWordCount) {
      logger.debug('[ResponseCache] Skipping cache - greeting message too long', {
        intent,
        wordCount,
        maxAllowed: this.config.maxGreetingWordCount,
      });
      return null;
    }

    try {
      // Use higher similarity threshold for greetings to prevent over-matching
      const minSimilarity = isGreeting
        ? this.config.greetingSimilarityThreshold
        : appConfig.cache.similarityThreshold;

      const cacheResult = await this.semanticCache.lookup(prompt, {
        intent,
        useSemanticSearch: true,
        minSimilarity,
      });

      if (cacheResult.hit && cacheResult.response) {
        return cacheResult;
      }

      return null;
    } catch (error) {
      logger.warn('[ResponseCache] Cache lookup failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  }

  /**
   * Check if an intent is a greeting-related intent
   */
  private isGreetingIntent(intent: string): boolean {
    return ['simple_greeting', 'time_greeting', 'farewell', 'gratitude'].includes(intent);
  }

  /**
   * Check if a message contains personal information patterns
   */
  private containsPersonalInfo(text: string): boolean {
    return PERSONAL_INFO_PATTERNS.some(pattern => pattern.test(text));
  }

  /**
   * Check if a message contains personalization markers that require a unique response.
   * This is more lenient than containsPersonalInfo - it checks for context-dependent
   * elements that would make a cached response inappropriate.
   */
  private containsPersonalization(text: string): boolean {
    const lowerText = text.toLowerCase();

    // Check for personal info patterns (names, work, location)
    if (this.containsPersonalInfo(text)) {
      return true;
    }

    // Check for context-dependent questions
    const contextDependentPatterns = [
      /\bremember\b/i,           // "do you remember me?"
      /\bmy\s+(name|location|job|preference)/i,  // "what's my name?"
      /\bwe\s+(talked|discussed|spoke)/i,  // "we talked about..."
      /\blast\s+time\b/i,        // "last time we..."
    ];

    return contextDependentPatterns.some(pattern => pattern.test(lowerText));
  }

  /**
   * Store response in cache if intent is cacheable
   *
   * @param prompt - The user prompt
   * @param response - The response to cache
   * @param intent - The classified intent of the message
   * @param model - The model that generated the response
   */
  async store(
    prompt: string,
    response: string,
    intent: string,
    model: string
  ): Promise<void> {
    if (!this.isEnabled() || !this.semanticCache || !response) {
      return;
    }

    // Only cache if the intent is cacheable
    if (!this.isCacheable(intent)) {
      return;
    }

    try {
      await this.semanticCache.store(prompt, response, {
        intent,
        model,
      });

      logger.debug('[ResponseCache] Response cached', {
        intent,
        promptLength: prompt.length,
      });
    } catch (error) {
      logger.warn('[ResponseCache] Failed to cache response', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
}
