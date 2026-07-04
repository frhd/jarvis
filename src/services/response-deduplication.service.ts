/**
 * Response Deduplication Service
 *
 * Prevents Jarvis from sending duplicate responses to users.
 * Tracks recently sent responses and blocks duplicates within a time window.
 */

import crypto from 'crypto';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('ResponseDeduplicationService');

// Configuration
const DEDUP_WINDOW_MS = 300_000; // 5 minutes
const CACHE_MAX_SIZE = 500;

// Cache entry
interface CacheEntry {
  hash: string;
  timestamp: number;
  chatId: string;
}

export interface ResponseDeduplicationConfig {
  windowMs: number;
  enabled: boolean;
}

const DEFAULT_CONFIG: ResponseDeduplicationConfig = {
  windowMs: DEDUP_WINDOW_MS,
  enabled: true,
};

/**
 * Response Deduplication Service
 *
 * Identifies duplicate responses by:
 * 1. Normalizing response text (case, whitespace)
 * 2. Computing SHA-256 hash including chatId
 * 3. Checking cache within time window
 *
 * This prevents duplicate responses when:
 * - Messages are reprocessed by the retry worker
 * - Race conditions cause multiple processing attempts
 * - System crashes and recovers stuck messages
 */
export class ResponseDeduplicationService {
  private config: ResponseDeduplicationConfig;
  private cache: Map<string, CacheEntry>;
  private stats = {
    total: 0,
    duplicates: 0,
    hits: 0,
    misses: 0,
  };

  constructor(config?: Partial<ResponseDeduplicationConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.cache = new Map();

    // Start cache cleanup interval
    setInterval(() => this.cleanupCache(), 60_000); // Every 60 seconds

    logger.info('[ResponseDeduplication] Service initialized', {
      windowMs: this.config.windowMs,
      enabled: this.config.enabled,
    });
  }

  /**
   * Check if a response is a duplicate
   * Returns true if response should be skipped
   */
  isDuplicate(params: {
    text: string;
    chatId: string | number;
  }): boolean {
    if (!this.config.enabled) {
      return false;
    }

    this.stats.total++;

    // Normalize and hash the text
    const normalized = this.normalizeText(params.text);
    const hash = this.computeHash(normalized, params.chatId.toString());

    // Check cache
    const now = Date.now();
    const cached = this.cache.get(hash);

    if (cached) {
      // Check if within time window
      if (now - cached.timestamp < this.config.windowMs) {
        this.stats.duplicates++;
        this.stats.hits++;

        logger.info('[ResponseDeduplication] Duplicate response detected', {
          chatId: params.chatId,
          textPreview: normalized.substring(0, 50),
          ageMs: now - cached.timestamp,
          windowMs: this.config.windowMs,
        });

        return true;
      }

      // Outside window, treat as new message
      this.cache.delete(hash);
    }

    this.stats.misses++;

    // Add to cache
    this.cache.set(hash, {
      hash,
      timestamp: now,
      chatId: params.chatId.toString(),
    });

    // Enforce max cache size
    if (this.cache.size > CACHE_MAX_SIZE) {
      this.evictOldestEntries(Math.floor(CACHE_MAX_SIZE * 0.1));
    }

    return false;
  }

  /**
   * Normalize text for consistent hashing
   * - Trim whitespace
   * - Convert to lowercase
   * - Remove extra spaces
   * Remove common punctuation variations
   */
  private normalizeText(text: string): string {
    return text
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ') // Multiple spaces -> single space
      .replace(/[.,!?;:'"()]/g, '') // Remove punctuation
      .trim();
  }

  /**
   * Compute hash for deduplication key
   * Includes text and chatId to prevent cross-chat false positives
   */
  private computeHash(text: string, chatId: string): string {
    const key = `${chatId}:${text}`;
    return crypto.createHash('sha256').update(key).digest('hex');
  }

  /**
   * Clean up expired entries from cache
   */
  private cleanupCache(): void {
    const now = Date.now();
    let removed = 0;

    for (const [hash, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.config.windowMs * 2) {
        this.cache.delete(hash);
        removed++;
      }
    }

    if (removed > 0) {
      logger.debug('[ResponseDeduplication] Cache cleanup', {
        removed,
        remaining: this.cache.size,
      });
    }
  }

  /**
   * Evict oldest entries when cache is full
   */
  private evictOldestEntries(count: number): void {
    const entries = Array.from(this.cache.entries())
      .sort((a, b) => a[1].timestamp - b[1].timestamp);

    for (let i = 0; i < Math.min(count, entries.length); i++) {
      this.cache.delete(entries[i][0]);
    }

    logger.debug('[ResponseDeduplication] Evicted old entries', {
        evicted: count,
        remaining: this.cache.size,
      });
  }

  /**
   * Get deduplication statistics
   */
  getStats() {
    const duplicateRate = this.stats.total > 0
      ? (this.stats.duplicates / this.stats.total) * 100
      : 0;

    return {
      ...this.stats,
      duplicateRate: Math.round(duplicateRate * 10) / 10,
      cacheSize: this.cache.size,
    };
  }

  /**
   * Clear all cached entries
   */
  clear(): void {
    this.cache.clear();
    logger.info('[ResponseDeduplication] Cache cleared');
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<ResponseDeduplicationConfig>): void {
    this.config = { ...this.config, ...updates };
    logger.info('[ResponseDeduplication] Configuration updated', { config: this.config });
  }
}
