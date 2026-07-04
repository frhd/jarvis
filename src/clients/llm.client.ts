import { logger } from '../utils/logger';
import { safeJsonParse } from '../utils/index.js';
import { LLMError } from '../errors/error-classes.js';
import { LONG_CONTENT_PREVIEW_LENGTH } from '../config/constants.js';
import { trackOllamaRequestStart, trackOllamaRequestEnd } from '../utils/ollama-load-tracker.js';

export interface LLMConfig {
  baseUrl: string;
  model: string;
  timeoutMs: number;
  maxRetries: number;
  temperature: number;
  maxTokens: number;
  keepAlive?: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMResponse {
  content: string;
  model: string;
  totalDuration?: number;
  promptEvalCount?: number;
  evalCount?: number;
}

export interface LLMHealthStatus {
  healthy: boolean;
  model: string;
  error?: string;
}

// Tool calling interfaces (Ollama format)
export interface ToolFunction {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, { type: string; description?: string }>;
    required?: string[];
  };
}

export interface Tool {
  type: 'function';
  function: ToolFunction;
}

export interface ToolCall {
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

export interface ChatMessageWithToolCalls extends ChatMessage {
  tool_calls?: ToolCall[];
}

export interface ToolResultMessage {
  role: 'tool';
  content: string;
}

export type ChatMessageOrToolResult = ChatMessage | ChatMessageWithToolCalls | ToolResultMessage;

export interface LLMResponseWithToolCalls extends LLMResponse {
  toolCalls?: ToolCall[];
}

/** Health check timeout in milliseconds */
const HEALTH_CHECK_TIMEOUT_MS = 5000;

export class LLMClient {
  private config: LLMConfig;
  private abortControllers: Map<string, AbortController> = new Map();

  constructor(config: LLMConfig) {
    this.config = config;
  }

  async chat(messages: ChatMessage[], requestId?: string, options?: { maxTokens?: number }): Promise<LLMResponse> {
    const controller = new AbortController();
    if (requestId) {
      this.abortControllers.set(requestId, controller);
    }

    const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);
    trackOllamaRequestStart();

    try {
      const response = await fetch(`${this.config.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.config.model,
          messages,
          stream: false,
          keep_alive: this.config.keepAlive || '30m',
          options: {
            temperature: this.config.temperature,
            num_predict: options?.maxTokens ?? this.config.maxTokens,
          },
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`LLM API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      return {
        content: data.message?.content || '',
        model: data.model,
        totalDuration: data.total_duration,
        promptEvalCount: data.prompt_eval_count,
        evalCount: data.eval_count,
      };
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`LLM request timed out after ${this.config.timeoutMs}ms`);
      }
      throw error;
    } finally {
      trackOllamaRequestEnd();
      // CRITICAL FIX: Always clean up the abort controller, even when aborted
      // This prevents memory leak where aborted requests accumulate in the Map
      if (requestId) {
        this.abortControllers.delete(requestId);
      }
    }
  }

  async chatWithTools(
    messages: ChatMessageOrToolResult[],
    tools: Tool[],
    requestId?: string,
    options?: { maxTokens?: number }
  ): Promise<LLMResponseWithToolCalls> {
    const controller = new AbortController();
    if (requestId) {
      this.abortControllers.set(requestId, controller);
    }

    const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);
    trackOllamaRequestStart();

    try {
      const response = await fetch(`${this.config.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.config.model,
          messages,
          tools,
          stream: false,
          keep_alive: this.config.keepAlive || '30m',
          options: {
            temperature: this.config.temperature,
            num_predict: options?.maxTokens ?? this.config.maxTokens,
          },
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`LLM API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      // Parse tool calls from response
      const toolCalls: ToolCall[] | undefined = data.message?.tool_calls?.map(
        (tc: { function: { name: string; arguments: unknown } }) => {
          let args = tc.function.arguments;
          const functionName = tc.function.name;

          // Ollama returns arguments as object or stringified JSON
          if (typeof args === 'string') {
            const parsed = safeJsonParse(args);
            if (parsed === null) {
              // Log with proper error class for visibility
              const parseError = LLMError.toolArgumentParseError(
                functionName,
                args,
                { model: data.model }
              );
              logger.error('[LLM Client] Tool argument parse error', {
                error: parseError.message,
                functionName,
                rawArgs: args.length > LONG_CONTENT_PREVIEW_LENGTH
                  ? args.slice(0, LONG_CONTENT_PREVIEW_LENGTH) + '...'
                  : args,
                model: data.model,
              });

              // Return empty args as fallback to allow processing to continue
              // The tool executor will handle invalid arguments appropriately
              args = {};
            } else {
              args = parsed;
            }
          }

          // Validate that arguments is an object
          if (args && typeof args !== 'object') {
            logger.warn('[LLM Client] Tool call arguments are not an object', {
              functionName,
              argsType: typeof args,
            });
            args = {};
          }

          return {
            function: {
              name: functionName,
              arguments: args as Record<string, unknown>,
            },
          };
        }
      );

      return {
        content: data.message?.content || '',
        model: data.model,
        totalDuration: data.total_duration,
        promptEvalCount: data.prompt_eval_count,
        evalCount: data.eval_count,
        toolCalls: toolCalls?.length ? toolCalls : undefined,
      };
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`LLM request timed out after ${this.config.timeoutMs}ms`);
      }
      throw error;
    } finally {
      trackOllamaRequestEnd();
      if (requestId) {
        this.abortControllers.delete(requestId);
      }
    }
  }

  async healthCheck(): Promise<LLMHealthStatus> {
    try {
      const response = await fetch(`${this.config.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
      });

      if (!response.ok) {
        return { healthy: false, model: this.config.model, error: 'Ollama not responding' };
      }

      const data = await response.json();
      const modelLoaded = data.models?.some(
        (m: { name: string }) => m.name.includes(this.config.model.split(':')[0])
      );

      return {
        healthy: true,
        model: this.config.model,
        error: modelLoaded ? undefined : 'Model not loaded (will load on first request)',
      };
    } catch (error) {
      return {
        healthy: false,
        model: this.config.model,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  cancelRequest(requestId: string): void {
    const controller = this.abortControllers.get(requestId);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(requestId);
    }
  }
}
