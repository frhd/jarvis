/**
 * PlanIntentHandler - Routes plan-related intents to the plan handler
 */

import type { RoutingHandler, RoutingContext, HandlerResult } from './routing-handler.interface.js';
import { HANDLER_PRIORITY } from './routing-handler.interface.js';
import type { LLMRouterService } from '../llm-router.service.js';
import { logger } from '../../../utils/logger.js';

/**
 * Handles plan intents (parentIntent === 'plan')
 * Requires owner permission
 */
export class PlanIntentHandler implements RoutingHandler {
  readonly name = 'PlanIntentHandler';
  readonly priority = HANDLER_PRIORITY.PLAN_INTENT;

  constructor(private llmRouter: LLMRouterService) {}

  canHandle(context: RoutingContext): boolean {
    const isPlanIntent = context.routingResult.enhancedIntent?.parentIntent === 'plan';
    return isPlanIntent && context.isOwner;
  }

  async handle(context: RoutingContext): Promise<HandlerResult> {
    const { message, chat, sender, routingResult } = context;
    const enhancedIntent = routingResult.enhancedIntent;

    if (!enhancedIntent) {
      return { handled: false };
    }

    logger.info('[PlanIntentHandler] Routing to plan handler', {
      messageId: message.id,
      childIntent: enhancedIntent.childIntent,
    });

    const result = await this.llmRouter.handlePlanIntent(
      message,
      chat,
      sender,
      enhancedIntent
    );

    return { handled: true, result };
  }
}
