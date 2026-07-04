/**
 * WebSearchHandler - Routes web search requests with search result injection
 */

import type { RoutingHandler, RoutingContext, HandlerResult } from './routing-handler.interface.js';
import { HANDLER_PRIORITY } from './routing-handler.interface.js';
import type { LLMRouterService } from '../llm-router.service.js';
import type { ContextBuildingService } from '../context-building.service.js';
import { logger } from '../../../utils/logger.js';

/**
 * Handles web search requests
 * Injects search results before sending to Claude
 */
export class WebSearchHandler implements RoutingHandler {
  readonly name = 'WebSearchHandler';
  readonly priority = HANDLER_PRIORITY.WEB_SEARCH;

  constructor(
    private llmRouter: LLMRouterService,
    private contextBuilding: ContextBuildingService,
    private buildContextFn: (context: RoutingContext) => Promise<string>
  ) {}

  canHandle(context: RoutingContext): boolean {
    return context.requiresWebSearch;
  }

  async handle(context: RoutingContext): Promise<HandlerResult> {
    const { message, conversationHistory, messageText, routingResult } = context;

    logger.info('[WebSearchHandler] Detected web search request', {
      messageId: message.id,
      childIntent: routingResult.enhancedIntent?.childIntent,
      text: messageText.substring(0, 100),
    });

    const contextText = await this.buildContextFn(context);
    const result = await this.llmRouter.handleWebSearchRequest(
      message,
      contextText,
      conversationHistory
    );

    return { handled: true, result };
  }
}
