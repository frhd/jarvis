/**
 * Anthropic Claude API Provider
 *
 * Implements the unified LLM provider interface for Anthropic's Claude models
 * using the Messages API (https://api.anthropic.com/v1/messages)
 *
 * Features:
 * - Chat completions with streaming support
 * - Tool calling (Anthropic's tool_use format)
 * - Vision support (base64 images)
 * - Proper system message handling (top-level parameter)
 * - Health checks and error handling
 */

import {
  IUnifiedLLMProvider,
  LLMProviderType,
  ProviderConfig,
  ProviderHealthStatus,
  UnifiedChatRequest,
  UnifiedChatResponse,
  UnifiedStreamChunk,
  UnifiedMessage,
  UnifiedToolCall,
  TokenUsage,
  ModelConfig,
} from '../../types/llm.types';
import { BaseLLMProvider } from '../base-provider';
import { createLogger } from '../../utils/logger';
import { HEALTH_CHECK_TIMEOUT_MS } from '../../config/constants.js';

const logger = createLogger('AnthropicProvider');

// ============================================================================
// Anthropic-specific types
// ============================================================================

interface AnthropicConfig extends ProviderConfig {
  apiKey: string;
}

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content:
    | string
    | Array<{
        type: 'text' | 'image' | 'tool_use' | 'tool_result';
        text?: string;
        source?: {
          type: 'base64';
          media_type: string;
          data: string;
        };
        id?: string;
        name?: string;
        input?: unknown;
        tool_use_id?: string;
        content?: string;
      }>;
}

interface AnthropicTool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface AnthropicRequest {
  model: string;
  messages: AnthropicMessage[];
  max_tokens: number;
  system?: string;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  stop_sequences?: string[];
  tools?: AnthropicTool[];
  stream?: boolean;
}

interface AnthropicResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: Array<{
    type: 'text' | 'tool_use';
    text?: string;
    id?: string;
    name?: string;
    input?: unknown;
  }>;
  model: string;
  stop_reason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use';
  stop_sequence?: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

interface AnthropicStreamEvent {
  type:
    | 'message_start'
    | 'content_block_start'
    | 'content_block_delta'
    | 'content_block_stop'
    | 'message_delta'
    | 'message_stop'
    | 'ping'
    | 'error';
  index?: number;
  message?: Partial<AnthropicResponse>;
  content_block?: {
    type: 'text' | 'tool_use';
    text?: string;
    id?: string;
    name?: string;
  };
  delta?: {
    type: 'text_delta' | 'input_json_delta';
    text?: string;
    partial_json?: string;
    stop_reason?: string;
  };
  usage?: {
    output_tokens: number;
  };
  error?: {
    type: string;
    message: string;
  };
}

// ============================================================================
// Anthropic Provider Implementation
// ============================================================================

export class AnthropicProvider extends BaseLLMProvider implements IUnifiedLLMProvider {
  readonly type: LLMProviderType = 'anthropic';
  private apiKey: string;
  private baseUrl: string;
  private apiVersion = '2023-06-01';

  constructor(config: AnthropicConfig) {
    super(config);
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || 'https://api.anthropic.com/v1';
  }

  /**
   * Validate Anthropic-specific configuration
   */
  protected async validateConfig(): Promise<void> {
    await super.validateConfig();

    if (!this.apiKey) {
      throw new Error('Anthropic API key is required');
    }

    logger.info('Anthropic provider configuration validated');
  }

