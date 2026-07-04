/**
 * HealthStatusHandler - Routes health status requests
 */

import type { RoutingHandler, RoutingContext, HandlerResult } from './routing-handler.interface.js';
import { HANDLER_PRIORITY } from './routing-handler.interface.js';
import type { StatusHandlerService } from '../../statusHandler.service.js';
import { logger } from '../../../utils/logger.js';

/**
 * Handles health status requests (childIntent === 'health_status')
 * Requires a StatusHandlerService to be available
 */
export class HealthStatusHandler implements RoutingHandler {
  readonly name = 'HealthStatusHandler';
  readonly priority = HANDLER_PRIORITY.HEALTH_STATUS;

  constructor(private statusHandler: StatusHandlerService | null) {}

  canHandle(context: RoutingContext): boolean {
    return (
      context.routingResult.enhancedIntent?.childIntent === 'health_status' &&
      this.statusHandler !== null
    );
  }

  async handle(context: RoutingContext): Promise<HandlerResult> {
    const { message } = context;

    logger.info('[HealthStatusHandler] Handling health status request', {
      messageId: message.id,
    });

    const healthResponse = await this.statusHandler!.handleSystemHealth();

    return {
      handled: true,
      result: {
        success: true,
        content: healthResponse,
        routedTo: 'ollama',
      },
    };
  }
}
