import { appConfig } from '../config/index.js';
import { EmbeddingClient } from '../clients/embedding.client.js';
import {
  SemanticCacheRepository,
  CacheLookupResult,
} from '../repositories/semanticCache.repository.js';
import { EmbeddingRepository } from '../repositories/embedding.repository.js';
import type { SemanticCacheEntry } from '../types/index.js';
import type { ISemanticCache, CacheLookupOptions, CacheStoreOptions, CacheResult, CacheStats, CacheDetailedStats } from '../interfaces/index.js';
import { createLogger } from '../utils/logger.js';

// Re-export types for backward compatibility
export type { CacheLookupOptions, CacheStoreOptions, CacheResult, CacheStats, CacheDetailedStats };

const logger = createLogger('SemanticCache');

export class SemanticCacheService implements ISemanticCache {
  private enabled: boolean;

  // Track recent miss reasons for dashboard
  private missReasonCounts = {
    notCacheableIntent: 0,
    noMatch: 0,
    belowSimilarityThreshold: 0,
    firstMessage: 0,
    personalInfo: 0,
    expired: 0,
  };

  constructor(
    private embeddingClient: EmbeddingClient,
    private cacheRepo: SemanticCacheRepository,
    private embeddingRepo: EmbeddingRepository
  ) {
    this.enabled = appConfig.cache.enabled;
  }

  /**
   * Record a cache miss reason for metrics tracking
   */
  recordMissReason(reason: keyof typeof this.missReasonCounts): void {
    this.missReasonCounts[reason]++;
  }

