/**
 * Routing Handlers - Strategy pattern implementations for intent routing
 *
 * Each handler checks if it can handle a request and provides handling logic.
 * Handlers are ordered by priority in the routing chain.
 */

// Interface and types
export type { RoutingHandler, RoutingContext, HandlerResult } from './routing-handler.interface.js';
export { HANDLER_PRIORITY } from './routing-handler.interface.js';

// Chain of responsibility
export { RoutingChain } from './routing-chain.js';

// Handler implementations
export { PlanIntentHandler } from './plan-intent.handler.js';
export { JokeRequestHandler } from './joke-request.handler.js';
export { HealthStatusHandler } from './health-status.handler.js';
export { ForceAgenticHandler } from './force-agentic.handler.js';
export { WebSearchHandler } from './web-search.handler.js';
export { GreetingHandler } from './greeting.handler.js';
export { AgenticRequestHandler } from './agentic-request.handler.js';
export { CalendarRequestHandler } from './calendar-request.handler.js';
export { DefaultClaudeHandler } from './default-claude.handler.js';