  /**
   * Health check - verify API connectivity
   */
  async healthCheck(): Promise<ProviderHealthStatus> {
    const startTime = Date.now();

    try {
      // Use the list models endpoint or a simple request to check health
      const response = await fetch(`${this.baseUrl}/messages`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          model: this.config.defaultModel,
          max_tokens: 1,
          messages: [{ role: 'user', content: 'Hi' }],
        }),
        signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
      });

      const latencyMs = Date.now() - startTime;

      if (!response.ok) {
        const error = await response.text();
        return {
          provider: this.type,
          healthy: false,
          latencyMs,
          error: `API error: ${response.status} - ${error}`,
          lastChecked: new Date(),
        };
      }

      return {
        provider: this.type,
        healthy: true,
        latencyMs,
        availableModels: this.config.models.map((m) => m.id),
        lastChecked: new Date(),
      };
    } catch (error) {
      return {
        provider: this.type,
        healthy: false,
        latencyMs: Date.now() - startTime,
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
      throw new Error(`Model ${modelId} not found`);
    }

    // Convert unified format to Anthropic format
    const anthropicRequest = this.convertRequest(request, model);

    logger.debug(`Sending chat request to Anthropic: ${modelId}`);

    try {
      const controller = this.createAbortController(request.requestId);
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);

      const response = await fetch(`${this.baseUrl}/messages`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(anthropicRequest),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      this.cleanupAbortController(request.requestId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Anthropic API error: ${response.status} - ${errorText}`);
      }

      const data: AnthropicResponse = await response.json();
      const durationMs = Date.now() - startTime;

      logger.debug(`Received response from Anthropic in ${durationMs}ms`);

      return this.convertResponse(data, model, durationMs, request.requestId);
    } catch (error) {
      this.cleanupAbortController(request.requestId);

      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Request timeout');
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
      throw new Error(`Model ${modelId} not found`);
    }

    // Convert unified format to Anthropic format with streaming enabled
    const anthropicRequest = this.convertRequest(request, model);
    anthropicRequest.stream = true;

    logger.debug(`Starting streaming request to Anthropic: ${modelId}`);

    try {
      const controller = this.createAbortController(request.requestId);
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);

      const response = await fetch(`${this.baseUrl}/messages`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(anthropicRequest),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        this.cleanupAbortController(request.requestId);
        throw new Error(`Anthropic API error: ${response.status} - ${errorText}`);
      }

      if (!response.body) {
        this.cleanupAbortController(request.requestId);
        throw new Error('No response body');
      }

      // Parse SSE stream
      yield* this.parseStreamResponse(response.body, model, request.requestId);
    } catch (error) {
      this.cleanupAbortController(request.requestId);

      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Request timeout');
      }

      throw error;
    }
  }

  // ============================================================================
  // Private helper methods
  // ============================================================================

  /**
   * Get headers for Anthropic API requests
   */
  private getHeaders(): Record<string, string> {
    return {
      'anthropic-version': this.apiVersion,
      'x-api-key': this.apiKey,
      'content-type': 'application/json',
    };
  }

  /**
   * Convert unified request to Anthropic format
   */
  private convertRequest(request: UnifiedChatRequest, model: ModelConfig): AnthropicRequest {
    // Extract system message (Anthropic requires it as a top-level parameter)
    let systemMessage: string | undefined;
    const messages: AnthropicMessage[] = [];

    for (const msg of request.messages) {
      if (msg.role === 'system') {
        // Combine all system messages into one
        const content = typeof msg.content === 'string' ? msg.content : this.extractText(msg.content);
        systemMessage = systemMessage ? `${systemMessage}\n\n${content}` : content;
      } else if (msg.role === 'user' || msg.role === 'assistant') {
        messages.push(this.convertMessage(msg));
      } else if (msg.role === 'tool') {
        // Tool results need to be in user messages
        messages.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: msg.toolCallId || '',
              content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
            },
          ],
        });
      }
    }

    // Build request
    const anthropicRequest: AnthropicRequest = {
      model: model.id,
      messages,
      max_tokens: request.maxTokens || model.maxOutputTokens,
    };

    if (systemMessage) {
      anthropicRequest.system = systemMessage;
    }

    if (request.temperature !== undefined) {
      anthropicRequest.temperature = request.temperature;
    }

    if (request.topP !== undefined) {
      anthropicRequest.top_p = request.topP;
    }

    if (request.topK !== undefined) {
      anthropicRequest.top_k = request.topK;
    }

    if (request.stopSequences?.length) {
      anthropicRequest.stop_sequences = request.stopSequences;
    }

    if (request.tools?.length) {
      anthropicRequest.tools = request.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: {
          type: 'object',
          properties: tool.parameters.properties || {},
          required: tool.parameters.required,
        },
      }));
    }

    return anthropicRequest;
  }

  /**
   * Convert unified message to Anthropic format
   */
  private convertMessage(msg: UnifiedMessage): AnthropicMessage {
    if (typeof msg.content === 'string') {
      return {
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      };
    }

    // Handle multimodal content
    const content = msg.content.map((part) => {
      if (part.type === 'text') {
        return {
          type: 'text' as const,
          text: part.text || '',
        };
      } else if (part.type === 'image_url') {
        // Convert image URL to base64 format
        const url = part.image_url?.url || '';
        if (url.startsWith('data:')) {
          // Extract base64 data from data URI
          const match = url.match(/^data:([^;]+);base64,(.+)$/);
          if (match) {
            return {
              type: 'image' as const,
              source: {
                type: 'base64' as const,
                media_type: match[1],
                data: match[2],
              },
            };
          }
        }
        throw new Error('Only base64 data URIs are supported for images');
      }
      throw new Error(`Unsupported content type: ${part.type}`);
    });

    return {
      role: msg.role as 'user' | 'assistant',
      content,
    };
  }

  /**
   * Convert Anthropic response to unified format
   */
  private convertResponse(
    data: AnthropicResponse,
    model: ModelConfig,
    durationMs: number,
    requestId?: string
  ): UnifiedChatResponse {
    // Extract text content and tool calls
    let textContent = '';
    const toolCalls: UnifiedToolCall[] = [];

    for (const block of data.content) {
      if (block.type === 'text') {
        textContent += block.text || '';
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id || '',
          name: block.name || '',
          arguments: JSON.stringify(block.input || {}),
        });
      }
    }

    // Map finish reason
    const finishReason =
      data.stop_reason === 'end_turn'
        ? ('stop' as const)
        : data.stop_reason === 'max_tokens'
          ? ('length' as const)
          : data.stop_reason === 'tool_use'
            ? ('tool_calls' as const)
            : ('stop' as const);

    const usage: TokenUsage = {
      promptTokens: data.usage.input_tokens,
      completionTokens: data.usage.output_tokens,
      totalTokens: data.usage.input_tokens + data.usage.output_tokens,
    };

    return {
      content: textContent,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage,
      metadata: {
        durationMs,
        finishReason,
        provider: this.type,
        model: model.id,
        requestId,
      },
    };
  }

  /**
   * Parse SSE stream response
   */
  private async *parseStreamResponse(
    body: ReadableStream<Uint8Array>,
    model: ModelConfig,
    requestId?: string
  ): AsyncIterable<UnifiedStreamChunk> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let currentText = '';
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim() || line.startsWith(':')) {
            continue;
          }

          if (line.startsWith('data: ')) {
            const data = line.slice(6);

            try {
              const event: AnthropicStreamEvent = JSON.parse(data);

              if (event.type === 'error') {
                throw new Error(event.error?.message || 'Stream error');
              }

              if (event.type === 'message_start' && event.message?.usage) {
                totalInputTokens = event.message.usage.input_tokens;
              }

              if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
                const text = event.delta.text || '';
                currentText += text;
                yield {
                  content: text,
                  done: false,
                };
              }

              if (event.type === 'message_delta' && event.usage) {
                totalOutputTokens = event.usage.output_tokens;
              }

              if (event.type === 'message_stop') {
                yield {
                  content: '',
                  done: true,
                  usage: {
                    promptTokens: totalInputTokens,
                    completionTokens: totalOutputTokens,
                    totalTokens: totalInputTokens + totalOutputTokens,
                  },
                  metadata: {
                    provider: this.type,
                    model: model.id,
                    requestId,
                  },
                };
              }
            } catch (error) {
              logger.warn(`Failed to parse SSE event: ${error}`);
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
      this.cleanupAbortController(requestId);
    }
  }

  /**
   * Extract text from multimodal content
   */
  private extractText(
    content: Array<{
      type: 'text' | 'image_url';
      text?: string;
      image_url?: { url: string; detail?: 'low' | 'high' | 'auto' };
    }>
  ): string {
    return content
      .filter((part) => part.type === 'text')
      .map((part) => part.text || '')
      .join('\n');
  }
}

// ============================================================================
// Provider configuration helpers
// ============================================================================

/**
 * Create Anthropic provider with default configuration
 */
export function createAnthropicProvider(apiKey: string, options?: Partial<AnthropicConfig>): AnthropicProvider {
  const defaultModels: ModelConfig[] = [
    {
      id: 'claude-sonnet-4-20250514',
      provider: 'anthropic',
      displayName: 'Claude Sonnet 4',
      contextWindow: 200000,
      maxOutputTokens: 8192,
      costPer1kInput: 3.0,
      costPer1kOutput: 15.0,
      capabilities: {
        streaming: true,
        toolCalling: true,
        vision: true,
        embeddings: false,
        jsonMode: false,
        functionCalling: true,
      },
      defaultTemperature: 1.0,
      tags: ['fast', 'smart', 'reasoning'],
    },
    {
      id: 'claude-opus-4-20250514',
      provider: 'anthropic',
      displayName: 'Claude Opus 4',
      contextWindow: 200000,
      maxOutputTokens: 8192,
      costPer1kInput: 15.0,
      costPer1kOutput: 75.0,
      capabilities: {
        streaming: true,
        toolCalling: true,
        vision: true,
        embeddings: false,
        jsonMode: false,
        functionCalling: true,
      },
      defaultTemperature: 1.0,
      tags: ['most-capable', 'reasoning', 'coding'],
    },
    {
      id: 'claude-3-5-haiku-20241022',
      provider: 'anthropic',
      displayName: 'Claude 3.5 Haiku',
      contextWindow: 200000,
      maxOutputTokens: 8192,
      costPer1kInput: 1.0,
      costPer1kOutput: 5.0,
      capabilities: {
        streaming: true,
        toolCalling: true,
        vision: true,
        embeddings: false,
        jsonMode: false,
        functionCalling: true,
      },
      defaultTemperature: 1.0,
      tags: ['fast', 'cheap'],
    },
  ];

  const config: AnthropicConfig = {
    type: 'anthropic',
    enabled: true,
    apiKey,
    baseUrl: options?.baseUrl || 'https://api.anthropic.com/v1',
    defaultModel: options?.defaultModel || 'claude-sonnet-4-20250514',
    models: options?.models || defaultModels,
    timeoutMs: options?.timeoutMs || 60000,
    maxRetries: options?.maxRetries || 3,
    ...options,
  };

  return new AnthropicProvider(config);
}
