import { eq, and, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db, connection } from '../db/client.js';
import { embeddings } from '../db/schema.js';
import { logger } from '../utils/logger.js';
import { getErrorMessage } from '../utils/error-utils.js';

export type Embedding = typeof embeddings.$inferSelect;
export type NewEmbedding = typeof embeddings.$inferInsert;

export interface SimilarityResult {
  id: string;
  sourceType: string;
  sourceId: string;
  content: string;
  distance: number;
  similarity: number; // 1 / (1 + distance)
}

export class EmbeddingRepository {
  /**
   * Validate that an embedding string is well-formed JSON containing a numeric array.
   */
  private isValidEmbeddingJson(embeddingJson: string): boolean {
    if (!embeddingJson || embeddingJson[0] !== '[' || embeddingJson[embeddingJson.length - 1] !== ']') {
      return false;
    }
    try {
      const parsed = JSON.parse(embeddingJson);
      if (!Array.isArray(parsed) || parsed.length === 0) return false;
      return parsed.every((v: unknown) => typeof v === 'number' && isFinite(v as number));
    } catch {
      return false;
    }
  }

  /**
   * Store a new embedding
   */
  async create(embedding: Omit<NewEmbedding, 'id'>): Promise<Embedding> {
    // Validate embedding JSON before storage to prevent corruption
    if (!this.isValidEmbeddingJson(embedding.embedding)) {
      throw new Error(`Invalid embedding data: not a valid JSON numeric array (sourceType=${embedding.sourceType}, sourceId=${embedding.sourceId})`);
    }

    const inserted = await db
      .insert(embeddings)
      .values({
        id: nanoid(),
        sourceType: embedding.sourceType,
        sourceId: embedding.sourceId,
        content: embedding.content,
        embedding: embedding.embedding,
        model: embedding.model,
        dimensions: embedding.dimensions ?? 768,
        createdAt: new Date(),
      })
      .returning();

    return inserted[0];
  }

  /**
   * Find embedding by source
   */
  async findBySource(
    sourceType: 'message' | 'memory' | 'preference',
    sourceId: string
  ): Promise<Embedding | null> {
    const result = await db
      .select()
      .from(embeddings)
      .where(
        and(
          eq(embeddings.sourceType, sourceType),
          eq(embeddings.sourceId, sourceId)
        )
      )
      .limit(1);

    return result[0] || null;
  }

  /**
   * Delete embedding by source (when source is deleted)
   */
  async deleteBySource(
    sourceType: 'message' | 'memory' | 'preference',
    sourceId: string
  ): Promise<boolean> {
    const result = await db
      .delete(embeddings)
      .where(
        and(
          eq(embeddings.sourceType, sourceType),
          eq(embeddings.sourceId, sourceId)
        )
      )
      .returning();

    return result.length > 0;
  }

  /**
   * Find all embeddings by source type
   */
  async findBySourceType(
    sourceType: 'message' | 'memory' | 'preference',
    limit: number = 5000
  ): Promise<Embedding[]> {
    return await db
      .select()
      .from(embeddings)
      .where(eq(embeddings.sourceType, sourceType))
      .limit(limit);
  }

