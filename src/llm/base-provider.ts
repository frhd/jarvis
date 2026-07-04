/**
 * Base LLM Provider - Abstract class for all LLM providers
 */

import {
  IUnifiedLLMProvider,
  LLMProviderType,
  ProviderConfig,
  ProviderCapabilities,
  ProviderHealthStatus,
  UnifiedChatRequest,
  UnifiedChatResponse,
  UnifiedStreamChunk,
  ModelConfig,
  CostEstimate,
  UnifiedMessage,
} from '../types/llm.types';
import { createLogger } from '../utils/logger';
import { CHARS_PER_TOKEN } from '../constants/index.js';

const logger = createLogger('BaseLLMProvider');

/**
 * Abstract base class for LLM providers
 */
export abstract class BaseLLMProvider implements IUnifiedLLMProvider {
  abstract readonly type: LLMProviderType;
  readonly config: ProviderConfig;

  protected initialized = false;
  protected abortControllers = new Map<string, AbortController>();

  constructor(config: ProviderConfig) {
    this.config = config;
  }

  /**
   * Initialize the provider - override in subclasses
   */
  async initialize(): Promise<void> {
    logger.info(`Initializing ${this.type} provider`);
    await this.validateConfig();
    this.initialized = true;
    logger.info(`${this.type} provider initialized`);
  }

  /**
   * Validate provider configuration - override in subclasses
   */
  protected async validateConfig(): Promise<void> {
    if (!this.config.enabled) {
      throw new Error(`${this.type} provider is disabled`);
    }
  }

  /**
   * Health check - must be implemented by subclasses
   */
  abstract healthCheck(): Promise<ProviderHealthStatus>;

  /**
   * Chat completion - must be implemented by subclasses
   */
  abstract chat(request: UnifiedChatRequest): Promise<UnifiedChatResponse>;

  /**
   * Stream chat completion - optional, override in subclasses
   */
  async *stream(request: UnifiedChatRequest): AsyncIterable<UnifiedStreamChunk> {
    // Default implementation: return full response as single chunk
    const response = await this.chat(request);
    yield {
      content: response.content,
      done: true,
      usage: response.usage,
      metadata: response.metadata,
    };
  }

  /**
   * List available models
   */
  async listModels(): Promise<ModelConfig[]> {
    return this.config.models;
  }

  /**
   * Get provider capabilities
   */
  getCapabilities(): ProviderCapabilities {
    // Aggregate capabilities from all models
    const capabilities: ProviderCapabilities = {
      streaming: false,
      toolCalling: false,
      vision: false,
      embeddings: false,
      jsonMode: false,
      functionCalling: false,
    };

    for (const model of this.config.models) {
      if (model.capabilities.streaming) capabilities.streaming = true;
      if (model.capabilities.toolCalling) capabilities.toolCalling = true;
      if (model.capabilities.vision) capabilities.vision = true;
      if (model.capabilities.embeddings) capabilities.embeddings = true;
      if (model.capabilities.jsonMode) capabilities.jsonMode = true;
      if (model.capabilities.functionCalling) capabilities.functionCalling = true;
    }

    return capabilities;
  }

  /**
   * Estimate cost for a request
   */
  estimateCost(request: UnifiedChatRequest): CostEstimate {
    const modelId = request.model || this.config.defaultModel;
    const model = this.config.models.find((m) => m.id === modelId);

    if (!model) {
      logger.warn(`Model ${modelId} not found for cost estimation`);
      return {
        provider: this.type,
        model: modelId,
        inputTokens: 0,
        outputTokens: 0,
        inputCost: 0,
        outputCost: 0,
        totalCost: 0,
        currency: 'USD',
      };
    }

    const inputTokens = this.estimateInputTokens(request.messages);
    const outputTokens = request.maxTokens || model.maxOutputTokens / 2;

    const inputCost = (inputTokens / 1000) * model.costPer1kInput;
    const outputCost = (outputTokens / 1000) * model.costPer1kOutput;

    return {
      provider: this.type,
      model: modelId,
      inputTokens,
      outputTokens,
      inputCost,
      outputCost,
      totalCost: inputCost + outputCost,
      currency: 'USD',
    };
  }

  /**
   * Estimate input tokens from messages
   */
  protected estimateInputTokens(messages: UnifiedMessage[]): number {
    let totalChars = 0;
    for (const msg of messages) {
      if (typeof msg.content === 'string') {
        totalChars += msg.content.length;
      } else {
        for (const part of msg.content) {
          if (part.type === 'text' && part.text) {
            totalChars += part.text.length;
          }
        }
      }
    }
    return Math.ceil(totalChars / CHARS_PER_TOKEN);
  }

  /**
   * Cancel an ongoing request
   */
  cancelRequest(requestId: string): void {
    const controller = this.abortControllers.get(requestId);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(requestId);
      logger.debug(`Cancelled request ${requestId}`);
    }
  }

  /**
   * Create abort controller for a request
   */
  protected createAbortController(requestId?: string): AbortController {
    const controller = new AbortController();
    if (requestId) {
      this.abortControllers.set(requestId, controller);
    }
    return controller;
  }

  /**
   * Clean up abort controller after request
   */
  protected cleanupAbortController(requestId?: string): void {
    if (requestId) {
      this.abortControllers.delete(requestId);
    }
  }

  /**
   * Shutdown the provider
   */
  async shutdown(): Promise<void> {
    logger.info(`Shutting down ${this.type} provider`);
    // Cancel all pending requests
    this.abortControllers.forEach((controller, requestId) => {
      controller.abort();
      logger.debug(`Cancelled pending request ${requestId}`);
    });
    this.abortControllers.clear();
    this.initialized = false;
    logger.info(`${this.type} provider shutdown complete`);
  }

  /**
   * Get default model configuration
   */
  protected getDefaultModel(): ModelConfig | undefined {
    return this.config.models.find((m) => m.id === this.config.defaultModel);
  }

  /**
   * Get model configuration by ID
   */
  protected getModel(modelId: string): ModelConfig | undefined {
    return this.config.models.find((m) => m.id === modelId);
  }

  /**
   * Check if provider is initialized
   */
  protected ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error(`${this.type} provider is not initialized. Call initialize() first.`);
    }
  }
}
