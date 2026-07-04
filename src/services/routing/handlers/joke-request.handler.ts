/**
 * JokeRequestHandler - Routes joke requests to the comic generator
 */

import type { RoutingHandler, RoutingContext, HandlerResult } from './routing-handler.interface.js';
import { HANDLER_PRIORITY } from './routing-handler.interface.js';
import type { LLMRouterService } from '../llm-router.service.js';
import { logger } from '../../../utils/logger.js';

/**
 * Handles joke requests (childIntent === 'joke_request')
 */
export class JokeRequestHandler implements RoutingHandler {
  readonly name = 'JokeRequestHandler';
  readonly priority = HANDLER_PRIORITY.JOKE_REQUEST;

  constructor(private llmRouter: LLMRouterService) {}

  canHandle(context: RoutingContext): boolean {
    return context.routingResult.enhancedIntent?.childIntent === 'joke_request';
  }

  async handle(context: RoutingContext): Promise<HandlerResult> {
    const { message, sender, chat, messageText } = context;

    logger.info('[JokeRequestHandler] Routing to comic generator', {
      messageId: message.id,
      text: messageText.substring(0, 100),
    });

    const result = await this.llmRouter.handleJokeRequest(message, sender, chat);

    return { handled: true, result };
  }
}
