/**
 * LLM Module - Multi-Model Support
 *
 * Phase 6 implementation providing unified interface for multiple LLM providers.
 */

// Base classes
export { BaseLLMProvider } from './base-provider';

// Registry and Router
export { ModelRegistry, getModelRegistry, resetModelRegistry } from './model-registry';
export { ModelRouter } from './model-router';

// Complexity Scorer
export { ComplexityScorer, getComplexityScorer, resetComplexityScorer } from './complexity-scorer';
export type { ComplexityWeights } from './complexity-scorer';

// Model Preferences
export {
  ModelPreferenceManager,
  getModelPreferenceManager,
  resetModelPreferenceManager,
} from './model-preferences';
export type { UserModelPreferences, SystemModelConfig } from './model-preferences';

// Provider implementations
export * from './providers';

// Types re-exported for convenience
export type {
  LLMProviderType,
  ProviderConfig,
  ProviderCapabilities,
  ProviderHealthStatus,
  IUnifiedLLMProvider,
  IModelRouter,
  IModelRegistry,
  UnifiedMessage,
  UnifiedChatRequest,
  UnifiedChatResponse,
  UnifiedStreamChunk,
  UnifiedTool,
  UnifiedToolCall,
  TokenUsage,
  ModelConfig,
  ModelSelectionCriteria,
  ModelSelectionResult,
  ComplexityAnalysis,
  CostEstimate,
  CostStatistics,
  FallbackConfig,
  ProviderError,
} from '../types/llm.types';
