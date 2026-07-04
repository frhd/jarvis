import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { circuitBreakerStates } from '../db/schema';
import { CircuitBreakerStateRecord, NewCircuitBreakerStateRecord, CircuitState } from '../types';
import { BaseRepository } from './base.repository.js';

export class CircuitBreakerRepository extends BaseRepository<
  CircuitBreakerStateRecord,
  NewCircuitBreakerStateRecord,
  typeof circuitBreakerStates
> {
  protected table = circuitBreakerStates;

  async findByServiceName(serviceName: string): Promise<CircuitBreakerStateRecord | null> {
    return this.findOneWhere(eq(this.table.serviceName, serviceName));
  }

  /**
   * Create a new circuit breaker state
   * Override base create to use custom data structure
   */
  async create(data: {
    serviceName: string;
    state?: CircuitState;
  }): Promise<CircuitBreakerStateRecord> {
    const id = this.generateId();
    const now = new Date();
    const inserted = await db
      .insert(this.table)
      .values({
        id,
        serviceName: data.serviceName,
        state: data.state ?? 'CLOSED',
        failureCount: 0,
        successCount: 0,
        lastFailureAt: null,
        lastSuccessAt: null,
        lastStateChangeAt: now,
        nextAttemptAt: null,
        halfOpenAttempts: 0,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    return inserted[0];
  }

  /**
   * Update circuit breaker state by service name
   */
  async update(
    serviceName: string,
    data: Partial<{
      state: CircuitState;
      failureCount: number;
      successCount: number;
      lastFailureAt: Date | null;
      lastSuccessAt: Date | null;
      lastStateChangeAt: Date;
      nextAttemptAt: Date | null;
      halfOpenAttempts: number;
    }>
  ): Promise<CircuitBreakerStateRecord | null> {
    const updated = await db
      .update(this.table)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(this.table.serviceName, serviceName))
      .returning();

    return updated[0] || null;
  }

  async upsert(data: {
    serviceName: string;
    state: CircuitState;
    failureCount: number;
    successCount: number;
    lastFailureAt: Date | null;
    lastSuccessAt: Date | null;
    lastStateChangeAt: Date;
    nextAttemptAt: Date | null;
    halfOpenAttempts: number;
  }): Promise<CircuitBreakerStateRecord> {
    const existing = await this.findByServiceName(data.serviceName);

    if (existing) {
      const updated = await this.update(data.serviceName, data);
      return updated!;
    } else {
      return await this.create(data);
    }
  }

  async reset(serviceName: string): Promise<CircuitBreakerStateRecord | null> {
    const now = new Date();
    return await this.update(serviceName, {
      state: 'CLOSED',
      failureCount: 0,
      successCount: 0,
      lastStateChangeAt: now,
      nextAttemptAt: null,
      halfOpenAttempts: 0,
    });
  }

  /**
   * Delete circuit breaker state by service name
   */
  async deleteByServiceName(serviceName: string): Promise<void> {
    await db
      .delete(this.table)
      .where(eq(this.table.serviceName, serviceName));
  }

  /**
   * Find all circuit breaker states
   */
  async findAll(): Promise<CircuitBreakerStateRecord[]> {
    return this.findMany({ limit: 1000 });
  }
}
