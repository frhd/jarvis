import { eq, and, sql, gt, lt, desc } from 'drizzle-orm';
import { createHash } from 'crypto';
import { connection } from '../db/client.js';
import { semanticCache, embeddings } from '../db/schema.js';
import type { SemanticCacheEntry, NewSemanticCacheEntry } from '../types/index.js';
import { BaseRepository } from './base.repository.js';
import { db } from '../db/client.js';

export interface CacheLookupResult {
  entry: SemanticCacheEntry;
  similarity: number;
  matchType: 'exact' | 'semantic';
}

export interface CacheStats {
  totalEntries: number;
  totalHits: number;
  avgHitCount: number;
  expiredEntries: number;
  entriesByIntent: Record<string, number>;
  entriesByModel: Record<string, number>;
}

export class SemanticCacheRepository extends BaseRepository<
  SemanticCacheEntry,
  NewSemanticCacheEntry,
  typeof semanticCache
> {
  protected table = semanticCache;

  /**
   * Normalize prompt for consistent hashing
   */
  normalizePrompt(prompt: string): string {
    return prompt
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ') // Collapse whitespace
      .replace(/[^\w\s]/g, ''); // Remove punctuation
  }

  /**
   * Generate SHA-256 hash of normalized prompt
   */
  hashPrompt(prompt: string): string {
    const normalized = this.normalizePrompt(prompt);
    return createHash('sha256').update(normalized).digest('hex');
  }

  /**
   * Create a new cache entry with prompt hash calculation
   * Override base create to add custom promptHash field
   */
  async create(
    entry: Omit<NewSemanticCacheEntry, 'id' | 'promptHash'> & { promptText: string }
  ): Promise<SemanticCacheEntry> {
    const promptHash = this.hashPrompt(entry.promptText);
    const id = this.generateId();
    const now = new Date();

    const inserted = await db
      .insert(this.table)
      .values({
        id,
        promptHash,
        promptText: entry.promptText,
        response: entry.response,
        model: entry.model,
        intent: entry.intent,
        metadata: entry.metadata,
        hitCount: 1,
        lastAccessedAt: now,
        expiresAt: entry.expiresAt,
        sourceMessageIds: entry.sourceMessageIds,
        createdAt: now,
      })
      .returning();

    return inserted[0];
  }

  /**
   * Find entry by exact prompt hash match
   */
  async findByExactMatch(prompt: string): Promise<SemanticCacheEntry | null> {
    const promptHash = this.hashPrompt(prompt);
    const now = new Date();

    const result = await db
      .select()
      .from(this.table)
      .where(
        and(
          eq(this.table.promptHash, promptHash),
          // Not expired or no expiration set
          sql`(${this.table.expiresAt} IS NULL OR ${this.table.expiresAt} > ${Math.floor(now.getTime() / 1000)})`
        )
      )
      .limit(1);

    return result[0] || null;
  }

  // findById is inherited from BaseRepository

  /**
   * Semantic similarity search using embeddings
   * Looks up cache entries by finding similar embeddings
   */
  async findBySimilarity(
    queryEmbedding: number[],
    options: {
      minSimilarity?: number;
      limit?: number;
      intent?: string;
      model?: string;
    } = {}
  ): Promise<CacheLookupResult[]> {
    const { minSimilarity = 0.9, limit = 5, intent, model } = options;
    const now = Math.floor(Date.now() / 1000);

    // Use raw SQL for vector similarity with joins
    let query = `
      SELECT
        sc.id,
        sc.promptHash,
        sc.promptText,
        sc.response,
        sc.model,
        sc.intent,
        sc.metadata,
        sc.hitCount,
        sc.lastAccessedAt,
        sc.expiresAt,
        sc.sourceMessageIds,
        sc.createdAt,
        vec_distance_L2(json(e.embedding), json(?)) as distance
      FROM semanticCache sc
      INNER JOIN embeddings e ON e.sourceType = 'cache' AND e.sourceId = sc.id
      WHERE (sc.expiresAt IS NULL OR sc.expiresAt > ?)
    `;

    const params: (string | number | null)[] = [JSON.stringify(queryEmbedding), now];

    if (intent) {
      query += ` AND sc.intent = ?`;
      params.push(intent);
    }

    if (model) {
      query += ` AND sc.model = ?`;
      params.push(model);
    }

    query += ` ORDER BY distance ASC LIMIT ?`;
    params.push(limit);

    const stmt = connection.prepare(query);
    const results = stmt.all(...params) as Array<{
      id: string;
      promptHash: string;
      promptText: string;
      response: string;
      model: string;
      intent: string | null;
      metadata: string | null;
      hitCount: number;
      lastAccessedAt: number;
      expiresAt: number | null;
      sourceMessageIds: string | null;
      createdAt: number;
      distance: number;
    }>;

    return results
      .map((row) => {
        const similarity = 1 / (1 + row.distance);
        return {
          entry: {
            id: row.id,
            promptHash: row.promptHash,
            promptText: row.promptText,
            response: row.response,
            model: row.model,
            intent: row.intent,
            metadata: row.metadata,
            hitCount: row.hitCount,
            lastAccessedAt: new Date(row.lastAccessedAt * 1000),
            expiresAt: row.expiresAt ? new Date(row.expiresAt * 1000) : null,
            sourceMessageIds: row.sourceMessageIds,
            createdAt: new Date(row.createdAt * 1000),
          },
          similarity,
          matchType: 'semantic' as const,
        };
      })
      .filter((result) => result.similarity >= minSimilarity);
  }

  /**
   * Increment hit count and update last accessed time
   */
  async recordHit(id: string): Promise<void> {
    await db
      .update(this.table)
      .set({
        hitCount: sql`${this.table.hitCount} + 1`,
        lastAccessedAt: new Date(),
      })
      .where(eq(this.table.id, id));
  }

  /**
   * Delete expired entries
   */
  async deleteExpired(): Promise<number> {
    const now = new Date();

    // First get IDs of expired entries to delete their embeddings
    const expiredIds = await db
      .select({ id: this.table.id })
      .from(this.table)
      .where(lt(this.table.expiresAt, now));

    if (expiredIds.length === 0) {
      return 0;
    }

    // Delete embeddings for expired cache entries
    for (const { id } of expiredIds) {
      await db
        .delete(embeddings)
        .where(and(eq(embeddings.sourceType, 'cache'), eq(embeddings.sourceId, id)));
    }

    // Delete the cache entries
    const result = await db
      .delete(this.table)
      .where(lt(this.table.expiresAt, now))
      .returning();

    return result.length;
  }

  /**
   * Delete by ID (with associated embedding)
   * Override base delete to clean up embeddings
   */
  async delete(id: string): Promise<boolean> {
    // Delete embedding first
    await db
      .delete(embeddings)
      .where(and(eq(embeddings.sourceType, 'cache'), eq(embeddings.sourceId, id)));

    // Use base delete method
    return super.delete(id);
  }

  /**
   * Delete least recently used entries when cache is full
   */
  async deleteLRU(count: number): Promise<number> {
    // Get IDs of LRU entries
    const lruEntries = await db
      .select({ id: this.table.id })
      .from(this.table)
      .orderBy(this.table.lastAccessedAt)
      .limit(count);

    if (lruEntries.length === 0) {
      return 0;
    }

    let deleted = 0;
    for (const { id } of lruEntries) {
      if (await this.delete(id)) {
        deleted++;
      }
    }

    return deleted;
  }

  // count is inherited from BaseRepository

  /**
   * Get cache statistics
   */
  async getStats(): Promise<CacheStats> {
    const now = new Date();

    // Total entries and hits
    const totals = await db
      .select({
        totalEntries: sql<number>`count(*)`,
        totalHits: sql<number>`sum(${this.table.hitCount})`,
        avgHitCount: sql<number>`avg(${this.table.hitCount})`,
      })
      .from(this.table);

    // Expired entries
    const expired = await db
      .select({ count: sql<number>`count(*)` })
      .from(this.table)
      .where(
        and(
          sql`${this.table.expiresAt} IS NOT NULL`,
          lt(this.table.expiresAt, now)
        )
      );

    // Entries by intent
    const byIntent = await db
      .select({
        intent: this.table.intent,
        count: sql<number>`count(*)`,
      })
      .from(this.table)
      .groupBy(this.table.intent);

    // Entries by model
    const byModel = await db
      .select({
        model: this.table.model,
        count: sql<number>`count(*)`,
      })
      .from(this.table)
      .groupBy(this.table.model);

    return {
      totalEntries: totals[0]?.totalEntries || 0,
      totalHits: totals[0]?.totalHits || 0,
      avgHitCount: totals[0]?.avgHitCount || 0,
      expiredEntries: expired[0]?.count || 0,
      entriesByIntent: Object.fromEntries(
        byIntent.map((row) => [row.intent || 'unknown', row.count])
      ),
      entriesByModel: Object.fromEntries(
        byModel.map((row) => [row.model, row.count])
      ),
    };
  }

  /**
   * Find entries by intent
   */
  async findByIntent(intent: string, limit = 100): Promise<SemanticCacheEntry[]> {
    return db
      .select()
      .from(this.table)
      .where(eq(this.table.intent, intent))
      .orderBy(desc(this.table.lastAccessedAt))
      .limit(limit);
  }

  /**
   * Invalidate all entries for a specific intent
   */
  async invalidateByIntent(intent: string): Promise<number> {
    // Get IDs first for embedding cleanup
    const entries = await db
      .select({ id: this.table.id })
      .from(this.table)
      .where(eq(this.table.intent, intent));

    if (entries.length === 0) {
      return 0;
    }

    // Delete embeddings
    for (const { id } of entries) {
      await db
        .delete(embeddings)
        .where(and(eq(embeddings.sourceType, 'cache'), eq(embeddings.sourceId, id)));
    }

    // Delete cache entries
    const result = await db
      .delete(this.table)
      .where(eq(this.table.intent, intent))
      .returning();

    return result.length;
  }

  /**
   * Clear all cache entries
   */
  async clear(): Promise<number> {
    // Delete all cache embeddings
    await db
      .delete(embeddings)
      .where(eq(embeddings.sourceType, 'cache'));

    // Delete all cache entries
    const result = await db
      .delete(this.table)
      .returning();

    return result.length;
  }

  /**
   * Delete entries where intent is not in the provided list of cacheable intents.
   * Useful for cleaning up stale entries after intents are removed from cacheableIntents config.
   */
  async deleteByNonCacheableIntents(cacheableIntents: string[]): Promise<number> {
    if (cacheableIntents.length === 0) {
      // If no intents are cacheable, delete all entries with an intent
      const entriesToDelete = await db
        .select({ id: this.table.id })
        .from(this.table)
        .where(sql`${this.table.intent} IS NOT NULL`);

      if (entriesToDelete.length === 0) {
        return 0;
      }

      // Delete embeddings for these entries
      for (const { id } of entriesToDelete) {
        await db
          .delete(embeddings)
          .where(and(eq(embeddings.sourceType, 'cache'), eq(embeddings.sourceId, id)));
      }

      // Delete the cache entries
      const result = await db
        .delete(this.table)
        .where(sql`${this.table.intent} IS NOT NULL`)
        .returning();

      return result.length;
    }

    // Build list of placeholders for SQL IN clause
    const placeholders = cacheableIntents.map(() => '?').join(', ');

    // Find entries where intent is NOT NULL and NOT IN cacheable list
    const query = `
      SELECT id FROM semanticCache
      WHERE intent IS NOT NULL
      AND intent NOT IN (${placeholders})
    `;

    const stmt = connection.prepare(query);
    const entriesToDelete = stmt.all(...cacheableIntents) as Array<{ id: string }>;

    if (entriesToDelete.length === 0) {
      return 0;
    }

    // Delete embeddings for these entries
    for (const { id } of entriesToDelete) {
      await db
        .delete(embeddings)
        .where(and(eq(embeddings.sourceType, 'cache'), eq(embeddings.sourceId, id)));
    }

    // Delete the cache entries
    let deleted = 0;
    for (const { id } of entriesToDelete) {
      const result = await db
        .delete(this.table)
        .where(eq(this.table.id, id))
        .returning();
      deleted += result.length;
    }

    return deleted;
  }

  /**
   * Delete entries where response contains a specific pattern
   * Useful for clearing low-quality cached responses
   */
  async deleteByResponsePattern(pattern: string): Promise<number> {
    // Get entries matching the pattern
    const matchingEntries = await db
      .select({ id: this.table.id })
      .from(this.table)
      .where(sql`${this.table.response} LIKE ${'%' + pattern + '%'}`);

    if (matchingEntries.length === 0) {
      return 0;
    }

    // Delete embeddings for matching entries
    for (const { id } of matchingEntries) {
      await db
        .delete(embeddings)
        .where(and(eq(embeddings.sourceType, 'cache'), eq(embeddings.sourceId, id)));
    }

    // Delete the cache entries
    const result = await db
      .delete(this.table)
      .where(sql`${this.table.response} LIKE ${'%' + pattern + '%'}`)
      .returning();

    return result.length;
  }

  /**
   * Get hit counts grouped by intent for detailed metrics
   */
  async getHitsByIntent(): Promise<Record<string, { hits: number }>> {
    const results = await db
      .select({
        intent: this.table.intent,
        hits: sql<number>`sum(${this.table.hitCount})`,
      })
      .from(this.table)
      .groupBy(this.table.intent);

    return Object.fromEntries(
      results.map((row) => [row.intent || 'unknown', { hits: row.hits || 0 }])
    );
  }

  /**
   * Get cache entry age metrics (oldest and newest entries)
   */
  async getEntryAgeMetrics(): Promise<{ oldestAgeHours: number; newestAgeHours: number }> {
    const now = new Date();

    const oldest = await db
      .select({ createdAt: this.table.createdAt })
      .from(this.table)
      .orderBy(this.table.createdAt)
      .limit(1);

    const newest = await db
      .select({ createdAt: this.table.createdAt })
      .from(this.table)
      .orderBy(desc(this.table.createdAt))
      .limit(1);

    const oldestAgeHours = oldest[0]?.createdAt
      ? (now.getTime() - new Date(oldest[0].createdAt).getTime()) / (1000 * 60 * 60)
      : 0;

    const newestAgeHours = newest[0]?.createdAt
      ? (now.getTime() - new Date(newest[0].createdAt).getTime()) / (1000 * 60 * 60)
      : 0;

    return {
      oldestAgeHours: Math.round(oldestAgeHours * 10) / 10,  // Round to 1 decimal
      newestAgeHours: Math.round(newestAgeHours * 10) / 10,
    };
  }
}

export const semanticCacheRepository = new SemanticCacheRepository();
