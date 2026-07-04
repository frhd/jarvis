/**
 * Plan Management Service
 *
 * Handles plan creation, updates, state transitions, and lifecycle management
 * for the plan-execute workflow system.
 */

import { logger } from '../utils/logger.js';
import { AppError } from '../errors/error-classes.js';
import { ErrorCode } from '../errors/error-codes.js';
import {
  planRepository,
  planExecutionRepository,
  planFeedbackRepository,
} from '../repositories/index.js';
import type {
  Plan,
  NewPlan,
  PlanExecution,
  NewPlanExecution,
  PlanFeedbackRecord,
} from '../types/index.js';
import type {
  CreatePlanInput,
  UpdatePlanInput,
  PlanMetadata,
  PlanWithFeedback,
  PlanFeedbackEntry,
} from '../types/plan.types.js';
import { isValidTransition } from '../types/plan.types.js';
import type { PlanState } from '../db/schema.js';

// ============================================================================
// Result Types
// ============================================================================

export interface PlanResult {
  plan: Plan | null;
  success: boolean;
  message?: string;
}

export interface PlanWithFeedbackResult {
  plan: PlanWithFeedback | null;
  success: boolean;
  message?: string;
}

export interface StateTransitionResult {
  plan: Plan | null;
  success: boolean;
  previousState?: PlanState;
  newState?: PlanState;
  message?: string;
}

// ============================================================================
// Plan Management Service
// ============================================================================

