/**
 * Message Deduplication Service
 *
 * Prevents redundant processing of duplicate messages within a time window.
 * Uses content hashing to identify identical messages regardless of when they arrive.
 */

import crypto from 'crypto';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('DeduplicationService');

// Configuration
const DEDUP_WINDOW_MS = 60_000; // 60 seconds
const CACHE_MAX_SIZE = 1000;

// Cache entry
interface CacheEntry {
  hash: string;
  timestamp: number;
  senderId: string;
  chatId: string;
}

export interface DeduplicationConfig {
  windowMs: number;
  enabled: boolean;
  notifyOnDuplicate: boolean;
  notifyMessage: string;
}

const DEFAULT_CONFIG: DeduplicationConfig = {
  windowMs: DEDUP_WINDOW_MS,
  enabled: true,
  notifyOnDuplicate: false,
  notifyMessage: "I heard you the first time! 😄",
};

/**
 * Message Deduplication Service
 *
 * Identifies duplicate messages by:
 * 1. Normalizing text (case, whitespace)
 * 2. Computing SHA-256 hash
 * 3. Checking cache within time window
 *
 * This prevents redundant LLM calls when users accidentally
 * send the same message multiple times in quick succession.
 */
export class DeduplicationService {
  private config: DeduplicationConfig;
  private cache: Map<string, CacheEntry>;
  private stats = {
    total: 0,
    duplicates: 0,
    hits: 0,
    misses: 0,
  };

  constructor(config?: Partial<DeduplicationConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.cache = new Map();

    // Start cache cleanup interval
    setInterval(() => this.cleanupCache(), 30_000); // Every 30 seconds

    logger.info('[Deduplication] Service initialized', {
      windowMs: this.config.windowMs,
      enabled: this.config.enabled,
    });
  }

  /**
   * Check if a message is a duplicate
   * Returns true if message should be skipped
   */
  isDuplicate(params: {
    text?: string | null;
    senderId: string;
    chatId: string;
    mediaType?: string | null;
  }): { isDuplicate: boolean; notify?: string } {
    if (!this.config.enabled) {
      return { isDuplicate: false };
    }

    this.stats.total++;

    // Skip deduplication for non-text messages (voice, media, etc.)
    if (!params.text || params.text.trim().length === 0) {
      return { isDuplicate: false };
    }

    // Skip deduplication for voice messages (media messages)
    if (params.mediaType === 'voice') {
      logger.debug('[Deduplication] Skipping voice message', { senderId: params.senderId });
      return { isDuplicate: false };
    }

    // Normalize and hash the text
    const normalized = this.normalizeText(params.text);
    const hash = this.computeHash(normalized, params.senderId, params.chatId);

    // Check cache
    const now = Date.now();
    const cached = this.cache.get(hash);

    if (cached) {
      // Check if within time window
      if (now - cached.timestamp < this.config.windowMs) {
        this.stats.duplicates++;
        this.stats.hits++;

        logger.info('[Deduplication] Duplicate message detected', {
          senderId: params.senderId,
          chatId: params.chatId,
          textPreview: normalized.substring(0, 50),
          ageMs: now - cached.timestamp,
          windowMs: this.config.windowMs,
        });

        // Return notification message if configured
        const notify = this.config.notifyOnDuplicate
          ? this.config.notifyMessage
          : undefined;

        return { isDuplicate: true, notify };
      }

      // Outside window, treat as new message
      this.cache.delete(hash);
    }

    this.stats.misses++;

    // Add to cache
    this.cache.set(hash, {
      hash,
      timestamp: now,
      senderId: params.senderId,
      chatId: params.chatId,
    });

    // Enforce max cache size
    if (this.cache.size > CACHE_MAX_SIZE) {
      this.evictOldestEntries(Math.floor(CACHE_MAX_SIZE * 0.1));
    }

    return { isDuplicate: false };
  }

  /**
   * Normalize text for consistent hashing
   * - Trim whitespace
   * - Convert to lowercase
   * - Remove extra spaces
   * - Remove common punctuation variations
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
   * Includes text, sender, and chat to prevent cross-chat false positives
   */
  private computeHash(text: string, senderId: string, chatId: string): string {
    const key = `${senderId}:${chatId}:${text}`;
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
      logger.debug('[Deduplication] Cache cleanup', {
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

    logger.debug('[Deduplication] Evicted old entries', {
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
    logger.info('[Deduplication] Cache cleared');
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<DeduplicationConfig>): void {
    this.config = { ...this.config, ...updates };
    logger.info('[Deduplication] Configuration updated', { config: this.config });
  }
}
