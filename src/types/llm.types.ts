/**
 * Unified LLM Types - Phase 6: Multi-Model Support
 *
 * Provides a standardized interface for all LLM providers
 */

// ============================================================================
// Core Provider Types
// ============================================================================

/**
 * Supported LLM providers
 */
export type LLMProviderType = 'ollama' | 'openai' | 'anthropic' | 'gemini' | 'lmstudio';

/**
 * Provider capabilities matrix
 */
export interface ProviderCapabilities {
  streaming: boolean;
  toolCalling: boolean;
  vision: boolean;
  embeddings: boolean;
  jsonMode: boolean;
  functionCalling: boolean;
}

/**
 * Provider health status
 */
export interface ProviderHealthStatus {
  provider: LLMProviderType;
  healthy: boolean;
  latencyMs?: number;
  availableModels?: string[];
  error?: string;
  lastChecked: Date;
}

// ============================================================================
// Message Types
// ============================================================================

/**
 * Role in a conversation
 */
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

/**
 * Content can be text or multimodal
 */
export type MessageContent =
  | string
  | {
      type: 'text' | 'image_url';
      text?: string;
      image_url?: {
        url: string;
        detail?: 'low' | 'high' | 'auto';
      };
    }[];

/**
 * Standardized message format for all providers
 */
export interface UnifiedMessage {
  role: MessageRole;
  content: MessageContent;
  name?: string; // For tool responses or named system messages
  toolCallId?: string; // Reference to a tool call
}

// ============================================================================
// Tool/Function Calling Types
// ============================================================================

/**
 * JSON Schema type for tool parameters
 */
export interface JSONSchemaType {
  type: 'object' | 'string' | 'number' | 'boolean' | 'array' | 'null';
  properties?: Record<string, JSONSchemaProperty>;
  required?: string[];
  items?: JSONSchemaProperty;
  description?: string;
  enum?: (string | number)[];
}

export interface JSONSchemaProperty {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'null';
  description?: string;
  enum?: (string | number)[];
  items?: JSONSchemaProperty;
  properties?: Record<string, JSONSchemaProperty>;
  required?: string[];
}

/**
 * Tool definition for function calling
 */
export interface UnifiedTool {
  name: string;
  description: string;
  parameters: JSONSchemaType;
}

/**
 * Tool call made by the model
 */
export interface UnifiedToolCall {
  id: string;
  name: string;
  arguments: string; // JSON string
}

// ============================================================================
// Request/Response Types
// ============================================================================

/**
 * Standardized chat request
 */
export interface UnifiedChatRequest {
  messages: UnifiedMessage[];
  model?: string; // Optional, uses provider default
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  topK?: number;
  stopSequences?: string[];
  tools?: UnifiedTool[];
  toolChoice?: 'auto' | 'none' | 'required' | { name: string };
  stream?: boolean;
  jsonMode?: boolean;
  requestId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Token usage information
 */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens?: number; // For providers that support prompt caching
}

/**
 * Response metadata
 */
export interface ResponseMetadata {
  durationMs: number;
  finishReason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'error';
  provider: LLMProviderType;
  model: string;
  cached?: boolean;
  requestId?: string;
}

/**
 * Standardized chat response
 */
export interface UnifiedChatResponse {
  content: string;
  toolCalls?: UnifiedToolCall[];
  usage?: TokenUsage;
  metadata: ResponseMetadata;
}

/**
 * Streaming chunk for real-time responses
 */
export interface UnifiedStreamChunk {
  content?: string;
  toolCalls?: Partial<UnifiedToolCall>[];
  done: boolean;
  usage?: TokenUsage;
  metadata?: Partial<ResponseMetadata>;
}

// ============================================================================
// Model Configuration Types
// ============================================================================

/**
 * Model-specific configuration
 */
export interface ModelConfig {
  id: string;
  provider: LLMProviderType;
  displayName: string;
  contextWindow: number;
  maxOutputTokens: number;
  costPer1kInput: number; // USD per 1k input tokens
  costPer1kOutput: number; // USD per 1k output tokens
  capabilities: ProviderCapabilities;
  defaultTemperature?: number;
  tags?: string[]; // e.g., ['fast', 'cheap', 'reasoning', 'coding']
}

/**
 * Provider configuration
 */
export interface ProviderConfig {
  type: LLMProviderType;
  enabled: boolean;
  apiKey?: string;
  baseUrl?: string;
  defaultModel: string;
  models: ModelConfig[];
  timeoutMs: number;
  maxRetries: number;
  rateLimitRpm?: number; // Requests per minute
  organization?: string; // For OpenAI
  projectId?: string; // For Google Cloud
}

// ============================================================================
// Model Selection Types
// ============================================================================

/**
 * Criteria for model selection
 */
export interface ModelSelectionCriteria {
  taskComplexity: 'low' | 'medium' | 'high';
  maxLatencyMs?: number;
  maxCostPerRequest?: number;
  requiredCapabilities?: (keyof ProviderCapabilities)[];
  preferredProviders?: LLMProviderType[];
  excludeProviders?: LLMProviderType[];
  preferredTags?: string[];
  minContextWindow?: number;
}

/**
 * Model selection result with reasoning
 */
