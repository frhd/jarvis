/**
 * Base repository providing common CRUD operations
 */

import { desc, eq, sql, type SQL } from 'drizzle-orm';
import type { SQLiteTableWithColumns, SQLiteTransaction } from 'drizzle-orm/sqlite-core';
import { nanoid } from 'nanoid';
import { db } from '../db/client.js';
import type { IRepository } from '../interfaces/repositories.js';
import type { RunResult } from 'better-sqlite3';
import type { ExtractTablesWithRelations } from 'drizzle-orm';
import * as schema from '../db/schema.js';

/**
 * Transaction type for Drizzle ORM
 */
export type Transaction = SQLiteTransaction<'sync', RunResult, typeof schema, ExtractTablesWithRelations<typeof schema>>;

/**
 * Transaction function type for withTransaction helper
 */
export type TransactionFn<R> = (tx: Transaction) => Promise<R>;

/**
 * Abstract base repository implementing common CRUD operations.
 *
 * @typeParam T - The select type for the entity
 * @typeParam Insert - The insert type for the entity
 * @typeParam Table - The Drizzle table schema type
 *
 * @example
 * ```typescript
 * class UserRepository extends BaseRepository<User, NewUser, typeof users> {
 *   protected table = users;
 *
 *   async findByEmail(email: string) {
 *     return this.findOneWhere(eq(this.table.email, email));
 *   }
 * }
 * ```
 */
/**
 * Table configuration type constraint - uses conditional typing to accept any SQLite table.
 * This approach provides type safety while remaining compatible with Drizzle's table types.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTableConfig = any;

export abstract class BaseRepository<
  T,
  Insert,
  Table extends SQLiteTableWithColumns<AnyTableConfig>
> implements IRepository<T, Insert> {
  /**
   * The Drizzle table schema - must be set by subclass
   */
  protected abstract table: Table;

  /**
   * Create a new entity with auto-generated ID and timestamps.
   */
  async create(data: Omit<Insert, 'id'>): Promise<T> {
    const id = nanoid();
    const now = new Date();

    const inserted = await db
      .insert(this.table)
      .values({
        id,
        ...data,
        createdAt: now,
        updatedAt: now,
      } as Table['$inferInsert'])
      .returning();

    return inserted[0] as T;
  }

  /**
   * Find an entity by its ID.
   */
  async findById(id: string): Promise<T | null> {
    const result = await db
      .select()
      .from(this.table)
      .where(eq(this.table.id, id))
      .limit(1);

    return (result[0] as T) ?? null;
  }

  /**
   * Update an entity by ID with partial data.
   */
  async update(id: string, data: Partial<Insert>): Promise<T | null> {
    const updated = await db
      .update(this.table)
      .set({
        ...data,
        updatedAt: new Date(),
      } as Record<string, unknown>)
      .where(eq(this.table.id, id))
      .returning();

    return (updated[0] as T) ?? null;
  }

  /**
   * Delete an entity by ID.
   * @returns true if a row was deleted, false otherwise
   */
  async delete(id: string): Promise<boolean> {
    const result = await db
      .delete(this.table)
      .where(eq(this.table.id, id));

    return result.changes > 0;
  }

  // -------------------------------------------------------------------------
  // Protected helper methods for subclasses
  // -------------------------------------------------------------------------

  /**
   * Find a single entity matching a condition.
   */
  protected async findOneWhere(condition: SQL): Promise<T | null> {
    const result = await db
      .select()
      .from(this.table)
      .where(condition)
      .limit(1);

    return (result[0] as T) ?? null;
  }

  /**
   * Find multiple entities matching a condition.
   */
  protected async findManyWhere(
    condition: SQL,
    limit?: number
  ): Promise<T[]> {
    let query = db.select().from(this.table).where(condition);

    if (limit !== undefined) {
      query = query.limit(limit) as typeof query;
    }

    const result = await query;
    return result as T[];
  }

  /**
   * Count entities matching an optional condition.
   */
  protected async countWhere(condition?: SQL): Promise<number> {
    const query = db
      .select({ count: sql<number>`count(*)` })
      .from(this.table);

    if (condition) {
      query.where(condition);
    }

    const result = await query;
    return result[0]?.count ?? 0;
  }

  /**
   * Generate a new nanoid.
   */
  protected generateId(): string {
    return nanoid();
  }

  /**
   * Execute operations within a transaction.
   * @param fn - Function to execute within transaction context
   * @returns The result of the transaction function
   */
  async withTransaction<R>(fn: TransactionFn<R>): Promise<R> {
    return db.transaction(fn);
  }

  /**
   * Check if an entity exists by ID.
   */
  async exists(id: string): Promise<boolean> {
    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(this.table)
      .where(eq(this.table.id, id));
    return result[0].count > 0;
  }

  /**
   * Update with automatic timestamp handling.
   * This is a convenience method that wraps update() with better type inference.
   * Use this for simple updates where you just need to update fields and get the result.
   *
   * @param id - Entity ID to update
   * @param data - Partial data to update (excluding id, createdAt, updatedAt)
   * @returns Updated entity or null if not found
   */
  async updateWithTimestamp(
    id: string,
    data: Partial<Omit<T, 'id' | 'createdAt' | 'updatedAt'>>
  ): Promise<T | null> {
    return this.update(id, data as Partial<Insert>);
  }

  /**
   * Count all entities in the table.
   */
  async count(): Promise<number> {
    return this.countWhere();
  }

  /**
   * Find many entities with pagination options.
   */
  async findMany(options?: {
    limit?: number;
    offset?: number;
    orderBy?: 'asc' | 'desc';
  }): Promise<T[]> {
    const { limit = 100, offset = 0, orderBy = 'desc' } = options ?? {};

    let query = db
      .select()
      .from(this.table)
      .limit(limit)
      .offset(offset);

    // Order by createdAt if the column exists
    if ('createdAt' in this.table) {
      query = query.orderBy(
        orderBy === 'desc'
          ? desc(this.table.createdAt as ReturnType<typeof sql>)
          : (this.table.createdAt as ReturnType<typeof sql>)
      ) as typeof query;
    }

    const result = await query;
    return result as T[];
  }
}