  /**
   * Vector similarity search using sqlite-vec
   * This uses raw SQL because sqlite-vec is accessed via virtual table
   */
  async findSimilar(
    queryEmbedding: number[],
    options: {
      limit?: number;
      sourceType?: 'message' | 'memory' | 'preference';
      minSimilarity?: number;
    } = {}
  ): Promise<SimilarityResult[]> {
    const { limit = 10, sourceType, minSimilarity = 0 } = options;

    // sqlite-vec provides vec_distance_L2 function
    // The embedding is stored as JSON text, so parse it for comparison
    const stmt = connection.prepare(`
      SELECT
        e.id,
        e.sourceType,
        e.sourceId,
        e.content,
        vec_distance_L2(json(e.embedding), json(?)) as distance
      FROM embeddings e
      WHERE (? IS NULL OR e.sourceType = ?)
      ORDER BY distance ASC
      LIMIT ?
    `);

    type SimilarRow = {
      id: string;
      sourceType: string;
      sourceId: string;
      content: string;
      distance: number;
    };

    const stmtArgs = [JSON.stringify(queryEmbedding), sourceType ?? null, sourceType ?? null, limit] as const;
    let results: SimilarRow[];

    try {
      results = stmt.all(...stmtArgs) as SimilarRow[];
    } catch (error) {
      const errorMsg = getErrorMessage(error);
      if (errorMsg.includes('JSON parsing error') || errorMsg.includes('vector')) {
        logger.warn('[EmbeddingRepository] sqlite-vec JSON parsing error detected, cleaning up malformed rows', {
          error: errorMsg,
        });
        await this.cleanupMalformedEmbeddings();
        try {
          results = stmt.all(...stmtArgs) as SimilarRow[];
        } catch (retryError) {
          logger.error('[EmbeddingRepository] findSimilar failed even after cleanup', {
            error: getErrorMessage(retryError),
          });
          return [];
        }
      } else {
        throw error;
      }
    }

    // Calculate similarity and filter by minSimilarity
    return results
      .map((row) => ({
        id: row.id,
        sourceType: row.sourceType,
        sourceId: row.sourceId,
        content: row.content,
        distance: row.distance,
        similarity: 1 / (1 + row.distance),
      }))
      .filter((result) => result.similarity >= minSimilarity);
  }

  /**
   * Batch insert embeddings
   */
  async createBatch(embeddingsList: Omit<NewEmbedding, 'id'>[]): Promise<void> {
    if (embeddingsList.length === 0) {
      return;
    }

    // Filter out invalid embeddings before batch insert
    const validEmbeddings = embeddingsList.filter((embedding) => {
      if (!this.isValidEmbeddingJson(embedding.embedding)) {
        logger.warn('[EmbeddingRepository] Skipping invalid embedding in batch', {
          sourceType: embedding.sourceType,
          sourceId: embedding.sourceId,
        });
        return false;
      }
      return true;
    });

    if (validEmbeddings.length === 0) {
      return;
    }

    const values = validEmbeddings.map((embedding) => ({
      id: nanoid(),
      sourceType: embedding.sourceType,
      sourceId: embedding.sourceId,
      content: embedding.content,
      embedding: embedding.embedding,
      model: embedding.model,
      dimensions: embedding.dimensions ?? 768,
      createdAt: new Date(),
    }));

    await db.insert(embeddings).values(values);
  }

  /**
   * Get total count of embeddings
   */
  async getCount(): Promise<number> {
    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(embeddings);
    return result[0]?.count ?? 0;
  }

  /**
   * Delete old embeddings (for memory leak prevention)
   * Deletes embeddings older than specified days
   * @param olderThanDays - Delete embeddings older than this many days
   * @param sourceTypeFilter - Optional filter by source type
   * @returns Number of embeddings deleted
   */
  async deleteOlderThan(
    olderThanDays: number,
    sourceTypeFilter?: 'message' | 'memory' | 'preference'
  ): Promise<number> {
    const cutoffTimestamp = Math.floor(new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).getTime() / 1000);

    // Use raw SQL for date comparison with optional source type filter
    const conditions = [sql`${embeddings.createdAt} < ${cutoffTimestamp}`];
    if (sourceTypeFilter) {
      conditions.push(sql`${embeddings.sourceType} = ${sourceTypeFilter}`);
    }

    const whereClause = conditions.length === 1
      ? conditions[0]
      : sql`${conditions[0]} AND ${conditions[1]}`;

    const result = await db
      .delete(embeddings)
      .where(whereClause)
      .returning();

