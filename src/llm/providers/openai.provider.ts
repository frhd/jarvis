/**
 * OpenAI LLM Provider
 *
 * Implements the unified LLM provider interface for OpenAI's API
 * Using native fetch API (no SDK dependency)
 */

import { BaseLLMProvider } from '../base-provider';
import {
  LLMProviderType,
  ProviderConfig,
  ProviderHealthStatus,
  UnifiedChatRequest,
  UnifiedChatResponse,
  UnifiedStreamChunk,
  UnifiedMessage,
  UnifiedToolCall,
  TokenUsage,
  MessageContent,
  ModelConfig,
  ProviderCapabilities,
} from '../../types/llm.types';
import { createLogger } from '../../utils/logger';
import { HEALTH_CHECK_TIMEOUT_MS } from '../../config/constants.js';

const logger = createLogger('OpenAIProvider');

// ============================================================================
// OpenAI-specific Types
// ============================================================================

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | OpenAIMessageContent[];
  name?: string;
  tool_call_id?: string;
  tool_calls?: OpenAIToolCall[];
}

interface OpenAIMessageContent {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: {
    url: string;
    detail?: 'low' | 'high' | 'auto';
  };
}

interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface OpenAIRequest {
  model: string;
  messages: OpenAIMessage[];
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  stop?: string[];
  tools?: OpenAITool[];
  tool_choice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };
  stream?: boolean;
  response_format?: { type: 'json_object' | 'text' };
}

interface OpenAIResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: 'assistant';
      content: string | null;
      tool_calls?: OpenAIToolCall[];
    };
    finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface OpenAIStreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: 'assistant';
      content?: string;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: 'function';
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null;
  }>;
}

interface OpenAIErrorResponse {
  error: {
    message: string;
    type: string;
    code: string | null;
  };
}

// ============================================================================
// OpenAI Provider Configuration
// ============================================================================

export interface OpenAIProviderConfig extends Omit<ProviderConfig, 'type'> {
  apiKey: string;
  organization?: string;
  baseUrl?: string;
}

// ============================================================================
// OpenAI Provider Implementation
// ============================================================================

export class OpenAIProvider extends BaseLLMProvider {
  readonly type: LLMProviderType = 'openai';
  private readonly apiKey: string;
  private readonly organization?: string;
  private readonly baseUrl: string;

  constructor(config: OpenAIProviderConfig) {
    // Ensure default models are included
    const fullConfig: ProviderConfig = {
      ...config,
      type: 'openai',
      baseUrl: config.baseUrl || 'https://api.openai.com/v1',
      defaultModel: config.defaultModel || 'gpt-4o-mini',
      models: config.models.length > 0 ? config.models : OpenAIProvider.getDefaultModels(),
      timeoutMs: config.timeoutMs || 60000,
      maxRetries: config.maxRetries || 3,
    };

    super(fullConfig);

    if (!config.apiKey) {
      throw new Error('OpenAI API key is required');
    }

    this.apiKey = config.apiKey;
    this.organization = config.organization;
    this.baseUrl = fullConfig.baseUrl || 'https://api.openai.com/v1';
  }

