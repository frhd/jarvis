/**
 * AgenticRequestHandler - Routes agentic requests to Claude with tools
 */

import type { RoutingHandler, RoutingContext, HandlerResult } from './routing-handler.interface.js';
import { HANDLER_PRIORITY } from './routing-handler.interface.js';
import type { LLMRouterService } from '../llm-router.service.js';
import { logger } from '../../../utils/logger.js';

/**
 * Non-owner refusal message constant
 */
const NON_OWNER_REFUSAL =
  'I can only perform system operations for authorized users. Feel free to chat with me about anything else though!';

/**
 * Handles agentic requests (file operations, shell commands, etc.)
 * Detected via pattern matching OR intent classification
 * Requires owner permission
 */
export class AgenticRequestHandler implements RoutingHandler {
  readonly name = 'AgenticRequestHandler';
  readonly priority = HANDLER_PRIORITY.AGENTIC_REQUEST;

  constructor(private llmRouter: LLMRouterService) {}

  canHandle(context: RoutingContext): boolean {
    const { messageText, conversationHistory, routingResult } = context;

    // Check via LLM router pattern matching OR intent classification
    const isPatternMatch = this.llmRouter.isAgenticRequest(messageText, conversationHistory);
    const isIntentMatch = routingResult.enhancedIntent?.childIntent === 'task_request';

    return isPatternMatch || isIntentMatch;
  }

  async handle(context: RoutingContext): Promise<HandlerResult> {
    const { message, sender, conversationHistory, messageText, isOwner, routingResult } = context;

    // Non-owner gets refusal
    if (!isOwner) {
      logger.warn('[AgenticRequestHandler] Non-owner attempted agentic request', {
        messageId: message.id,
        senderId: sender?.telegramId,
      });

      return {
        handled: true,
        result: {
          success: true,
          content: NON_OWNER_REFUSAL,
          routedTo: 'claude',
        },
      };
    }

    // Detect how we identified this as agentic
    const detectedBy = this.llmRouter.isAgenticRequest(messageText, conversationHistory)
      ? 'pattern'
      : 'intent';

    logger.info('[AgenticRequestHandler] Routing to Claude with tools', {
      messageId: message.id,
      text: messageText.substring(0, 100),
      detectedBy,
    });

    const result = await this.llmRouter.handleAgenticRequest(message, conversationHistory, sender);

    return { handled: true, result };
  }
}
