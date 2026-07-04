/**
 * Ollama LLM Provider
 *
 * Implements the IUnifiedLLMProvider interface for Ollama
 * Based on the existing LLMClient implementation
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
  UnifiedTool,
  UnifiedToolCall,
  ResponseMetadata,
  TokenUsage,
} from '../../types/llm.types';
import { logger } from '../../utils/logger';
import { HEALTH_CHECK_TIMEOUT_MS } from '../../config/constants.js';

// ============================================================================
// Ollama-specific Types
// ============================================================================

interface OllamaConfig {
  baseUrl: string;
  defaultModel: string;
  timeoutMs: number;
  maxRetries: number;
  temperature: number;
  maxTokens: number;
}

interface OllamaChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: OllamaToolCall[];
}

interface OllamaToolCall {
  function: {
    name: string;
    arguments: string | Record<string, unknown>;
  };
}

interface OllamaTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, { type: string; description?: string }>;
      required?: string[];
    };
  };
}

interface OllamaChatRequest {
  model: string;
  messages: OllamaChatMessage[];
  tools?: OllamaTool[];
  stream: boolean;
  options?: {
    temperature?: number;
    num_predict?: number;
    top_p?: number;
    top_k?: number;
    stop?: string[];
  };
}

interface OllamaChatResponse {
  model: string;
  message: {
    role: 'assistant';
    content: string;
    tool_calls?: OllamaToolCall[];
  };
  done: boolean;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

interface OllamaStreamChunk {
  model: string;
  message?: {
    role: 'assistant';
    content: string;
    tool_calls?: OllamaToolCall[];
  };
  done: boolean;
  total_duration?: number;
  prompt_eval_count?: number;
  eval_count?: number;
}

interface OllamaTag {
  name: string;
  model: string;
  modified_at: string;
  size: number;
  digest: string;
}

interface OllamaTagsResponse {
  models: OllamaTag[];
}

// ============================================================================
// Ollama Provider Implementation
// ============================================================================

export class OllamaProvider extends BaseLLMProvider {
  readonly type: LLMProviderType = 'ollama';
  private ollamaConfig: OllamaConfig;

  constructor(config: ProviderConfig) {
    super(config);

    // Extract Ollama-specific config
    this.ollamaConfig = {
      baseUrl: config.baseUrl || 'http://localhost:11434',
      defaultModel: config.defaultModel || 'mistral',
      timeoutMs: config.timeoutMs || 60000,
      maxRetries: config.maxRetries || 3,
      temperature: 0.7,
      maxTokens: 2048,
    };
  }

  /**
   * Initialize the provider
   */
  async initialize(): Promise<void> {
    await super.initialize();
    logger.info('Ollama provider: Verifying connection...');

    // Perform initial health check
    const health = await this.healthCheck();
    if (!health.healthy) {
      throw new Error(`Ollama provider initialization failed: ${health.error}`);
    }

    logger.info(`Ollama provider: Connected to ${this.ollamaConfig.baseUrl}`);
  }

  /**
   * Health check implementation
   */
  async healthCheck(): Promise<ProviderHealthStatus> {
    const startTime = Date.now();

    try {
      const response = await fetch(`${this.ollamaConfig.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
      });

      if (!response.ok) {
        return {
          provider: this.type,
          healthy: false,
          error: `Ollama API returned ${response.status}: ${response.statusText}`,
          lastChecked: new Date(),
        };
      }

      const data = (await response.json()) as OllamaTagsResponse;
      const latencyMs = Date.now() - startTime;

      // Extract model names from tags
      const availableModels = data.models?.map((m) => m.name) || [];

      // Check if default model is available
      const defaultModelLoaded = availableModels.some((name) =>
        name.includes(this.ollamaConfig.defaultModel.split(':')[0])
      );

      return {
        provider: this.type,
        healthy: true,
        latencyMs,
        availableModels,
        error: defaultModelLoaded
          ? undefined
          : `Default model '${this.ollamaConfig.defaultModel}' not found. It will be downloaded on first use.`,
        lastChecked: new Date(),
      };
    } catch (error) {
      return {
        provider: this.type,
        healthy: false,
        error: error instanceof Error ? error.message : 'Unknown error during health check',
        lastChecked: new Date(),
      };
    }
  }

  /**
   * Chat completion implementation
   */
  async chat(request: UnifiedChatRequest): Promise<UnifiedChatResponse> {
    this.ensureInitialized();

    const startTime = Date.now();
    const model = request.model || this.ollamaConfig.defaultModel;
    const controller = this.createAbortController(request.requestId);

    try {
      // Set timeout
      const timeoutMs = (request.metadata?.timeout as number) || this.ollamaConfig.timeoutMs;
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      // Convert unified messages to Ollama format
      const ollamaMessages = this.convertMessagesToOllama(request.messages);

      // Convert unified tools to Ollama format (if any)
      const ollamaTools = request.tools ? this.convertToolsToOllama(request.tools) : undefined;

      // Build Ollama request
      const ollamaRequest: OllamaChatRequest = {
        model,
        messages: ollamaMessages,
        stream: false,
        options: {
          temperature: request.temperature ?? this.ollamaConfig.temperature,
          num_predict: request.maxTokens ?? this.ollamaConfig.maxTokens,
          top_p: request.topP,
          top_k: request.topK,
          stop: request.stopSequences,
        },
      };

      if (ollamaTools) {
        ollamaRequest.tools = ollamaTools;
      }

      // Make API request
      const response = await fetch(`${this.ollamaConfig.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ollamaRequest),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as OllamaChatResponse;

      // Convert response to unified format
      const durationMs = Date.now() - startTime;
      const toolCalls = this.convertToolCallsFromOllama(data.message.tool_calls);

      const metadata: ResponseMetadata = {
        durationMs,
        finishReason: toolCalls ? 'tool_calls' : 'stop',
        provider: this.type,
        model: data.model,
        requestId: request.requestId,
      };

      const usage: TokenUsage | undefined = data.prompt_eval_count
        ? {
            promptTokens: data.prompt_eval_count || 0,
            completionTokens: data.eval_count || 0,
            totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
          }
        : undefined;

      return {
        content: data.message.content || '',
        toolCalls,
        usage,
        metadata,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;

      // Handle abort/timeout
      if (error instanceof Error && error.name === 'AbortError') {
        const timeoutMs = (request.metadata?.timeout as number) || this.ollamaConfig.timeoutMs;
        throw new Error(`Ollama request timed out after ${timeoutMs}ms`);
      }

      // Re-throw other errors
      throw error;
    } finally {
      this.cleanupAbortController(request.requestId);
    }
  }

  /**
   * Stream chat completion implementation
   */
  async *stream(request: UnifiedChatRequest): AsyncIterable<UnifiedStreamChunk> {
    this.ensureInitialized();

    const model = request.model || this.ollamaConfig.defaultModel;
    const controller = this.createAbortController(request.requestId);

    try {
      // Set timeout
      const timeoutMs = (request.metadata?.timeout as number) || this.ollamaConfig.timeoutMs;
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      // Convert unified messages to Ollama format
      const ollamaMessages = this.convertMessagesToOllama(request.messages);

      // Convert unified tools to Ollama format (if any)
      const ollamaTools = request.tools ? this.convertToolsToOllama(request.tools) : undefined;

      // Build Ollama request
      const ollamaRequest: OllamaChatRequest = {
        model,
        messages: ollamaMessages,
        stream: true,
        options: {
          temperature: request.temperature ?? this.ollamaConfig.temperature,
          num_predict: request.maxTokens ?? this.ollamaConfig.maxTokens,
          top_p: request.topP,
          top_k: request.topK,
          stop: request.stopSequences,
        },
      };

      if (ollamaTools) {
        ollamaRequest.tools = ollamaTools;
      }

      // Make streaming API request
      const response = await fetch(`${this.ollamaConfig.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ollamaRequest),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
      }

      if (!response.body) {
        throw new Error('Response body is null');
      }

      // Process streaming response
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            const chunk = JSON.parse(line) as OllamaStreamChunk;

            // Convert to unified stream chunk
            const unifiedChunk: UnifiedStreamChunk = {
              content: chunk.message?.content || '',
              done: chunk.done,
            };

            // Add usage info on final chunk
            if (chunk.done && chunk.prompt_eval_count) {
              unifiedChunk.usage = {
                promptTokens: chunk.prompt_eval_count || 0,
                completionTokens: chunk.eval_count || 0,
                totalTokens: (chunk.prompt_eval_count || 0) + (chunk.eval_count || 0),
              };
              unifiedChunk.metadata = {
                provider: this.type,
                model: chunk.model,
              };
            }

            // Convert tool calls if present
            if (chunk.message?.tool_calls) {
              unifiedChunk.toolCalls = this.convertToolCallsFromOllama(chunk.message.tool_calls);
            }

            yield unifiedChunk;
          } catch (parseError) {
            logger.warn('Ollama provider: Failed to parse stream chunk', parseError);
          }
        }
      }
    } catch (error) {
      // Handle abort/timeout
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(
          `Ollama stream timed out after ${request.metadata?.timeout || this.ollamaConfig.timeoutMs}ms`
        );
      }

      // Re-throw other errors
      throw error;
    } finally {
      this.cleanupAbortController(request.requestId);
    }
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /**
   * Convert unified messages to Ollama format
   */
  private convertMessagesToOllama(messages: UnifiedMessage[]): OllamaChatMessage[] {
    return messages.map((msg) => {
      const ollamaMsg: OllamaChatMessage = {
        role: msg.role,
        content: typeof msg.content === 'string' ? msg.content : this.extractTextContent(msg.content),
      };

      return ollamaMsg;
    });
  }

  /**
   * Extract text content from multimodal content
   */
  private extractTextContent(content: Exclude<UnifiedMessage['content'], string>): string {
    const textParts = content.filter((part) => part.type === 'text' && part.text);
    return textParts.map((part) => part.text).join('\n');
  }

  /**
   * Convert unified tools to Ollama format
   */
  private convertToolsToOllama(tools: UnifiedTool[]): OllamaTool[] {
    return tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: {
          type: 'object',
          properties: tool.parameters.properties || {},
          required: tool.parameters.required,
        },
      },
    }));
  }

  /**
   * Convert Ollama tool calls to unified format
   */
  private convertToolCallsFromOllama(
    toolCalls?: OllamaToolCall[]
  ): UnifiedToolCall[] | undefined {
    if (!toolCalls || toolCalls.length === 0) {
      return undefined;
    }

    return toolCalls.map((tc, index) => ({
      id: `call_${Date.now()}_${index}`,
      name: tc.function.name,
      arguments:
        typeof tc.function.arguments === 'string'
          ? tc.function.arguments
          : JSON.stringify(tc.function.arguments),
    }));
  }
}