  /**
   * Get default OpenAI model configurations
   */
  static getDefaultModels(): ModelConfig[] {
    return [
      {
        id: 'gpt-4o',
        provider: 'openai',
        displayName: 'GPT-4o',
        contextWindow: 128000,
        maxOutputTokens: 16384,
        costPer1kInput: 0.005, // $5/1M = $0.005/1k
        costPer1kOutput: 0.015, // $15/1M = $0.015/1k
        capabilities: {
          streaming: true,
          toolCalling: true,
          vision: true,
          embeddings: false,
          jsonMode: true,
          functionCalling: true,
        },
        defaultTemperature: 1.0,
        tags: ['multimodal', 'reasoning', 'coding', 'fast'],
      },
      {
        id: 'gpt-4o-mini',
        provider: 'openai',
        displayName: 'GPT-4o Mini',
        contextWindow: 128000,
        maxOutputTokens: 16384,
        costPer1kInput: 0.00015, // $0.15/1M = $0.00015/1k
        costPer1kOutput: 0.0006, // $0.6/1M = $0.0006/1k
        capabilities: {
          streaming: true,
          toolCalling: true,
          vision: true,
          embeddings: false,
          jsonMode: true,
          functionCalling: true,
        },
        defaultTemperature: 1.0,
        tags: ['fast', 'cheap', 'multimodal', 'coding'],
      },
      {
        id: 'gpt-4-turbo',
        provider: 'openai',
        displayName: 'GPT-4 Turbo',
        contextWindow: 128000,
        maxOutputTokens: 4096,
        costPer1kInput: 0.01, // $10/1M = $0.01/1k
        costPer1kOutput: 0.03, // $30/1M = $0.03/1k
        capabilities: {
          streaming: true,
          toolCalling: true,
          vision: true,
          embeddings: false,
          jsonMode: true,
          functionCalling: true,
        },
        defaultTemperature: 1.0,
        tags: ['multimodal', 'reasoning', 'coding'],
      },
      {
        id: 'o1',
        provider: 'openai',
        displayName: 'O1',
        contextWindow: 200000,
        maxOutputTokens: 100000,
        costPer1kInput: 0.015, // $15/1M = $0.015/1k
        costPer1kOutput: 0.06, // $60/1M = $0.06/1k
        capabilities: {
          streaming: false,
          toolCalling: false,
          vision: false,
          embeddings: false,
          jsonMode: false,
          functionCalling: false,
        },
        defaultTemperature: 1.0,
        tags: ['reasoning', 'complex', 'math', 'science'],
      },
      {
        id: 'o1-mini',
        provider: 'openai',
        displayName: 'O1 Mini',
        contextWindow: 128000,
        maxOutputTokens: 65536,
        costPer1kInput: 0.003, // $3/1M = $0.003/1k
        costPer1kOutput: 0.012, // $12/1M = $0.012/1k
        capabilities: {
          streaming: false,
          toolCalling: false,
          vision: false,
          embeddings: false,
          jsonMode: false,
          functionCalling: false,
        },
        defaultTemperature: 1.0,
        tags: ['reasoning', 'fast', 'math', 'coding'],
      },
    ];
  }

  /**
   * Initialize the provider
   */
  async initialize(): Promise<void> {
    await super.initialize();
    logger.info('OpenAI provider initialized', {
      baseUrl: this.baseUrl,
      defaultModel: this.config.defaultModel,
      modelCount: this.config.models.length,
    });
  }

  /**
   * Validate configuration
   */
  protected async validateConfig(): Promise<void> {
    await super.validateConfig();

    if (!this.apiKey) {
      throw new Error('OpenAI API key is required');
    }

    if (!this.baseUrl) {
      throw new Error('OpenAI base URL is required');
    }
  }