export class PlanManagementService {
  /**
   * Create a new plan
   */
  async createPlan(input: CreatePlanInput): Promise<PlanResult> {
    try {
      // Check if there's already an active plan for this chat
      if (input.chatId) {
        const activePlan = await planRepository.findActivePlan(input.chatId);
        if (activePlan) {
          logger.warn('[PlanManagement] Active plan already exists', {
            chatId: input.chatId,
            existingPlanId: activePlan.id,
          });
          return {
            plan: null,
            success: false,
            message: `An active plan already exists (${activePlan.title}). Complete or cancel it first.`,
          };
        }
      }

      const planData: Omit<NewPlan, 'id'> = {
        title: input.title,
        content: input.content,
        state: 'proposing',
        createdBy: input.createdBy ?? null,
        chatId: input.chatId ?? null,
        metadata: JSON.stringify(input.metadata ?? {}),
        version: 1,
      };

      const plan = await planRepository.create(planData);

      logger.info('[PlanManagement] Plan created', {
        planId: plan.id,
        title: plan.title,
        chatId: plan.chatId,
        createdBy: plan.createdBy,
      });

      // Transition to feedback state after creation
      const updatedPlan = await planRepository.transitionState(plan.id, 'feedback');

      return {
        plan: updatedPlan ?? plan,
        success: true,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('[PlanManagement] Plan creation failed', { error: errorMessage });
      throw new AppError(
        `Failed to create plan: ${errorMessage}`,
        ErrorCode.INTERNAL_UNEXPECTED,
        {
          isOperational: true,
          cause: error instanceof Error ? error : undefined,
          context: { title: input.title },
        }
      );
    }
  }

  /**
   * Get a plan by ID
   */
  async getPlan(planId: string): Promise<Plan | null> {
    return planRepository.findById(planId);
  }

  /**
   * Get a plan with its feedback history
   */
  async getPlanWithFeedback(planId: string): Promise<PlanWithFeedbackResult> {
    try {
      const plan = await planRepository.findById(planId);
      if (!plan) {
        return { plan: null, success: false, message: 'Plan not found' };
      }

      const feedbackRecords = await planFeedbackRepository.findByPlanId(planId);
      const feedbackHistory: PlanFeedbackEntry[] = feedbackRecords.map((fb) => ({
        id: fb.id,
        senderId: fb.senderId,
        feedback: fb.feedback,
        version: fb.version,
        createdAt: fb.createdAt,
      }));

      const planWithFeedback: PlanWithFeedback = {
        id: plan.id,
        title: plan.title,
        content: plan.content,
        state: plan.state,
        version: plan.version,
        createdBy: plan.createdBy,
        chatId: plan.chatId,
        metadata: this.parseMetadata(plan.metadata),
        createdAt: plan.createdAt,
        updatedAt: plan.updatedAt,
        approvedAt: plan.approvedAt,
        completedAt: plan.completedAt,
        feedbackHistory,
      };

      return { plan: planWithFeedback, success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('[PlanManagement] Failed to get plan with feedback', { error: errorMessage, planId });
      return { plan: null, success: false, message: errorMessage };
    }
  }

  /**
   * Get the current active plan for a chat
   */
  async getActivePlan(chatId?: string): Promise<Plan | null> {
    return planRepository.findActivePlan(chatId);
  }

  /**
   * Update plan content
   */
  async updatePlanContent(planId: string, input: UpdatePlanInput): Promise<PlanResult> {
    try {
      const plan = await planRepository.findById(planId);
      if (!plan) {
        return { plan: null, success: false, message: 'Plan not found' };
      }

      // Only allow content updates in certain states
      const editableStates: PlanState[] = ['proposing', 'feedback'];
      if (!editableStates.includes(plan.state)) {
        return {
          plan: null,
          success: false,
          message: `Cannot update plan in ${plan.state} state`,
        };
      }

      const updates: Partial<NewPlan> = {};
      if (input.title) updates.title = input.title;
      if (input.content) updates.content = input.content;
      if (input.metadata) {
        const currentMetadata = this.parseMetadata(plan.metadata);
        updates.metadata = JSON.stringify({ ...currentMetadata, ...input.metadata });
      }

      const updatedPlan = await planRepository.update(planId, updates);

      logger.info('[PlanManagement] Plan updated', {
        planId,
        title: input.title ?? plan.title,
      });

      return { plan: updatedPlan, success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('[PlanManagement] Plan update failed', { error: errorMessage, planId });
      return { plan: null, success: false, message: errorMessage };
    }
  }

  /**
   * Add feedback to a plan and increment version
   */
  async addFeedback(planId: string, senderId: string, feedback: string): Promise<PlanResult> {
    try {
      const plan = await planRepository.findById(planId);
      if (!plan) {
        return { plan: null, success: false, message: 'Plan not found' };
      }

      // Only accept feedback in feedback state
      if (plan.state !== 'feedback') {
        return {
          plan: null,
          success: false,
          message: `Cannot add feedback when plan is in ${plan.state} state`,
        };
      }

      // Store the feedback
      await planFeedbackRepository.create({
        planId,
        senderId,
        feedback,
        version: plan.version,
      });

      // Increment the plan version
      const updatedPlan = await planRepository.incrementVersion(planId);

      logger.info('[PlanManagement] Feedback added', {
        planId,
        senderId,
        version: plan.version,
        newVersion: updatedPlan?.version,
      });

      return { plan: updatedPlan, success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('[PlanManagement] Failed to add feedback', { error: errorMessage, planId });
      return { plan: null, success: false, message: errorMessage };
    }
  }

  /**
   * Transition plan to a new state
   */
  async transitionState(planId: string, newState: PlanState): Promise<StateTransitionResult> {
    try {
      const plan = await planRepository.findById(planId);
      if (!plan) {
        return { plan: null, success: false, message: 'Plan not found' };
      }

      const previousState = plan.state;

      // Validate state transition
      if (!isValidTransition(previousState, newState)) {
        logger.warn('[PlanManagement] Invalid state transition', {
          planId,
          from: previousState,
          to: newState,
        });
        return {
          plan: null,
          success: false,
          previousState,
          message: `Invalid transition from ${previousState} to ${newState}`,
        };
      }

      const updatedPlan = await planRepository.transitionState(planId, newState);

      logger.info('[PlanManagement] State transitioned', {
        planId,
        from: previousState,
        to: newState,
      });

      return {
        plan: updatedPlan,
        success: true,
        previousState,
        newState,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('[PlanManagement] State transition failed', { error: errorMessage, planId });
      return { plan: null, success: false, message: errorMessage };
    }
  }

  /**
   * Approve a plan (transition to approved state)
   */
  async approvePlan(planId: string): Promise<StateTransitionResult> {
    return this.transitionState(planId, 'approved');
  }

  /**
   * Mark plan as executing
   */
  async startExecution(planId: string): Promise<StateTransitionResult> {
    return this.transitionState(planId, 'executing');
  }

  /**
   * Mark plan as completed
   */
  async completePlan(planId: string): Promise<StateTransitionResult> {
    return this.transitionState(planId, 'completed');
  }

  /**
   * Mark plan as failed
   */
  async failPlan(planId: string, reason?: string): Promise<StateTransitionResult> {
    const result = await this.transitionState(planId, 'failed');

    if (result.success && reason) {
      // Store the failure reason in metadata
      const plan = await planRepository.findById(planId);
      if (plan) {
        const metadata = this.parseMetadata(plan.metadata);
        metadata.failureReason = reason;
        await planRepository.update(planId, {
          metadata: JSON.stringify(metadata),
        });
      }
    }

    return result;
  }

  /**
   * Cancel a plan (transition to idle/failed)
   */
  async cancelPlan(planId: string): Promise<StateTransitionResult> {
    const plan = await planRepository.findById(planId);
    if (!plan) {
      return { plan: null, success: false, message: 'Plan not found' };
    }

    // If executing, we need to handle ongoing execution
    if (plan.state === 'executing') {
      // Mark any running executions as cancelled
      const executions = await planExecutionRepository.findByPlanId(planId);
      for (const exec of executions) {
        if (exec.status === 'running') {
          await planExecutionRepository.markCancelled(exec.id);
        }
      }
    }

    return this.transitionState(planId, 'failed');
  }

  /**
   * Get all plans for a chat
   */
  async getPlansByChatId(chatId: string, limit?: number): Promise<Plan[]> {
    return planRepository.findByChatId(chatId, limit);
  }

  /**
   * Get all plans by creator
   */
  async getPlansByCreator(senderId: string, limit?: number): Promise<Plan[]> {
    return planRepository.findByCreatedBy(senderId, limit);
  }

  /**
   * Get plans by state
   */
  async getPlansByState(state: PlanState): Promise<Plan[]> {
    return planRepository.findByState(state);
  }

  /**
   * Delete a plan and all related data
   */
  async deletePlan(planId: string): Promise<boolean> {
    try {
      const plan = await planRepository.findById(planId);
      if (!plan) {
        return false;
      }

      // Only allow deletion of idle, completed, or failed plans
      const deletableStates: PlanState[] = ['idle', 'completed', 'failed'];
      if (!deletableStates.includes(plan.state)) {
        logger.warn('[PlanManagement] Cannot delete plan in active state', {
          planId,
          state: plan.state,
        });
        return false;
      }

      // Feedback and executions will be cascade deleted due to foreign key constraints
      const deleted = await planRepository.delete(planId);

      if (deleted) {
        logger.info('[PlanManagement] Plan deleted', { planId });
      }

      return deleted;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('[PlanManagement] Plan deletion failed', { error: errorMessage, planId });
      return false;
    }
  }

  /**
   * Get current plan execution
   */
  async getCurrentExecution(planId: string): Promise<PlanExecution | null> {
    return planExecutionRepository.findLatestByPlanId(planId);
  }

  /**
   * Get all executions for a plan
   */
  async getPlanExecutions(planId: string): Promise<PlanExecution[]> {
    return planExecutionRepository.findByPlanId(planId);
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  /**
   * Parse metadata JSON string
   */
  private parseMetadata(metadataStr: string | null): PlanMetadata {
    if (!metadataStr) return {};
    try {
      return JSON.parse(metadataStr) as PlanMetadata;
    } catch {
      return {};
    }
  }
}

// Export singleton instance
export const planManagementService = new PlanManagementService();
