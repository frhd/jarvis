/**
 * ForceAgenticHandler - Routes all requests through Claude agent when force-agentic mode is enabled
 */

import type { RoutingHandler, RoutingContext, HandlerResult } from './routing-handler.interface.js';
import { HANDLER_PRIORITY } from './routing-handler.interface.js';
import type { LLMRouterService } from '../llm-router.service.js';
import type { ContextBuildingService } from '../context-building.service.js';
import { logger } from '../../../utils/logger.js';

/**
 * Handles requests when force-agentic mode is enabled
 * Routes all non-web-search requests through Claude
 */
export class ForceAgenticHandler implements RoutingHandler {
  readonly name = 'ForceAgenticHandler';
  readonly priority = HANDLER_PRIORITY.FORCE_AGENTIC;

  constructor(
    private llmRouter: LLMRouterService,
    private contextBuilding: ContextBuildingService,
    private forceAgenticMode: boolean
  ) {}

  canHandle(context: RoutingContext): boolean {
    // Only handle if force-agentic mode is enabled AND not a web search
    return this.forceAgenticMode && !context.requiresWebSearch;
  }

  async handle(context: RoutingContext): Promise<HandlerResult> {
    const { message, sender, conversationHistory, messageText, identityOptions, isOwner } = context;

    if (!isOwner) {
      logger.warn('[ForceAgenticHandler] Non-owner in force-agentic mode, routing to Claude chat', {
        messageId: message.id,
        senderId: sender?.telegramId,
      });

      const contextText = await this.buildContext(context);
      const result = await this.llmRouter.handleWithClaude(
        message,
        contextText,
        conversationHistory,
        { isOwner: false }
      );

      return { handled: true, result };
    }

    logger.info('[ForceAgenticHandler] Force agentic mode enabled, routing to Claude agent', {
      messageId: message.id,
      text: messageText.substring(0, 100),
    });

    const result = await this.llmRouter.handleAgenticRequest(message, conversationHistory, sender);

    return { handled: true, result };
  }

  private async buildContext(context: RoutingContext): Promise<string> {
    const { message, conversationHistory, sender, identityOptions } = context;
    return this.contextBuilding.buildConversationContext(
      conversationHistory,
      sender,
      0 // Minimal context for non-owner chat
    );
  }
}
