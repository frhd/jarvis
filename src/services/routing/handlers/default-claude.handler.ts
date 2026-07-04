/**
 * DefaultClaudeHandler - Fallback handler for general chat via Claude
 */

import type { RoutingHandler, RoutingContext, HandlerResult } from './routing-handler.interface.js';
import { HANDLER_PRIORITY } from './routing-handler.interface.js';
import type { LLMRouterService } from '../llm-router.service.js';
import { logger } from '../../../utils/logger.js';

/**
 * Default handler for all requests not handled by other handlers
 * Routes to Claude for quality responses
 */
export class DefaultClaudeHandler implements RoutingHandler {
  readonly name = 'DefaultClaudeHandler';
  readonly priority = HANDLER_PRIORITY.DEFAULT_CLAUDE;

  constructor(
    private llmRouter: LLMRouterService,
    private buildContextFn: (context: RoutingContext) => Promise<string>
  ) {}

  canHandle(_context: RoutingContext): boolean {
    // Always can handle - this is the fallback
    return true;
  }

  async handle(context: RoutingContext): Promise<HandlerResult> {
    const { message, conversationHistory, isOwner } = context;

    logger.debug('[DefaultClaudeHandler] Routing to Claude for general chat', {
      messageId: message.id,
    });

    const contextText = await this.buildContextFn(context);
    const result = await this.llmRouter.handleWithClaude(
      message,
      contextText,
      conversationHistory,
      { isOwner }
    );

    return { handled: true, result };
  }
}
