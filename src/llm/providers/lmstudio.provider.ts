/**
 * LM Studio LLM Provider
 *
 * Implements the IUnifiedLLMProvider interface for LM Studio.
 * LM Studio exposes an OpenAI-compatible API on localhost.
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
  ModelConfig,
} from '../../types/llm.types';
import { createLogger } from '../../utils/logger';
import { HEALTH_CHECK_TIMEOUT_MS } from '../../config/constants.js';

const logger = createLogger('LMStudioProvider');

// ============================================================================
// LM Studio-specific Types (OpenAI-compatible)
// ============================================================================

interface LMStudioMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: LMStudioToolCall[];
  tool_call_id?: string;
}

interface LMStudioToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

interface LMStudioTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface LMStudioRequest {
  model: string;
  messages: LMStudioMessage[];
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  stop?: string[];
  stream?: boolean;
  tools?: LMStudioTool[];
  tool_choice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
}

interface LMStudioChoice {
  index: number;
  message: {
    role: 'assistant';
    content: string | null;
    tool_calls?: LMStudioToolCall[];
  };
  finish_reason: 'stop' | 'length' | 'tool_calls' | null;
}

interface LMStudioResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: LMStudioChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface LMStudioStreamDelta {
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
}

interface LMStudioStreamChoice {
  index: number;
  delta: LMStudioStreamDelta;
  finish_reason: 'stop' | 'length' | 'tool_calls' | null;
}

interface LMStudioStreamChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: LMStudioStreamChoice[];
}

interface LMStudioModelsResponse {
  data: Array<{
    id: string;
    object: 'model';
    created: number;
    owned_by: string;
  }>;
}

// ============================================================================
// LM Studio Provider Implementation
// ============================================================================

export class LMStudioProvider extends BaseLLMProvider {
  readonly type: LLMProviderType = 'lmstudio';

  constructor(config: ProviderConfig) {
    super(config);

    // LM Studio default config
    if (!this.config.baseUrl) {
      this.config.baseUrl = 'http://localhost:1234/v1';
    }
    if (!this.config.defaultModel) {
      this.config.defaultModel = 'local-model';
    }
  }

  /**
   * Initialize the provider
   */
  async initialize(): Promise<void> {
    await super.initialize();
    logger.info('LM Studio provider: Verifying connection...');

    const health = await this.healthCheck();
    if (!health.healthy) {
      throw new Error(`LM Studio provider initialization failed: ${health.error}`);
    }

    logger.info(`LM Studio provider: Connected to ${this.config.baseUrl}`);
  }

  /**
   * Health check implementation
   */
  async healthCheck(): Promise<ProviderHealthStatus> {
    const startTime = Date.now();

    try {
      const response = await fetch(`${this.config.baseUrl}/models`, {
        signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
      });

      if (!response.ok) {
        return {
          provider: this.type,
          healthy: false,
          error: `LM Studio API returned ${response.status}: ${response.statusText}`,
          lastChecked: new Date(),
        };
      }

      const data = (await response.json()) as LMStudioModelsResponse;
      const latencyMs = Date.now() - startTime;
      const availableModels = data.data?.map((m) => m.id) || [];

      return {
        provider: this.type,
        healthy: true,
        latencyMs,
        availableModels,
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
   * List available models (from LM Studio)
   */
  async listModels(): Promise<ModelConfig[]> {
    try {
      const response = await fetch(`${this.config.baseUrl}/models`, {
        signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
      });

      if (!response.ok) {
        return this.config.models;
      }

      const data = (await response.json()) as LMStudioModelsResponse;

      // Create ModelConfig for each discovered model
      const discoveredModels: ModelConfig[] = data.data.map((m) => ({
        id: m.id,
        provider: this.type,
        displayName: m.id,
        contextWindow: 8192, // Default, LM Studio doesn't expose this
        maxOutputTokens: 4096,
        costPer1kInput: 0, // Local models are free
        costPer1kOutput: 0,
        capabilities: {
          streaming: true,
          toolCalling: true,
          vision: false, // May vary by model
          embeddings: false,
          jsonMode: true,
          functionCalling: true,
        },
        tags: ['local', 'fast'],
      }));

      return discoveredModels;
    } catch {
      return this.config.models;
    }
  }

  /**
   * Chat completion implementation
   */
  async chat(request: UnifiedChatRequest): Promise<UnifiedChatResponse> {
    this.ensureInitialized();

    const startTime = Date.now();
    const model = request.model || this.config.defaultModel;
    const controller = this.createAbortController(request.requestId);

    try {
      const timeoutMs = this.config.timeoutMs || 60000;
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      // Convert to LM Studio format
      const lmstudioMessages = this.convertMessagesToLMStudio(request.messages);
      const lmstudioTools = request.tools ? this.convertToolsToLMStudio(request.tools) : undefined;

      const lmstudioRequest: LMStudioRequest = {
        model,
        messages: lmstudioMessages,
        temperature: request.temperature,
        max_tokens: request.maxTokens,
        top_p: request.topP,
        stop: request.stopSequences,
        stream: false,
      };

      if (lmstudioTools) {
        lmstudioRequest.tools = lmstudioTools;
        if (typeof request.toolChoice === 'string') {
          // LMStudio doesn't support 'required', map to 'auto'
          lmstudioRequest.tool_choice = request.toolChoice === 'required' ? 'auto' : request.toolChoice;
        } else if (request.toolChoice && 'name' in request.toolChoice) {
          lmstudioRequest.tool_choice = {
            type: 'function',
            function: { name: request.toolChoice.name }
          };
        } else {
          lmstudioRequest.tool_choice = 'auto';
        }
      }

      const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(lmstudioRequest),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`LM Studio API error: ${response.status} ${errorText}`);
      }

      const data = (await response.json()) as LMStudioResponse;
      const durationMs = Date.now() - startTime;

      const choice = data.choices[0];
      const toolCalls = this.convertToolCallsFromLMStudio(choice.message.tool_calls);

      const metadata: ResponseMetadata = {
        durationMs,
        finishReason: this.mapFinishReason(choice.finish_reason),
        provider: this.type,
        model: data.model,
        requestId: request.requestId,
      };

      const usage: TokenUsage | undefined = data.usage
        ? {
            promptTokens: data.usage.prompt_tokens,
            completionTokens: data.usage.completion_tokens,
            totalTokens: data.usage.total_tokens,
          }
        : undefined;

      return {
        content: choice.message.content || '',
        toolCalls,
        usage,
        metadata,
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`LM Studio request timed out after ${this.config.timeoutMs}ms`);
      }
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

    const model = request.model || this.config.defaultModel;
    const controller = this.createAbortController(request.requestId);

    try {
      const timeoutMs = this.config.timeoutMs || 60000;
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const lmstudioMessages = this.convertMessagesToLMStudio(request.messages);
      const lmstudioTools = request.tools ? this.convertToolsToLMStudio(request.tools) : undefined;

      const lmstudioRequest: LMStudioRequest = {
        model,
        messages: lmstudioMessages,
        temperature: request.temperature,
        max_tokens: request.maxTokens,
        top_p: request.topP,
        stop: request.stopSequences,
        stream: true,
      };

      if (lmstudioTools) {
        lmstudioRequest.tools = lmstudioTools;
      }

      const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(lmstudioRequest),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`LM Studio API error: ${response.status} ${response.statusText}`);
      }

      if (!response.body) {
        throw new Error('Response body is null');
      }

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
          const trimmed = line.trim();
          if (!trimmed || trimmed === 'data: [DONE]') continue;

          if (trimmed.startsWith('data: ')) {
            try {
              const chunk = JSON.parse(trimmed.slice(6)) as LMStudioStreamChunk;
              const choice = chunk.choices[0];

              if (choice) {
                const unifiedChunk: UnifiedStreamChunk = {
                  content: choice.delta.content || '',
                  done: choice.finish_reason !== null,
                };

                if (choice.delta.tool_calls) {
                  unifiedChunk.toolCalls = choice.delta.tool_calls.map((tc) => ({
                    id: tc.id || `call_${Date.now()}_${tc.index}`,
                    name: tc.function?.name || '',
                    arguments: tc.function?.arguments || '',
                  }));
                }

                if (choice.finish_reason) {
                  unifiedChunk.metadata = {
                    provider: this.type,
                    model: chunk.model,
                    finishReason: this.mapFinishReason(choice.finish_reason),
                  };
                }

                yield unifiedChunk;
              }
            } catch (parseError) {
              logger.warn('LM Studio provider: Failed to parse stream chunk', { parseError });
            }
          }
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`LM Studio stream timed out after ${this.config.timeoutMs}ms`);
      }
      throw error;
    } finally {
      this.cleanupAbortController(request.requestId);
    }
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  private convertMessagesToLMStudio(messages: UnifiedMessage[]): LMStudioMessage[] {
    return messages.map((msg) => {
      const lmstudioMsg: LMStudioMessage = {
        role: msg.role,
        content:
          typeof msg.content === 'string'
            ? msg.content
            : msg.content
                .filter((p) => p.type === 'text')
                .map((p) => p.text)
                .join('\n'),
      };

      if (msg.toolCallId) {
        lmstudioMsg.tool_call_id = msg.toolCallId;
      }

      return lmstudioMsg;
    });
  }

  private convertToolsToLMStudio(tools: UnifiedTool[]): LMStudioTool[] {
    return tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters as unknown as Record<string, unknown>,
      },
    }));
  }

  private convertToolCallsFromLMStudio(
    toolCalls?: LMStudioToolCall[]
  ): UnifiedToolCall[] | undefined {
    if (!toolCalls || toolCalls.length === 0) return undefined;

    return toolCalls.map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: tc.function.arguments,
    }));
  }

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
      default:
        return 'stop';
    }
  }
}

/**
 * Create default LM Studio provider config
 */
export function createLMStudioConfig(overrides?: Partial<ProviderConfig>): ProviderConfig {
  return {
    type: 'lmstudio',
    enabled: true,
    baseUrl: 'http://localhost:1234/v1',
    defaultModel: 'local-model',
    models: [
      {
        id: 'local-model',
        provider: 'lmstudio',
        displayName: 'Local Model',
        contextWindow: 8192,
        maxOutputTokens: 4096,
        costPer1kInput: 0,
        costPer1kOutput: 0,
        capabilities: {
          streaming: true,
          toolCalling: true,
          vision: false,
          embeddings: false,
          jsonMode: true,
          functionCalling: true,
        },
        tags: ['local', 'fast'],
      },
    ],
    timeoutMs: 60000,
    maxRetries: 3,
    ...overrides,
  };
}