  /**
   * Reset miss reason counters (useful for periodic metrics collection)
   */
  resetMissReasons(): void {
    this.missReasonCounts = {
      notCacheableIntent: 0,
      noMatch: 0,
      belowSimilarityThreshold: 0,
      firstMessage: 0,
      personalInfo: 0,
      expired: 0,
    };
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  isCacheable(intent: string): boolean {
    return appConfig.cache.cacheableIntents.includes(intent);
  }

  getTTLForIntent(intent: string): number {
    const { ttl } = appConfig.cache;

    switch (intent) {
      case 'simple_greeting':
      case 'time_greeting':
      case 'farewell':
      case 'gratitude':
        return ttl.simpleGreeting;
      case 'factual_question':
        return ttl.factualQuestion;
      case 'personal_question':
        return ttl.personalQuestion;
      default:
        return ttl.default;
    }
  }

  async lookup(prompt: string, options: CacheLookupOptions = {}): Promise<CacheResult> {
    const startTime = Date.now();

    if (!this.enabled) {
      return {
        hit: false,
        lookupTimeMs: Date.now() - startTime,
      };
    }

    const { useSemanticSearch = true, minSimilarity = appConfig.cache.similarityThreshold } = options;

    try {
      // First try exact match (faster)
      const exactMatch = await this.cacheRepo.findByExactMatch(prompt);

      if (exactMatch) {
        // Verify intent is still cacheable (prevents serving stale non-cacheable entries)
        if (exactMatch.intent && !this.isCacheable(exactMatch.intent)) {
          // Skip this match - intent is no longer cacheable
          // Fall through to semantic search or return miss
        } else {
          await this.cacheRepo.recordHit(exactMatch.id);

          return {
            hit: true,
            response: exactMatch.response,
            entry: exactMatch,
            similarity: 1.0,
            matchType: 'exact',
            lookupTimeMs: Date.now() - startTime,
          };
        }
      }

      if (useSemanticSearch) {
        const embeddingResult = await this.embeddingClient.embed(prompt);

        if (embeddingResult) {
          const similarResults = await this.cacheRepo.findBySimilarity(
            embeddingResult.embedding,
            {
              minSimilarity,
              limit: 1,
              intent: options.intent,
              model: options.model,
            }
          );

          if (similarResults.length > 0) {
            const topMatch = similarResults[0];
            await this.cacheRepo.recordHit(topMatch.entry.id);

            return {
              hit: true,
              response: topMatch.entry.response,
              entry: topMatch.entry,
              similarity: topMatch.similarity,
              matchType: 'semantic',
              lookupTimeMs: Date.now() - startTime,
            };
          }
        }
      }

      return {
        hit: false,
        lookupTimeMs: Date.now() - startTime,
      };
    } catch (error) {
      logger.error('Lookup error', error);
      return {
        hit: false,
        lookupTimeMs: Date.now() - startTime,
      };
    }
  }

  async store(prompt: string, response: string, options: CacheStoreOptions = {}): Promise<SemanticCacheEntry | null> {
    if (!this.enabled) {
      return null;
    }

    const { intent, model = 'unknown', sourceMessageIds, metadata } = options;

    if (intent && !this.isCacheable(intent)) {
      return null;
    }

    try {
      const currentCount = await this.cacheRepo.count();
      if (currentCount >= appConfig.cache.maxEntries) {
        // Evict 10% of max entries
        const evictCount = Math.ceil(appConfig.cache.maxEntries * 0.1);
        await this.cacheRepo.deleteLRU(evictCount);
      }

      const ttlHours = options.ttlHours ?? this.getTTLForIntent(intent || '');
      const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

      const entry = await this.cacheRepo.create({
        promptText: prompt,
        response,
        model,
        intent,
        metadata: metadata ? JSON.stringify(metadata) : null,
        expiresAt,
        sourceMessageIds: sourceMessageIds ? JSON.stringify(sourceMessageIds) : null,
      });

      const embeddingResult = await this.embeddingClient.embed(prompt);

      if (embeddingResult) {
        await this.embeddingRepo.create({
          sourceType: 'cache',
          sourceId: entry.id,
          content: prompt,
          embedding: JSON.stringify(embeddingResult.embedding),
          model: embeddingResult.model,
          dimensions: embeddingResult.embedding.length,
        });
      }

      return entry;
    } catch (error) {
      logger.error('Store error', error);
      return null;
    }
  }

  async invalidateByIntent(intent: string): Promise<number> {
    if (!this.enabled) {
      return 0;
    }

    try {
      return await this.cacheRepo.invalidateByIntent(intent);
    } catch (error) {
      logger.error('Invalidate error', error);
      return 0;
    }
  }

  async cleanup(): Promise<number> {
    if (!this.enabled) {
      return 0;
    }

    try {
      return await this.cacheRepo.deleteExpired();
    } catch (error) {
      logger.error('Cleanup error', error);
      return 0;
    }
  }

  async getStats(): Promise<CacheStats> {
    const stats = await this.cacheRepo.getStats();

    const hitRate = stats.totalEntries > 0
      ? (stats.totalHits - stats.totalEntries) / stats.totalHits
      : 0;

    return {
      ...stats,
      hitRate: Math.max(0, hitRate), // Ensure non-negative
    };
  }

  /**
   * Get detailed cache statistics for dashboard/monitoring.
   * Includes hit rates by intent, miss reasons, and health indicators.
   */
  async getDetailedStats(): Promise<CacheDetailedStats> {
    const baseStats = await this.getStats();

    // Calculate hit rate by intent
    const hitRateByIntent: Record<string, { hits: number; entries: number; rate: number }> = {};
    const intentHits = await this.cacheRepo.getHitsByIntent();

    for (const [intent, data] of Object.entries(intentHits)) {
      const entries = baseStats.entriesByIntent[intent] || 0;
      hitRateByIntent[intent] = {
        hits: data.hits,
        entries,
        rate: entries > 0 ? data.hits / entries : 0,
      };
    }

    // Get age metrics
    const ageMetrics = await this.cacheRepo.getEntryAgeMetrics();

    // Count warm cache entries (model = 'cache-warmed')
    const warmCacheEntries = baseStats.entriesByModel['cache-warmed'] || 0;

    // Calculate utilization rate
    const maxEntries = appConfig.cache.maxEntries;
    const utilizationRate = maxEntries > 0 ? baseStats.totalEntries / maxEntries : 0;

    // Calculate average entries per intent
    const intentCount = Object.keys(baseStats.entriesByIntent).length;
    const avgEntriesPerIntent = intentCount > 0 ? baseStats.totalEntries / intentCount : 0;

    return {
      ...baseStats,
      hitRateByIntent,
      recentMissReasons: { ...this.missReasonCounts },
      health: {
        utilizationRate,
        avgEntriesPerIntent,
        oldestEntryAge: ageMetrics.oldestAgeHours,
        newestEntryAge: ageMetrics.newestAgeHours,
        warmCacheEntries,
      },
      config: {
        enabled: this.enabled,
        similarityThreshold: appConfig.cache.similarityThreshold,
        maxEntries,
        cacheableIntents: appConfig.cache.cacheableIntents,
      },
    };
  }

  async clear(): Promise<number> {
    if (!this.enabled) {
      return 0;
    }

    try {
      return await this.cacheRepo.clear();
    } catch (error) {
      logger.error('Clear error', error);
      return 0;
    }
  }

  /**
   * Purge cache entries with intents that are no longer cacheable.
   * Call this after removing intents from cacheableIntents config to clean up stale entries.
   */
  async purgeNonCacheableIntents(): Promise<number> {
    if (!this.enabled) {
      return 0;
    }

    try {
      const cacheableIntents = appConfig.cache.cacheableIntents;
      const purged = await this.cacheRepo.deleteByNonCacheableIntents(cacheableIntents);

      if (purged > 0) {
        logger.info(`Purged ${purged} entries with non-cacheable intents`);
      }

      return purged;
    } catch (error) {
      logger.error('Purge error', error);
      return 0;
    }
  }

  /**
   * Pre-defined common responses for cache warming.
   * These are generic, context-free responses suitable for caching.
   */
  private static readonly COMMON_CACHE_ENTRIES = [
    // Simple greetings
    { prompt: 'hi', response: 'Hello! How can I help you today?', intent: 'simple_greeting' },
    { prompt: 'hello', response: 'Hi there! What can I do for you?', intent: 'simple_greeting' },
    { prompt: 'hey', response: 'Hey! How can I assist you?', intent: 'simple_greeting' },
    { prompt: 'hi there', response: 'Hello! Nice to hear from you. How can I help?', intent: 'simple_greeting' },
    { prompt: 'hello there', response: 'Hi! What can I help you with today?', intent: 'simple_greeting' },

    // Time-based greetings
    { prompt: 'good morning', response: 'Good morning! Hope you have a great day. How can I help?', intent: 'time_greeting' },
    { prompt: 'good afternoon', response: 'Good afternoon! How can I assist you today?', intent: 'time_greeting' },
    { prompt: 'good evening', response: 'Good evening! What can I do for you?', intent: 'time_greeting' },
    { prompt: 'good night', response: 'Good night! Take care and rest well.', intent: 'time_greeting' },

    // Farewells
    { prompt: 'bye', response: 'Goodbye! Take care!', intent: 'farewell' },
    { prompt: 'goodbye', response: 'Goodbye! Feel free to reach out anytime.', intent: 'farewell' },
    { prompt: 'see you', response: 'See you later! Take care!', intent: 'farewell' },
    { prompt: 'talk later', response: 'Sure thing! Talk to you later!', intent: 'farewell' },

    // Gratitude
    { prompt: 'thanks', response: "You're welcome!", intent: 'gratitude' },
    { prompt: 'thank you', response: "You're welcome! Happy to help.", intent: 'gratitude' },
    { prompt: 'thanks a lot', response: "You're very welcome! Glad I could help.", intent: 'gratitude' },

    // Acknowledgments
    { prompt: 'ok', response: 'Alright! Let me know if you need anything else.', intent: 'acknowledgment' },
    { prompt: 'got it', response: 'Great! Feel free to ask if you have more questions.', intent: 'acknowledgment' },
    { prompt: 'understood', response: 'Perfect! I\'m here if you need anything else.', intent: 'acknowledgment' },

    // Positive feedback
    { prompt: 'great', response: "Glad you're happy with it! Anything else I can help with?", intent: 'positive_feedback' },
    { prompt: 'perfect', response: "Wonderful! Let me know if there's anything else.", intent: 'positive_feedback' },
    { prompt: 'awesome', response: "Great to hear! I'm here if you need more help.", intent: 'positive_feedback' },
  ];

  /**
   * Warm the cache with common greeting and response patterns.
   * Call this during startup to pre-populate frequently used responses.
   * @param model - The model name to associate with cached responses (default: 'cache-warmed')
   * @returns Number of entries successfully cached
   */
  async warmCacheWithDefaults(model: string = 'cache-warmed'): Promise<number> {
    if (!this.enabled) {
      return 0;
    }

    const entries = SemanticCacheService.COMMON_CACHE_ENTRIES.map(entry => ({
      ...entry,
      model,
    }));

    const stored = await this.warmCache(entries);
    logger.info(`Warmed cache with ${stored}/${entries.length} default entries`);
    return stored;
  }

  /**
   * Warm the cache with common responses
   * This can be called during startup or periodically
   */
  async warmCache(entries: Array<{ prompt: string; response: string; intent: string; model: string }>): Promise<number> {
    if (!this.enabled) {
      return 0;
    }

    let stored = 0;

    for (const entry of entries) {
      const result = await this.store(entry.prompt, entry.response, {
        intent: entry.intent,
        model: entry.model,
      });

      if (result) {
        stored++;
      }
    }

    return stored;
  }
}

// Export factory function (actual instantiation in services/index.ts)
export function createSemanticCacheService(
  embeddingClient: EmbeddingClient,
  cacheRepo: SemanticCacheRepository,
  embeddingRepo: EmbeddingRepository
): SemanticCacheService {
  return new SemanticCacheService(embeddingClient, cacheRepo, embeddingRepo);
}
