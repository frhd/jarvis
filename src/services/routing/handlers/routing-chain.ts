/**
 * RoutingChain - Iterates through handlers to process routing requests
 *
 * Implements the Chain of Responsibility pattern for routing decisions.
 * Handlers are sorted by priority and executed in order until one handles the request.
 */

import { logger } from '../../../utils/logger.js';
import type { RoutingHandler, RoutingContext, HandlerResult } from './routing-handler.interface.js';

/**
 * RoutingChain - Manages handler execution chain
 */
export class RoutingChain {
  private handlers: RoutingHandler[] = [];

  /**
   * Register a handler to the chain
   * Handlers are automatically sorted by priority on addition
   */
  register(handler: RoutingHandler): void {
    this.handlers.push(handler);
    this.handlers.sort((a, b) => a.priority - b.priority);
    logger.debug(`[RoutingChain] Registered handler: ${handler.name} (priority: ${handler.priority})`);
  }

  /**
   * Execute the chain - iterate through handlers until one handles the request
   * @returns The result from the first handler that handles the request, or null if none handled it
   */
  async execute(context: RoutingContext): Promise<HandlerResult | null> {
    for (const handler of this.handlers) {
      try {
        if (handler.canHandle(context)) {
          logger.debug(`[RoutingChain] Executing handler: ${handler.name}`, {
            messageId: context.message.id,
          });

          const result = await handler.handle(context);

          if (result.handled) {
            logger.info(`[RoutingChain] Request handled by: ${handler.name}`, {
              messageId: context.message.id,
              success: result.result?.success,
            });
            return result;
          }
        }
      } catch (error) {
        logger.error(`[RoutingChain] Handler ${handler.name} threw error`, {
          messageId: context.message.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        // Continue to next handler on error
      }
    }

    logger.warn('[RoutingChain] No handler processed the request', {
      messageId: context.message.id,
      intent: context.routingResult.intent,
    });

    return null;
  }

  /**
   * Get list of registered handler names (for debugging)
   */
  getHandlerNames(): string[] {
    return this.handlers.map(h => h.name);
  }
}
