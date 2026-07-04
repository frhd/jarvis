/**
 * Plan Intent Handler Service
 *
 * Handles plan-related intents by coordinating between PlanManagementService,
 * ExecutionCoordinatorService, and Claude for plan content generation.
 *
 * Intent routing:
 * - plan_propose: Create a new plan using Claude to generate content
 * - plan_feedback: Apply feedback to active plan using Claude
 * - plan_approve: Approve the current plan
 * - plan_execute: Start execution via loop.sh
 * - plan_status: Get execution progress
 * - plan_cancel: Cancel current plan/execution
 * - plan_list: List user's plans
 */

import { logger } from '../utils/logger.js';
import { planManagementService } from './planManagement.service.js';
import { executionCoordinatorService } from './executionCoordinator.service.js';
import { progressReporterService } from './progressReporter.service.js';
import type { ClaudeClient } from '../clients/claude.client.js';
import type { TelegramService } from './telegram.service.js';
import type { Message, Chat, Sender, Plan } from '../types/index.js';
import type { PlanIntent } from '../types/intent.types.js';
import type { ExecutionProgressReport, NotificationContext } from '../types/plan.types.js';
import {
  PLAN_PROPOSAL_SYSTEM_PROMPT,
  PLAN_FEEDBACK_SYSTEM_PROMPT,
  PLAN_PROMPTS,
  PLAN_RESPONSES,
  formatPlanState,
} from '../config/prompts/plan-prompts.js';
import {
  PLAN_TITLE_MAX_LENGTH,
  PLAN_TITLE_TRUNCATE_LENGTH,
  PLAN_TITLE_WORD_COUNT,
  PLAN_MIN_OBJECTIVE_LENGTH,
  PLAN_MAX_OBJECTIVE_LENGTH,
  PLAN_LIST_LIMIT,
} from '../config/constants.js';

// ============================================================================
// Types
// ============================================================================

export interface PlanIntentHandlerResult {
  success: boolean;
  response: string;
  plan?: Plan;
  progress?: ExecutionProgressReport;
}

export interface PlanIntentContext {
  message: Message;
  chat: Chat;
  sender: Sender | null;
  messageText: string;
}

// ============================================================================
// Plan Intent Handler Service
// ============================================================================

export class PlanIntentHandlerService {
  private telegramService: TelegramService | null = null;

  constructor(private claudeClient: ClaudeClient) {}

  /**
   * Set the Telegram service for progress notifications
   */
  setTelegramService(telegramService: TelegramService): void {
    this.telegramService = telegramService;
    progressReporterService.setTelegramService(telegramService);
  }

