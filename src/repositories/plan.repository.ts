/**
 * Plan Repository - Data access for plan workflow system
 */

import { eq, and, desc, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { plans, planExecutions, planFeedback } from '../db/schema.js';
import { BaseRepository } from './base.repository.js';
import type {
  Plan,
  NewPlan,
  PlanExecution,
  NewPlanExecution,
  PlanFeedbackRecord,
  NewPlanFeedbackRecord,
} from '../types/index.js';
import type { PlanState, ExecutionStatus } from '../db/schema.js';

// Re-export types for convenience
export type { Plan, NewPlan, PlanExecution, NewPlanExecution, PlanFeedbackRecord, NewPlanFeedbackRecord };

/**
 * Repository interface for Plan operations
 */
export interface IPlanRepository {
  create(data: Omit<NewPlan, 'id'>): Promise<Plan>;
  findById(id: string): Promise<Plan | null>;
  update(id: string, data: Partial<NewPlan>): Promise<Plan | null>;
  delete(id: string): Promise<boolean>;
  findByChatId(chatId: string, limit?: number): Promise<Plan[]>;
  findByCreatedBy(senderId: string, limit?: number): Promise<Plan[]>;
  findByState(state: PlanState): Promise<Plan[]>;
  findActivePlan(chatId?: string): Promise<Plan | null>;
  transitionState(id: string, newState: PlanState): Promise<Plan | null>;
  incrementVersion(id: string): Promise<Plan | null>;
  markApproved(id: string): Promise<Plan | null>;
  markCompleted(id: string): Promise<Plan | null>;
  markFailed(id: string): Promise<Plan | null>;
}

/**
 * Repository for Plan CRUD operations
 */
export class PlanRepository extends BaseRepository<Plan, NewPlan, typeof plans> implements IPlanRepository {
  protected table = plans;

  /**
   * Find plans for a specific chat
   */
  async findByChatId(chatId: string, limit: number = 20): Promise<Plan[]> {
    return await db
      .select()
      .from(plans)
      .where(eq(plans.chatId, chatId))
      .orderBy(desc(plans.createdAt))
      .limit(limit);
  }

  /**
   * Find plans created by a specific sender
   */
  async findByCreatedBy(senderId: string, limit: number = 20): Promise<Plan[]> {
    return await db
      .select()
      .from(plans)
      .where(eq(plans.createdBy, senderId))
      .orderBy(desc(plans.createdAt))
      .limit(limit);
  }

  /**
   * Find all plans in a specific state
   */
  async findByState(state: PlanState): Promise<Plan[]> {
    return await db
      .select()
      .from(plans)
      .where(eq(plans.state, state))
      .orderBy(desc(plans.createdAt));
  }

  /**
   * Find the current active plan (not idle, completed, or failed)
   * Optionally scoped to a specific chat
   */
  async findActivePlan(chatId?: string): Promise<Plan | null> {
    const activeStates: PlanState[] = ['proposing', 'feedback', 'approved', 'executing'];

    const conditions = [
      sql`${plans.state} IN (${sql.join(activeStates.map(s => sql`${s}`), sql`, `)})`
    ];

    if (chatId) {
      conditions.push(eq(plans.chatId, chatId));
    }

    const result = await db
      .select()
      .from(plans)
      .where(and(...conditions))
      .orderBy(desc(plans.updatedAt))
      .limit(1);

    return result[0] ?? null;
  }

  /**
   * Transition plan to a new state
   */
  async transitionState(id: string, newState: PlanState): Promise<Plan | null> {
    const now = new Date();
    const updates: Partial<NewPlan> = {
      state: newState,
      updatedAt: now,
    };

    // Set timestamps for terminal states
    if (newState === 'approved') {
      updates.approvedAt = now;
    } else if (newState === 'completed' || newState === 'failed') {
      updates.completedAt = now;
    }

    return this.update(id, updates);
  }

  /**
   * Increment plan version (for feedback iterations)
   */
  async incrementVersion(id: string): Promise<Plan | null> {
    const result = await db
      .update(plans)
      .set({
        version: sql`${plans.version} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(plans.id, id))
      .returning();

    return result[0] ?? null;
  }

  /**
   * Mark plan as approved
   */
  async markApproved(id: string): Promise<Plan | null> {
    return this.transitionState(id, 'approved');
  }

  /**
   * Mark plan as completed
   */
  async markCompleted(id: string): Promise<Plan | null> {
    return this.transitionState(id, 'completed');
  }

  /**
   * Mark plan as failed
   */
  async markFailed(id: string): Promise<Plan | null> {
    return this.transitionState(id, 'failed');
  }
}

/**
 * Repository for Plan Execution operations
 */
export class PlanExecutionRepository extends BaseRepository<PlanExecution, NewPlanExecution, typeof planExecutions> {
  protected table = planExecutions;

  /**
   * Find executions for a specific plan
   */
  async findByPlanId(planId: string): Promise<PlanExecution[]> {
    return await db
      .select()
      .from(planExecutions)
      .where(eq(planExecutions.planId, planId))
      .orderBy(desc(planExecutions.startedAt));
  }

  /**
   * Find execution by session ID
   */
  async findBySessionId(sessionId: string): Promise<PlanExecution | null> {
    const result = await db
      .select()
      .from(planExecutions)
      .where(eq(planExecutions.sessionId, sessionId))
      .limit(1);

    return result[0] ?? null;
  }

  /**
   * Find the latest execution for a plan
   */
  async findLatestByPlanId(planId: string): Promise<PlanExecution | null> {
    const result = await db
      .select()
      .from(planExecutions)
      .where(eq(planExecutions.planId, planId))
      .orderBy(desc(planExecutions.startedAt))
      .limit(1);

    return result[0] ?? null;
  }

  /**
   * Find currently running executions
   */
  async findRunning(): Promise<PlanExecution[]> {
    return await db
      .select()
      .from(planExecutions)
      .where(eq(planExecutions.status, 'running'))
      .orderBy(desc(planExecutions.startedAt));
  }

  /**
   * Update execution progress
   * Uses inherited update() which handles updatedAt automatically
   */
  async updateProgress(
    id: string,
    progress: {
      currentIteration?: number;
      totalIterations?: number;
      totalTokensIn?: number;
      totalTokensOut?: number;
      totalCost?: number;
      progressReport?: string;
    }
  ): Promise<PlanExecution | null> {
    return this.update(id, progress as Partial<NewPlanExecution>);
  }

  /**
   * Mark execution as completed
   * Uses inherited update() which handles updatedAt automatically
   */
  async markCompleted(id: string, finalProgress?: {
    totalIterations?: number;
    totalTokensIn?: number;
    totalTokensOut?: number;
    totalCost?: number;
    progressReport?: string;
  }): Promise<PlanExecution | null> {
    return this.update(id, {
      status: 'completed',
      completedAt: new Date(),
      ...finalProgress,
    } as Partial<NewPlanExecution>);
  }

  /**
   * Mark execution as failed
   * Uses inherited update() which handles updatedAt automatically
   */
  async markFailed(id: string, errorReport?: string): Promise<PlanExecution | null> {
    return this.update(id, {
      status: 'failed',
      completedAt: new Date(),
      progressReport: errorReport,
    } as Partial<NewPlanExecution>);
  }

  /**
   * Mark execution as cancelled
   * Uses inherited update() which handles updatedAt automatically
   */
  async markCancelled(id: string): Promise<PlanExecution | null> {
    return this.update(id, {
      status: 'cancelled',
      completedAt: new Date(),
    } as Partial<NewPlanExecution>);
  }
}

/**
 * Repository for Plan Feedback operations
 */
export class PlanFeedbackRepository extends BaseRepository<PlanFeedbackRecord, NewPlanFeedbackRecord, typeof planFeedback> {
  protected table = planFeedback;

  /**
   * Find all feedback for a specific plan
   */
  async findByPlanId(planId: string): Promise<PlanFeedbackRecord[]> {
    return await db
      .select()
      .from(planFeedback)
      .where(eq(planFeedback.planId, planId))
      .orderBy(desc(planFeedback.createdAt));
  }

  /**
   * Find feedback for a specific plan version
   */
  async findByPlanVersion(planId: string, version: number): Promise<PlanFeedbackRecord[]> {
    return await db
      .select()
      .from(planFeedback)
      .where(
        and(
          eq(planFeedback.planId, planId),
          eq(planFeedback.version, version)
        )
      )
      .orderBy(desc(planFeedback.createdAt));
  }

  /**
   * Get the latest feedback for a plan
   */
  async getLatestFeedback(planId: string): Promise<PlanFeedbackRecord | null> {
    const result = await db
      .select()
      .from(planFeedback)
      .where(eq(planFeedback.planId, planId))
      .orderBy(desc(planFeedback.createdAt))
      .limit(1);

    return result[0] ?? null;
  }

  /**
   * Count feedback entries for a plan
   */
  async countByPlanId(planId: string): Promise<number> {
    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(planFeedback)
      .where(eq(planFeedback.planId, planId));

    return result[0]?.count ?? 0;
  }
}

// Export singleton instances
export const planRepository = new PlanRepository();
export const planExecutionRepository = new PlanExecutionRepository();
export const planFeedbackRepository = new PlanFeedbackRepository();