    return result.length;
  }

  /**
   * Delete embeddings for orphaned sources (source that no longer exists)
   * This prevents accumulation of stale embeddings
   * @param validSourceIds - Set of valid source IDs
   * @param sourceType - Source type to check
   * @returns Number of orphaned embeddings deleted
   */
  async deleteOrphaned(
    validSourceIds: Set<string>,
    sourceType: 'message' | 'memory' | 'preference'
  ): Promise<number> {
    if (validSourceIds.size === 0) {
      return 0;
    }

    // Build NOT IN clause with placeholders
    const placeholders = Array(validSourceIds.size).fill('?').join(',');

    // Use raw SQL for NOT IN clause
    const whereClause = sourceType
      ? sql`${embeddings.sourceType} = ${sourceType} AND ${sql.raw(`sourceId NOT IN (${placeholders})`)}`
      : sql.raw(`sourceId NOT IN (${placeholders})`);

    const stmt = connection.prepare(
      sourceType
        ? `DELETE FROM embeddings WHERE sourceType = ? AND sourceId NOT IN (${placeholders})`
        : `DELETE FROM embeddings WHERE sourceId NOT IN (${placeholders})`
    );
    const result = stmt.run(sourceType ? [sourceType, ...validSourceIds] : [...validSourceIds]);
    return result.changes;
  }

  /**
   * Get statistics about embeddings for monitoring
   */
  async getStats(): Promise<{
    total: number;
    byType: Record<string, number>;
    oldestAgeDays: number | null;
  }> {
    const total = await this.getCount();

    // Get count by type
    const byTypeResult = await db
      .select({ sourceType: embeddings.sourceType, count: sql<number>`count(*)` })
      .from(embeddings)
      .groupBy(embeddings.sourceType);

    const byType: Record<string, number> = {};
    for (const row of byTypeResult) {
      byType[row.sourceType] = row.count;
    }

    // Get oldest embedding
    const oldestResult = await db
      .select({ createdAt: embeddings.createdAt })
      .from(embeddings)
      .orderBy(embeddings.createdAt)
      .limit(1);

    let oldestAgeDays: number | null = null;
    if (oldestResult.length > 0) {
      const ageMs = Date.now() - new Date(oldestResult[0].createdAt).getTime();
      oldestAgeDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));
    }

    return { total, byType, oldestAgeDays };
  }

  // Promise-based mutex to prevent concurrent cleanup runs
  private cleanupPromise: Promise<number> | null = null;

  /**
   * Find malformed embedding rows using SQL-level validation.
   * Avoids loading embedding data into Node.js memory.
   */
  private findMalformedIds(): string[] {
    // json_valid() catches broken/truncated JSON; json_type() catches valid JSON that isn't an array
    const rows = connection.prepare(`
      SELECT id FROM embeddings
      WHERE json_valid(embedding) = 0
         OR json_type(embedding) != 'array'
         OR json_array_length(embedding) = 0
    `).all() as Array<{ id: string }>;

    return rows.map(r => r.id);
  }

  /**
   * Remove malformed embedding rows that cause sqlite-vec JSON parsing errors.
   * Uses a promise mutex to prevent concurrent cleanup runs.
   * @returns Number of rows deleted
   */
  async cleanupMalformedEmbeddings(): Promise<number> {
    if (this.cleanupPromise) {
      return this.cleanupPromise;
    }
    this.cleanupPromise = this.performCleanup();
    try {
      return await this.cleanupPromise;
    } finally {
      this.cleanupPromise = null;
    }
  }

  private async performCleanup(): Promise<number> {
    const malformedIds = this.findMalformedIds();

    if (malformedIds.length === 0) {
      return 0;
    }

    logger.warn('[EmbeddingRepository] Found malformed embedding rows', {
      count: malformedIds.length,
      sampleIds: malformedIds.slice(0, 5),
    });

    const DELETE_BATCH_SIZE = 500;
    let totalDeleted = 0;
    for (let i = 0; i < malformedIds.length; i += DELETE_BATCH_SIZE) {
      const batch = malformedIds.slice(i, i + DELETE_BATCH_SIZE);
      const placeholders = batch.map(() => '?').join(',');
      const result = connection.prepare(
        `DELETE FROM embeddings WHERE id IN (${placeholders})`
      ).run(...batch);
      totalDeleted += result.changes;
    }

    logger.info('[EmbeddingRepository] Cleaned up malformed embeddings', {
      deleted: totalDeleted,
    });

    return totalDeleted;
  }
}

export const embeddingRepository = new EmbeddingRepository();