  /**
   * Handle a plan-related intent
   */
  async handlePlanIntent(
    intent: PlanIntent,
    context: PlanIntentContext
  ): Promise<PlanIntentHandlerResult> {
    const { message, chat, sender, messageText } = context;

    logger.info('[PlanIntentHandler] Handling plan intent', {
      intent,
      messageId: message.id,
      chatId: chat.id,
      senderId: sender?.id,
    });

    try {
      switch (intent) {
        case 'plan_propose':
          return this.handlePropose(messageText, chat.id, sender?.id);

        case 'plan_feedback':
          return this.handleFeedback(messageText, chat.id, sender?.id);

        case 'plan_approve':
          return this.handleApprove(chat.id, sender?.id);

        case 'plan_execute':
          return this.handleExecute(chat.id, sender?.id);

        case 'plan_status':
          return this.handleStatus(chat.id);

        case 'plan_cancel':
          return this.handleCancel(chat.id, sender?.id);

        case 'plan_list':
          return this.handleList(chat.id, sender?.id);

        default:
          logger.warn('[PlanIntentHandler] Unknown plan intent', { intent });
          return {
            success: false,
            response: "I'm not sure how to handle that plan request.",
          };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('[PlanIntentHandler] Intent handling failed', {
        intent,
        error: errorMessage,
        messageId: message.id,
      });

      return {
        success: false,
        response: PLAN_RESPONSES.error(errorMessage),
      };
    }
  }

  // ============================================================================
  // Intent Handlers
  // ============================================================================

  /**
   * Handle plan_propose: Create a new plan
   */
  private async handlePropose(
    messageText: string,
    chatId: string,
    senderId?: string
  ): Promise<PlanIntentHandlerResult> {
    // Check for existing active plan
    const activePlan = await planManagementService.getActivePlan(chatId);
    if (activePlan) {
      logger.info('[PlanIntentHandler] Active plan already exists', {
        chatId,
        planId: activePlan.id,
        title: activePlan.title,
      });
      return {
        success: false,
        response: PLAN_RESPONSES.activePlanExists(activePlan.title),
        plan: activePlan,
      };
    }

    // Extract the plan request from the message
    const request = this.extractPlanRequest(messageText);

    // Generate plan content using Claude
    logger.info('[PlanIntentHandler] Generating plan content', {
      chatId,
      requestLength: request.length,
    });

    const planContent = await this.generatePlanContent(request);
    if (!planContent) {
      return {
        success: false,
        response: PLAN_RESPONSES.error('Failed to generate plan content'),
      };
    }

    // Extract title from the plan content or generate one
    const title = this.extractPlanTitle(request, planContent);

    // Create the plan
    const result = await planManagementService.createPlan({
      title,
      content: planContent,
      createdBy: senderId,
      chatId,
      metadata: {
        originalRequest: request,
        requestedBy: senderId,
      },
    });

    if (!result.success || !result.plan) {
      return {
        success: false,
        response: PLAN_RESPONSES.error(result.message ?? 'Failed to create plan'),
      };
    }

    logger.info('[PlanIntentHandler] Plan created', {
      planId: result.plan.id,
      title: result.plan.title,
      chatId,
    });

    // Format and return the plan display
    const displayContent = PLAN_PROMPTS.formatPlanDisplay(
      result.plan.title,
      result.plan.content,
      result.plan.state,
      result.plan.version
    );

    return {
      success: true,
      response: `${PLAN_RESPONSES.planCreated(result.plan.title)}\n\n${displayContent}`,
      plan: result.plan,
    };
  }

  /**
   * Handle plan_feedback: Apply feedback to active plan
   */
  private async handleFeedback(
    messageText: string,
    chatId: string,
    senderId?: string
  ): Promise<PlanIntentHandlerResult> {
    // Get the active plan
    const activePlan = await planManagementService.getActivePlan(chatId);
    if (!activePlan) {
      return {
        success: false,
        response: PLAN_RESPONSES.noActivePlan,
      };
    }

    // Check state
    if (activePlan.state !== 'feedback') {
      return {
        success: false,
        response: `Cannot add feedback when plan is in '${activePlan.state}' state.`,
      };
    }

    // Generate updated plan content using Claude
    logger.info('[PlanIntentHandler] Processing plan feedback', {
      planId: activePlan.id,
      feedbackLength: messageText.length,
    });

    const updatedContent = await this.processPlanFeedback(activePlan.content, messageText);
    if (!updatedContent) {
      return {
        success: false,
        response: PLAN_RESPONSES.error('Failed to process feedback'),
      };
    }

    // Update the plan content
    const updateResult = await planManagementService.updatePlanContent(activePlan.id, {
      content: updatedContent,
    });

    if (!updateResult.success) {
      return {
        success: false,
        response: PLAN_RESPONSES.error(updateResult.message ?? 'Failed to update plan'),
      };
    }

    // Store the feedback record
    if (senderId) {
      await planManagementService.addFeedback(activePlan.id, senderId, messageText);
    }

    const updatedPlan = updateResult.plan!;

    logger.info('[PlanIntentHandler] Feedback applied', {
      planId: updatedPlan.id,
      version: updatedPlan.version,
    });

    // Format and return the updated plan
    const displayContent = PLAN_PROMPTS.formatPlanDisplay(
      updatedPlan.title,
      updatedPlan.content,
      updatedPlan.state,
      updatedPlan.version
    );

    return {
      success: true,
      response: `${PLAN_RESPONSES.feedbackApplied(updatedPlan.version)}\n\n${displayContent}`,
      plan: updatedPlan,
    };
  }

  /**
   * Handle plan_approve: Approve the current plan
   */
  private async handleApprove(
    chatId: string,
    senderId?: string
  ): Promise<PlanIntentHandlerResult> {
    const activePlan = await planManagementService.getActivePlan(chatId);
    if (!activePlan) {
      return {
        success: false,
        response: PLAN_RESPONSES.noActivePlan,
      };
    }

    // Check state
    if (activePlan.state !== 'feedback' && activePlan.state !== 'approved') {
      return {
        success: false,
        response: `Cannot approve plan in '${activePlan.state}' state.`,
      };
    }

    // If already approved, just confirm
    if (activePlan.state === 'approved') {
      return {
        success: true,
        response: `Plan "${activePlan.title}" is already approved. Say "execute" to start.`,
        plan: activePlan,
      };
    }

    // Transition to approved state
    const result = await planManagementService.approvePlan(activePlan.id);
    if (!result.success) {
      return {
        success: false,
        response: PLAN_RESPONSES.error(result.message ?? 'Failed to approve plan'),
      };
    }

    logger.info('[PlanIntentHandler] Plan approved', {
      planId: activePlan.id,
      title: activePlan.title,
      approvedBy: senderId,
    });

    return {
      success: true,
      response: PLAN_RESPONSES.planApproved(activePlan.title),
      plan: result.plan ?? activePlan,
    };
  }

  /**
   * Handle plan_execute: Start plan execution
   */
  private async handleExecute(
    chatId: string,
    senderId?: string
  ): Promise<PlanIntentHandlerResult> {
    const activePlan = await planManagementService.getActivePlan(chatId);
    if (!activePlan) {
      return {
        success: false,
        response: PLAN_RESPONSES.noActivePlan,
      };
    }

    // Check state
    if (activePlan.state === 'executing') {
      return {
        success: false,
        response: PLAN_RESPONSES.executionAlreadyRunning(activePlan.title),
      };
    }

    if (activePlan.state !== 'approved') {
      return {
        success: false,
        response: PLAN_RESPONSES.cannotExecute(activePlan.state),
      };
    }

    // Start execution
    logger.info('[PlanIntentHandler] Starting execution', {
      planId: activePlan.id,
      title: activePlan.title,
      startedBy: senderId,
    });

    // Create notification context for progress updates
    const notificationContext: NotificationContext = {
      chatId,
      planId: activePlan.id,
      planTitle: activePlan.title,
    };

    const result = await executionCoordinatorService.startExecution(
      { planId: activePlan.id },
      async (progress, planId) => {
        // Send progress notification via progressReporterService
        logger.debug('[PlanIntentHandler] Progress update', {
          planId,
          tasksCompleted: progress.tasksCompleted,
          totalTasks: progress.totalTasks,
        });

        // Send progress update to Telegram
        await progressReporterService.sendProgressUpdate(notificationContext, progress);
      }
    );

    if (!result.success) {
      return {
        success: false,
        response: PLAN_RESPONSES.error(result.message ?? 'Failed to start execution'),
      };
    }

    // Register completion callback for final notification
    executionCoordinatorService.setCompletionCallback(
      activePlan.id,
      async (progress, status) => {
        await progressReporterService.sendCompletionNotification(
          notificationContext,
          progress,
          status
        );
      }
    );

    logger.info('[PlanIntentHandler] Execution started', {
      planId: activePlan.id,
      sessionId: result.session?.sessionId,
    });

    return {
      success: true,
      response: PLAN_RESPONSES.executionStarted(activePlan.title),
      plan: activePlan,
      progress: result.session?.progress,
    };
  }

  /**
   * Handle plan_status: Get execution status
   */
  private async handleStatus(chatId: string): Promise<PlanIntentHandlerResult> {
    const activePlan = await planManagementService.getActivePlan(chatId);
    if (!activePlan) {
      return {
        success: false,
        response: PLAN_RESPONSES.noActivePlan,
      };
    }

    // Get progress if executing
    if (activePlan.state === 'executing') {
      const progress = await executionCoordinatorService.getProgress(activePlan.id);
      if (progress) {
        const progressDisplay = PLAN_PROMPTS.formatProgressDisplay(progress);
        return {
          success: true,
          response: `**${activePlan.title}** - ${formatPlanState(activePlan.state)}\n${progressDisplay}`,
          plan: activePlan,
          progress,
        };
      }
    }

    // Return plan status without execution progress
    const displayContent = PLAN_PROMPTS.formatPlanDisplay(
      activePlan.title,
      activePlan.content,
      activePlan.state,
      activePlan.version
    );

    return {
      success: true,
      response: displayContent,
      plan: activePlan,
    };
  }

  /**
   * Handle plan_cancel: Cancel plan or execution
   */
  private async handleCancel(
    chatId: string,
    senderId?: string
  ): Promise<PlanIntentHandlerResult> {
    const activePlan = await planManagementService.getActivePlan(chatId);
    if (!activePlan) {
      return {
        success: false,
        response: PLAN_RESPONSES.noActivePlan,
      };
    }

    // If executing, stop execution first
    if (activePlan.state === 'executing') {
      logger.info('[PlanIntentHandler] Stopping execution', {
        planId: activePlan.id,
        stoppedBy: senderId,
      });

      const stopResult = await executionCoordinatorService.stopExecution(activePlan.id);
      if (!stopResult.success) {
        logger.warn('[PlanIntentHandler] Failed to stop execution gracefully', {
          planId: activePlan.id,
          message: stopResult.message,
        });
      }
    }

    // Cancel the plan
    const result = await planManagementService.cancelPlan(activePlan.id);
    if (!result.success) {
      return {
        success: false,
        response: PLAN_RESPONSES.error(result.message ?? 'Failed to cancel plan'),
      };
    }

    logger.info('[PlanIntentHandler] Plan cancelled', {
      planId: activePlan.id,
      cancelledBy: senderId,
    });

    return {
      success: true,
      response: PLAN_RESPONSES.planCancelled(activePlan.title),
    };
  }

  /**
   * Handle plan_list: List user's plans
   */
  private async handleList(
    chatId: string,
    senderId?: string
  ): Promise<PlanIntentHandlerResult> {
    const plans = await planManagementService.getPlansByChatId(chatId, PLAN_LIST_LIMIT);

    if (plans.length === 0) {
      return {
        success: true,
        response: PLAN_RESPONSES.noPlansFound,
      };
    }

    // Format plan list
    const planList = plans.map((plan, index) => {
      const statusIcon = formatPlanState(plan.state).split(' ')[0];
      return `${index + 1}. ${statusIcon} **${plan.title}** (v${plan.version})`;
    }).join('\n');

    return {
      success: true,
      response: `📋 **Your Plans**\n\n${planList}`,
    };
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /**
   * Extract the actual plan request from the message
   * Removes intent trigger words like "create a plan to..."
   */
  private extractPlanRequest(messageText: string): string {
    // Remove common plan intent prefixes
    const prefixes = [
      /^(create|make|write|draft|propose)\s+(a\s+)?plan\s+(to|for|about)\s*/i,
      /^plan\s+(to|for|about|how\s+to)\s*/i,
      /^help\s+me\s+plan\s+(to|for|about)?\s*/i,
      /^i\s+(want|need)\s+(to|a)\s+plan\s*(to|for|about)?\s*/i,
    ];

    let request = messageText.trim();
    for (const prefix of prefixes) {
      request = request.replace(prefix, '');
    }

    return request.trim() || messageText;
  }

  /**
   * Generate plan content using Claude
   */
  private async generatePlanContent(request: string): Promise<string | null> {
    try {
      const prompt = PLAN_PROMPTS.propose(request);
      const response = await this.claudeClient.chat(prompt, PLAN_PROPOSAL_SYSTEM_PROMPT);

      if (!response.success || !response.content) {
        logger.error('[PlanIntentHandler] Claude failed to generate plan', {
          error: response.error,
        });
        return null;
      }

      return response.content;
    } catch (error) {
      logger.error('[PlanIntentHandler] Error generating plan content', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  }

  /**
   * Process feedback and generate updated plan content using Claude
   */
  private async processPlanFeedback(
    currentContent: string,
    feedback: string
  ): Promise<string | null> {
    try {
      const prompt = PLAN_PROMPTS.feedback(currentContent, feedback);
      const response = await this.claudeClient.chat(prompt, PLAN_FEEDBACK_SYSTEM_PROMPT);

      if (!response.success || !response.content) {
        logger.error('[PlanIntentHandler] Claude failed to process feedback', {
          error: response.error,
        });
        return null;
      }

      return response.content;
    } catch (error) {
      logger.error('[PlanIntentHandler] Error processing plan feedback', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  }

  /**
   * Extract or generate a title for the plan
   */
  private extractPlanTitle(request: string, content: string): string {
    // Try to extract from content (look for a header or objective)
    const objectiveMatch = content.match(/##\s*Objective\s*\n+([^\n]+)/i);
    if (objectiveMatch) {
      // Use first meaningful words from objective
      const objective = objectiveMatch[1].trim();
      if (objective.length > PLAN_MIN_OBJECTIVE_LENGTH && objective.length <= PLAN_MAX_OBJECTIVE_LENGTH) {
        return objective;
      }
    }

    // Fallback: Use first meaningful words from request
    const words = request.split(/\s+/).slice(0, PLAN_TITLE_WORD_COUNT);
    let title = words.join(' ');

    // Capitalize first letter
    title = title.charAt(0).toUpperCase() + title.slice(1);

    // Truncate if too long
    if (title.length > PLAN_TITLE_MAX_LENGTH) {
      title = title.substring(0, PLAN_TITLE_TRUNCATE_LENGTH) + '...';
    }

    return title || 'Untitled Plan';
  }
}

// Export type for external use
export type { PlanIntent };
