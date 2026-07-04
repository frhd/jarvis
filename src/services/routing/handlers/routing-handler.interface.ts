/**
 * RoutingHandler Interface
 *
 * Strategy pattern interface for handling different routing intents.
 * Each handler checks if it can handle a request and provides the handling logic.
 */

import type { Message, Chat, Sender } from '../../../types/index.js';
import type { EnhancedIntentResult } from '../../../types/intent.types.js';
import type { IntentRoutingResult } from '../intent-routing.service.js';
import type { LLMRouterResult } from '../llm-router.service.js';

/**
 * Context passed to each routing handler
 */
export interface RoutingContext {
  message: Message;
  chat: Chat;
  sender: Sender | null;
  conversationHistory: Message[];
  messageText: string;
  routingResult: IntentRoutingResult;
  identityOptions?: { userId?: string; conversationId?: string };
  isOwner: boolean;
  requiresWebSearch: boolean;
}

/**
 * Result from a routing handler
 */
export interface HandlerResult {
  handled: boolean;
  result?: LLMRouterResult;
}

/**
 * RoutingHandler - Strategy interface for intent routing
 *
 * Implementations:
 * - Check specific conditions via canHandle()
 * - Execute routing logic via handle()
 */
export interface RoutingHandler {
  /**
   * Unique name for logging and debugging
   */
  readonly name: string;

  /**
   * Priority for handler ordering (lower = higher priority)
   */
  readonly priority: number;

  /**
   * Check if this handler should process the request
   */
  canHandle(context: RoutingContext): boolean;

  /**
   * Handle the routing request
   * @returns HandlerResult with handled=true if this handler processed the request
   */
  handle(context: RoutingContext): Promise<HandlerResult>;
}

/**
 * Priority constants for handler ordering
 * Lower numbers = higher priority (processed first)
 */
export const HANDLER_PRIORITY = {
  PLAN_INTENT: 10,
  ANTI_LOOP_OVERRIDE: 15,
  JOKE_REQUEST: 20,
  HEALTH_STATUS: 35,
  FORCE_AGENTIC: 40,
  CALENDAR: 45,
  WEB_SEARCH: 50,
  GREETING: 60,
  AGENTIC_REQUEST: 70,
  DEFAULT_CLAUDE: 100,
} as const;
