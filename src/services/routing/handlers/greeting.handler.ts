/**
 * GreetingHandler - Routes simple greetings to Ollama for fast response
 */

import type { RoutingHandler, RoutingContext, HandlerResult } from './routing-handler.interface.js';
import { HANDLER_PRIORITY } from './routing-handler.interface.js';
import type { LLMRouterService } from '../llm-router.service.js';
import type { ContextBuildingService } from '../context-building.service.js';
import type { Sender } from '../../../types/index.js';
import { logger } from '../../../utils/logger.js';

/**
 * Handles simple greetings (priority === 'fast')
 * Routes to Ollama for quick responses
 */
export class GreetingHandler implements RoutingHandler {
  readonly name = 'GreetingHandler';
  readonly priority = HANDLER_PRIORITY.GREETING;

  constructor(
    private llmRouter: LLMRouterService,
    private contextBuilding: ContextBuildingService
  ) {}

  canHandle(context: RoutingContext): boolean {
    return context.routingResult.priority === 'fast';
  }

  async handle(context: RoutingContext): Promise<HandlerResult> {
    const { message, sender } = context;

    logger.debug('[GreetingHandler] Routing greeting to Ollama', {
      messageId: message.id,
    });

    const personalizationContext = await this.getPersonalizationContext(sender);
    const result = await this.llmRouter.handleGreeting(message, sender, personalizationContext);

    return { handled: true, result };
  }

  private async getPersonalizationContext(sender: Sender | null): Promise<string> {
    if (!sender) return '';

    try {
      return await this.contextBuilding.buildConversationContext([], sender, 0);
    } catch {
      return '';
    }
  }
}