  /**
   * Health check by listing models
   */
  async healthCheck(): Promise<ProviderHealthStatus> {
    const startTime = Date.now();

    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        method: 'GET',
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
      });

      if (!response.ok) {
        const error = await this.parseError(response);
        return {
          provider: this.type,
          healthy: false,
          error: error.message,
          lastChecked: new Date(),
        };
      }

      const data = await response.json();
      const modelIds = data.data?.map((m: { id: string }) => m.id) || [];

      return {
        provider: this.type,
        healthy: true,
        latencyMs: Date.now() - startTime,
        availableModels: modelIds,
        lastChecked: new Date(),
      };
    } catch (error) {
      logger.error('Health check failed', error);
      return {
        provider: this.type,
        healthy: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        lastChecked: new Date(),
      };
    }
  }

  /**
   * Chat completion
   */
  async chat(request: UnifiedChatRequest): Promise<UnifiedChatResponse> {
    this.ensureInitialized();

    const startTime = Date.now();
    const modelId = request.model || this.config.defaultModel;
    const model = this.getModel(modelId);

    if (!model) {
      throw new Error(`Model ${modelId} not found in OpenAI provider`);
    }

    // Create abort controller
    const controller = this.createAbortController(request.requestId);
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const openaiRequest = this.convertToOpenAIRequest(request);

      logger.debug('Sending chat request', {
        model: modelId,
        messageCount: request.messages.length,
        tools: request.tools?.length || 0,
      });

      const response = await this.sendRequest(openaiRequest, controller.signal);

      clearTimeout(timeoutId);
      this.cleanupAbortController(request.requestId);

      return this.convertToUnifiedResponse(response, startTime, modelId);
    } catch (error) {
      clearTimeout(timeoutId);
      this.cleanupAbortController(request.requestId);

      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Request timeout or cancelled');
      }

      throw error;
    }
  }

  /**
   * Stream chat completion
   */
  async *stream(request: UnifiedChatRequest): AsyncIterable<UnifiedStreamChunk> {
    this.ensureInitialized();

    const modelId = request.model || this.config.defaultModel;
    const model = this.getModel(modelId);

    if (!model) {
      throw new Error(`Model ${modelId} not found in OpenAI provider`);
    }

    if (!model.capabilities.streaming) {
      // Fallback to non-streaming
      yield* super.stream(request);
      return;
    }

    const controller = this.createAbortController(request.requestId);
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const openaiRequest = this.convertToOpenAIRequest(request);
      openaiRequest.stream = true;

      logger.debug('Sending streaming chat request', {
        model: modelId,
        messageCount: request.messages.length,
      });

      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(openaiRequest),
        signal: controller.signal,
      });

      if (!response.ok) {
        const error = await this.parseError(response);
        throw new Error(`OpenAI API error: ${error.message}`);
      }

      if (!response.body) {
        throw new Error('Response body is null');
      }

      // Parse SSE stream
      let contentBuffer = '';
      const toolCallsBuffer: Map<number, { id?: string; name?: string; arguments: string }> = new Map();

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (!line.trim() || line.trim() === 'data: [DONE]') continue;
            if (!line.startsWith('data: ')) continue;

            const data = line.slice(6); // Remove 'data: ' prefix

            try {
              const parsed: OpenAIStreamChunk = JSON.parse(data);
              const choice = parsed.choices[0];

              if (!choice) continue;

              // Handle content delta
              if (choice.delta.content) {
                contentBuffer += choice.delta.content;
                yield {
                  content: choice.delta.content,
                  done: false,
                };
              }

              // Handle tool calls
              if (choice.delta.tool_calls) {
                for (const toolCallDelta of choice.delta.tool_calls) {
                  const index = toolCallDelta.index;
                  let buffered = toolCallsBuffer.get(index) || { arguments: '' };

                  if (toolCallDelta.id) {
                    buffered.id = toolCallDelta.id;
                  }
                  if (toolCallDelta.function?.name) {
                    buffered.name = toolCallDelta.function.name;
                  }
                  if (toolCallDelta.function?.arguments) {
                    buffered.arguments += toolCallDelta.function.arguments;
                  }

                  toolCallsBuffer.set(index, buffered);
                }
              }

              // Check for finish
              if (choice.finish_reason) {
                const toolCalls: UnifiedToolCall[] = [];
                toolCallsBuffer.forEach((tc) => {
                  if (tc.id && tc.name) {
                    toolCalls.push({
                      id: tc.id,
                      name: tc.name,
                      arguments: tc.arguments,
                    });
                  }
                });

                yield {
                  content: contentBuffer,
                  toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
                  done: true,
                  metadata: {
                    provider: this.type,
                    model: modelId,
                    finishReason: this.mapFinishReason(choice.finish_reason),
                  },
                };
              }
            } catch (parseError) {
              logger.warn('Failed to parse SSE chunk', { line, error: parseError });
            }
          }
        }
      } finally {
        reader.releaseLock();
        clearTimeout(timeoutId);
        this.cleanupAbortController(request.requestId);
      }
    } catch (error) {
      clearTimeout(timeoutId);
      this.cleanupAbortController(request.requestId);

      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Request timeout or cancelled');
      }

      throw error;
    }
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  /**
   * Get request headers
   */
  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
    };

    if (this.organization) {
      headers['OpenAI-Organization'] = this.organization;
    }

    return headers;
  }

  /**
   * Convert unified request to OpenAI format
   */
  private convertToOpenAIRequest(request: UnifiedChatRequest): OpenAIRequest {
    const openaiRequest: OpenAIRequest = {
      model: request.model || this.config.defaultModel,
      messages: request.messages.map((m) => this.convertMessage(m)),
      temperature: request.temperature,
      max_tokens: request.maxTokens,
      top_p: request.topP,
      stop: request.stopSequences,
    };

    // Add tools if provided
    if (request.tools && request.tools.length > 0) {
      openaiRequest.tools = request.tools.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters as unknown as Record<string, unknown>,
        },
      }));

      // Map tool choice
      if (request.toolChoice) {
        if (typeof request.toolChoice === 'string') {
          openaiRequest.tool_choice = request.toolChoice;
        } else {
          openaiRequest.tool_choice = {
            type: 'function',
            function: { name: request.toolChoice.name },
          };
        }
      }
    }

    // Add JSON mode if requested
    if (request.jsonMode) {
      openaiRequest.response_format = { type: 'json_object' };
    }

    return openaiRequest;
  }

  /**
   * Convert unified message to OpenAI format
   */
  private convertMessage(message: UnifiedMessage): OpenAIMessage {
    const openaiMessage: OpenAIMessage = {
      role: message.role,
      content: typeof message.content === 'string'
        ? message.content
        : message.content.map((c) => ({
            type: c.type,
            text: c.text,
            image_url: c.image_url,
          })),
    };

    if (message.name) {
      openaiMessage.name = message.name;
    }

    if (message.toolCallId) {
      openaiMessage.tool_call_id = message.toolCallId;
    }

    return openaiMessage;
  }

  /**
   * Send request with retry logic
   */
  private async sendRequest(
    request: OpenAIRequest,
    signal: AbortSignal,
    attempt = 1
  ): Promise<OpenAIResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(request),
        signal,
      });

      if (!response.ok) {
        const error = await this.parseError(response);

        // Handle rate limiting with retry
        if (response.status === 429 && attempt < this.config.maxRetries) {
          const retryAfter = this.getRetryAfter(response);
          logger.warn(`Rate limited, retrying after ${retryAfter}ms`, {
            attempt,
            maxRetries: this.config.maxRetries,
          });

          await this.delay(retryAfter);
          return this.sendRequest(request, signal, attempt + 1);
        }

        throw new Error(`OpenAI API error (${response.status}): ${error.message}`);
      }

      return await response.json();
    } catch (error) {
      if (attempt < this.config.maxRetries && this.isRetryableError(error)) {
        const backoff = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
        logger.warn(`Request failed, retrying after ${backoff}ms`, {
          attempt,
          maxRetries: this.config.maxRetries,
          error: error instanceof Error ? error.message : 'Unknown error',
        });

        await this.delay(backoff);
        return this.sendRequest(request, signal, attempt + 1);
      }

      throw error;
    }
  }

  /**
   * Parse error response
   */
  private async parseError(response: Response): Promise<{ message: string; type: string }> {
    try {
      const data: OpenAIErrorResponse = await response.json();
      return {
        message: data.error.message,
        type: data.error.type,
      };
    } catch {
      return {
        message: `HTTP ${response.status}: ${response.statusText}`,
        type: 'unknown',
      };
    }
  }

  /**
   * Get retry-after duration from headers
   */
  private getRetryAfter(response: Response): number {
    const retryAfter = response.headers.get('retry-after');
    if (retryAfter) {
      const seconds = parseInt(retryAfter, 10);
      if (!isNaN(seconds)) {
        return seconds * 1000; // Convert to ms
      }
    }
    return 1000; // Default 1s
  }

  /**
   * Check if error is retryable
   */
  private isRetryableError(error: unknown): boolean {
    if (error instanceof Error) {
      // Network errors
      if (error.name === 'FetchError' || error.message.includes('fetch')) {
        return true;
      }
      // Timeout errors
      if (error.name === 'AbortError') {
        return false; // Don't retry timeouts
      }
    }
    return false;
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Convert OpenAI response to unified format
   */
  private convertToUnifiedResponse(
    response: OpenAIResponse,
    startTime: number,
    modelId: string
  ): UnifiedChatResponse {
    const choice = response.choices[0];
    const content = choice.message.content || '';
    const toolCalls = choice.message.tool_calls?.map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: tc.function.arguments,
    }));

    const usage: TokenUsage | undefined = response.usage
      ? {
          promptTokens: response.usage.prompt_tokens,
          completionTokens: response.usage.completion_tokens,
          totalTokens: response.usage.total_tokens,
        }
      : undefined;

    return {
      content,
      toolCalls,
      usage,
      metadata: {
        durationMs: Date.now() - startTime,
        finishReason: this.mapFinishReason(choice.finish_reason),
        provider: this.type,
        model: modelId,
      },
    };
  }

  /**
   * Map OpenAI finish reason to unified format
   */
  private mapFinishReason(
    reason: string | null
  ): 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'error' {
    switch (reason) {
      case 'stop':
        return 'stop';
      case 'length':
        return 'length';
      case 'tool_calls':
        return 'tool_calls';
      case 'content_filter':
        return 'content_filter';
      default:
        return 'error';
    }
  }
}