export interface ModelSelectionResult {
  model: ModelConfig;
  provider: LLMProviderType;
  score: number;
  reasoning: string[];
  alternatives: Array<{
    model: ModelConfig;
    provider: LLMProviderType;
    score: number;
  }>;
}

/**
 * Message complexity analysis result
 */
export interface ComplexityAnalysis {
  score: number; // 0-1
  level: 'low' | 'medium' | 'high';
  factors: {
    tokenCount: number;
    hasMultipleTurns: boolean;
    requiresReasoning: boolean;
    requiresCodeGeneration: boolean;
    requiresWebSearch: boolean;
    hasImages: boolean;
    estimatedOutputTokens: number;
  };
}

// ============================================================================
// Cost Tracking Types
// ============================================================================

/**
 * Cost estimation for a request
 */
export interface CostEstimate {
  provider: LLMProviderType;
  model: string;
  inputTokens: number;
  outputTokens: number;
  inputCost: number;
  outputCost: number;
  totalCost: number;
  currency: 'USD';
}

/**
 * Aggregated cost statistics
 */
export interface CostStatistics {
  period: 'hour' | 'day' | 'week' | 'month';
  byProvider: Record<LLMProviderType, number>;
  byModel: Record<string, number>;
  totalCost: number;
  totalRequests: number;
  averageCostPerRequest: number;
}

// ============================================================================
// Fallback and Retry Types
// ============================================================================

/**
 * Fallback chain configuration
 */
export interface FallbackConfig {
  primary: { provider: LLMProviderType; model: string };
  fallbacks: Array<{ provider: LLMProviderType; model: string; condition?: string }>;
  maxAttempts: number;
}

/**
 * Error with provider context
 */
export interface ProviderError {
  provider: LLMProviderType;
  model: string;
  code: string;
  message: string;
  retryable: boolean;
  retryAfterMs?: number;
}

// ============================================================================
// Provider Interface
// ============================================================================

/**
 * Unified provider interface that all LLM clients must implement
 */
export interface IUnifiedLLMProvider {
  readonly type: LLMProviderType;
  readonly config: ProviderConfig;

  /**
   * Initialize the provider (load models, validate API keys, etc.)
   */
  initialize(): Promise<void>;

  /**
   * Check provider health
   */
  healthCheck(): Promise<ProviderHealthStatus>;

  /**
   * Send a chat request
   */
  chat(request: UnifiedChatRequest): Promise<UnifiedChatResponse>;

  /**
   * Stream a chat response (if supported)
   */
  stream?(request: UnifiedChatRequest): AsyncIterable<UnifiedStreamChunk>;

  /**
   * Get available models
   */
  listModels(): Promise<ModelConfig[]>;

  /**
   * Get provider capabilities
   */
  getCapabilities(): ProviderCapabilities;

  /**
   * Estimate cost for a request
   */
  estimateCost(request: UnifiedChatRequest): CostEstimate;

  /**
   * Cancel an ongoing request
   */
  cancelRequest?(requestId: string): void;

  /**
   * Shutdown the provider gracefully
   */
  shutdown(): Promise<void>;
}

// ============================================================================
// Model Router Interface
// ============================================================================

/**
 * Model router for intelligent routing between providers
 */
export interface IModelRouter {
  /**
   * Select the best model for a request
   */
  selectModel(
    request: UnifiedChatRequest,
    criteria?: ModelSelectionCriteria
  ): Promise<ModelSelectionResult>;

  /**
   * Analyze message complexity
   */
  analyzeComplexity(messages: UnifiedMessage[]): ComplexityAnalysis;

  /**
   * Route a request through the best provider with fallback
   */
  route(request: UnifiedChatRequest, criteria?: ModelSelectionCriteria): Promise<UnifiedChatResponse>;

  /**
   * Get current provider status
   */
  getProviderStatus(): Promise<Record<LLMProviderType, ProviderHealthStatus>>;

  /**
   * Register a new provider
   */
  registerProvider(provider: IUnifiedLLMProvider): void;

  /**
   * Unregister a provider
   */
  unregisterProvider(type: LLMProviderType): void;
}

// ============================================================================
// Model Registry Interface
// ============================================================================

/**
 * Central registry for all models and providers
 */
export interface IModelRegistry {
  /**
   * Get all registered providers
   */
  getProviders(): IUnifiedLLMProvider[];

  /**
   * Get a specific provider
   */
  getProvider(type: LLMProviderType): IUnifiedLLMProvider | undefined;

  /**
   * Get all available models across providers
   */
  getAllModels(): ModelConfig[];

  /**
   * Get models by capability
   */
  getModelsByCapability(capability: keyof ProviderCapabilities): ModelConfig[];

  /**
   * Get models by tag
   */
  getModelsByTag(tag: string): ModelConfig[];

  /**
   * Get cheapest model for a task
   */
  getCheapestModel(criteria?: Partial<ModelSelectionCriteria>): ModelConfig | undefined;

  /**
   * Get fastest model for a task
   */
  getFastestModel(criteria?: Partial<ModelSelectionCriteria>): ModelConfig | undefined;

  /**
   * Register a provider
   */
  register(provider: IUnifiedLLMProvider): void;

  /**
   * Unregister a provider
   */
  unregister(type: LLMProviderType): void;

  /**
   * Health check all providers
   */
  healthCheckAll(): Promise<Record<LLMProviderType, ProviderHealthStatus>>;
}
