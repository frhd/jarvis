/**
 * Routing Services Barrel Export
 *
 * Extracted services from ResponseRouterService for separation of concerns.
 */

// Intent Routing - classification and routing decisions
export { IntentRoutingService } from './intent-routing.service.js';
export type { IntentRoutingResult, IntentRoutingConfig } from './intent-routing.service.js';

// Context Building - building context strings for LLM interactions
export { ContextBuildingService } from './context-building.service.js';
export type { RAGContextOptions } from './context-building.service.js';

// Response Cache - caching logic for response routing
export { ResponseCacheService } from './response-cache.service.js';
export type { ResponseCacheConfig } from './response-cache.service.js';

// Anti-Loop Detection - detects frustration + imperative patterns
export { AntiLoopService } from './anti-loop.service.js';
export type { AntiLoopResult, AntiLoopConfig, PendingAction } from './anti-loop.service.js';

// LLM Router - routes to Ollama or Claude based on complexity
export { LLMRouterService } from './llm-router.service.js';
export type { LLMRouterConfig, LLMRouterResult } from './llm-router.service.js';

// Routing Handlers - strategy pattern for intent routing
export type { RoutingHandler, RoutingContext, HandlerResult } from './handlers/index.js';
export {
  RoutingChain,
  HANDLER_PRIORITY,
  // Handler implementations
  PlanIntentHandler,
  JokeRequestHandler,
  HealthStatusHandler,
  ForceAgenticHandler,
  WebSearchHandler,
  GreetingHandler,
  AgenticRequestHandler,
  DefaultClaudeHandler,
} from './handlers/index.js';
