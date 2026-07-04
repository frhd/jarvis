/**
 * Intent Cache Service
 * LRU cache with TTL for intent classification results.
 */

import { createHash } from 'crypto';
import { logger } from '../../utils/logger.js';

/** Default cache configuration values */
export const DEFAULT_CACHE_MAX_SIZE = 500;
export const DEFAULT_CACHE_TTL_MS = 300_000; // 5 minutes in milliseconds

/** Cache entry for intent classification results */
interface CacheEntry<T> {
  result: T;
  timestamp: number;
}

/**
 * Configuration options for IntentCacheService.
 */
export interface IntentCacheConfig {
  /** Whether caching is enabled */
  enabled: boolean;
  /** Maximum number of cached results */
  maxSize: number;
  /** TTL for cached results in milliseconds */
  ttlMs: number;
}

/**
 * LRU cache with TTL for intent classification results.
 * Provides deduplication and faster responses for repeated queries.
 */
export class IntentCacheService<T> {
  private cache = new Map<string, CacheEntry<T>>();
  private order: string[] = []; // For LRU eviction
  private hits = 0;
  private misses = 0;

  constructor(private readonly config: IntentCacheConfig) {}

  /**
   * Get the number of entries in the cache.
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Get cache hit/miss statistics.
   */
  getStats(): { hits: number; misses: number; hitRate: number; size: number } {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
      size: this.cache.size,
    };
  }

  /**
   * Generate a cache key for a message.
   * Uses SHA-256 hash of normalized message text.
   */
  getKey(message: string): string {
    return createHash('sha256')
      .update(message.trim().toLowerCase())
      .digest('hex')
      .substring(0, 16);
  }

  /**
   * Get cached result if available and not expired.
   * Updates LRU order on hit.
   */
  get(message: string): T | null {
    if (!this.config.enabled) {
      return null;
    }

    const key = this.getKey(message);
    const entry = this.cache.get(key);

    if (!entry) {
      this.misses++;
      return null;
    }

    // Check TTL
    if (Date.now() - entry.timestamp > this.config.ttlMs) {
      this.cache.delete(key);
      this.order = this.order.filter(k => k !== key);
      this.misses++;
      return null;
    }

    // Move to end for LRU
    this.order = this.order.filter(k => k !== key);
    this.order.push(key);
    this.hits++;
    logger.debug('Intent classification cache hit', { key });
    return entry.result;
  }

  /**
   * Cache a result if caching is enabled.
   * Evicts oldest entries when at capacity.
   */
  set(message: string, result: T): void {
    if (!this.config.enabled) {
      return;
    }

    const key = this.getKey(message);

    // Evict oldest if at capacity
    while (this.order.length >= this.config.maxSize) {
      const oldest = this.order.shift();
      if (oldest) {
        this.cache.delete(oldest);
      }
    }

    this.cache.set(key, { result, timestamp: Date.now() });
    this.order.push(key);
  }

  /**
   * Check if a message has a valid cached result.
   */
  has(message: string): boolean {
    return this.get(message) !== null;
  }

  /**
   * Remove a specific entry from the cache.
   */
  delete(message: string): boolean {
    const key = this.getKey(message);
    const existed = this.cache.delete(key);
    if (existed) {
      this.order = this.order.filter(k => k !== key);
    }
    return existed;
  }

  /**
   * Clear all cached entries.
   */
  clear(): void {
    this.cache.clear();
    this.order = [];
  }

  /**
   * Remove expired entries from the cache.
   * @returns Number of entries removed
   */
  prune(): number {
    const now = Date.now();
    let removed = 0;

    for (const [key, entry] of Array.from(this.cache.entries())) {
      if (now - entry.timestamp > this.config.ttlMs) {
        this.cache.delete(key);
        this.order = this.order.filter(k => k !== key);
        removed++;
      }
    }

    return removed;
  }
}
