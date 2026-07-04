/**
 * Google Gemini LLM Provider
 *
 * Implements the unified LLM provider interface for Google's Gemini models
 * Supports: Chat completions, streaming, function calling, vision
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
  ModelConfig,
} from '../../types/llm.types';
import { createLogger } from '../../utils/logger.js';
import { HEALTH_CHECK_TIMEOUT_MS } from '../../config/constants.js';

const logger = createLogger('GeminiProvider');

/**
 * Gemini API request types
 */
interface GeminiContent {
  parts: Array<{ text?: string; inline_data?: { mime_type: string; data: string } }>;
  role: 'user' | 'model';
}

interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface GeminiRequest {
  contents: GeminiContent[];
  generationConfig?: {
    temperature?: number;
    maxOutputTokens?: number;
    topP?: number;
    topK?: number;
    stopSequences?: string[];
  };
  tools?: Array<{
    functionDeclarations: GeminiFunctionDeclaration[];
  }>;
}

interface GeminiCandidate {
  content: {
    parts: Array<{
      text?: string;
      functionCall?: {
        name: string;
        args: Record<string, unknown>;
      };
    }>;
    role: string;
  };
  finishReason: 'STOP' | 'MAX_TOKENS' | 'SAFETY' | 'RECITATION' | 'OTHER';
  index: number;
}

interface GeminiResponse {
  candidates: GeminiCandidate[];
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
}

/**
 * Gemini provider configuration
 */
export interface GeminiProviderConfig extends ProviderConfig {
  type: 'gemini';
  apiKey: string;
  baseUrl?: string;
  projectId?: string;
}

/**
 * Default Gemini models configuration
 */
const GEMINI_MODELS: ModelConfig[] = [
  {
    id: 'gemini-2.0-flash',
    provider: 'gemini',
    displayName: 'Gemini 2.0 Flash',
    contextWindow: 1048576, // 1M tokens
    maxOutputTokens: 8192,
    costPer1kInput: 0.000075, // $0.075 per 1M tokens
    costPer1kOutput: 0.0003, // $0.30 per 1M tokens
    capabilities: {
      streaming: true,
      toolCalling: true,
      functionCalling: true,
      vision: true,
      embeddings: false,
      jsonMode: true,
    },
    defaultTemperature: 0.7,
    tags: ['fast', 'cheap', 'multimodal', 'latest'],
  },
  {
    id: 'gemini-2.0-flash-thinking',
    provider: 'gemini',
    displayName: 'Gemini 2.0 Flash Thinking',
    contextWindow: 32768,
    maxOutputTokens: 8192,
    costPer1kInput: 0, // Free tier
    costPer1kOutput: 0, // Free tier
    capabilities: {
      streaming: true,
      toolCalling: true,
      functionCalling: true,
      vision: true,
      embeddings: false,
      jsonMode: true,
    },
    defaultTemperature: 1.0,
    tags: ['thinking', 'reasoning', 'free', 'latest'],
  },
  {
    id: 'gemini-1.5-pro',
    provider: 'gemini',
    displayName: 'Gemini 1.5 Pro',
    contextWindow: 2097152, // 2M tokens
    maxOutputTokens: 8192,
    costPer1kInput: 0.00125, // $1.25 per 1M tokens
    costPer1kOutput: 0.005, // $5.00 per 1M tokens
    capabilities: {
      streaming: true,
      toolCalling: true,
      functionCalling: true,
      vision: true,
      embeddings: false,
      jsonMode: true,
    },
    defaultTemperature: 0.7,
    tags: ['large-context', 'multimodal', 'powerful'],
  },
  {
    id: 'gemini-1.5-flash',
    provider: 'gemini',
    displayName: 'Gemini 1.5 Flash',
    contextWindow: 1048576, // 1M tokens
    maxOutputTokens: 8192,
    costPer1kInput: 0.000075, // $0.075 per 1M tokens
    costPer1kOutput: 0.0003, // $0.30 per 1M tokens
    capabilities: {
      streaming: true,
      toolCalling: true,
      functionCalling: true,
      vision: true,
      embeddings: false,
      jsonMode: true,
    },
    defaultTemperature: 0.7,
    tags: ['fast', 'cheap', 'multimodal'],
  },
];

/**
 * Google Gemini LLM Provider
 */
export class GeminiProvider extends BaseLLMProvider {
  readonly type: LLMProviderType = 'gemini';
  private apiKey: string;
  private baseUrl: string;

  constructor(config: Partial<GeminiProviderConfig>) {
    const fullConfig: ProviderConfig = {
      type: 'gemini',
      enabled: config.enabled ?? true,
      apiKey: config.apiKey ?? '',
      baseUrl: config.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta',
      defaultModel: config.defaultModel ?? 'gemini-2.0-flash',
      models: config.models ?? GEMINI_MODELS,
      timeoutMs: config.timeoutMs ?? 60000,
      maxRetries: config.maxRetries ?? 3,
      projectId: config.projectId,
    };

    super(fullConfig);

    this.apiKey = fullConfig.apiKey ?? '';
    this.baseUrl = fullConfig.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta';
  }

  /**
   * Validate Gemini configuration
   */
  protected async validateConfig(): Promise<void> {
    await super.validateConfig();

    if (!this.apiKey) {
      throw new Error('Gemini API key is required');
    }

    logger.info('Gemini configuration validated');
  }

  /**
   * Health check - verifies API connectivity
   */
  async healthCheck(): Promise<ProviderHealthStatus> {
    const startTime = Date.now();

    try {
      // Use a simple list models request for health check
      const url = `${this.baseUrl}/models?key=${this.apiKey}`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);

      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(`Gemini health check failed: ${response.status} ${errorText}`);
        return {
          provider: this.type,
          healthy: false,
          error: `HTTP ${response.status}: ${errorText}`,
          lastChecked: new Date(),
        };
      }

      const data = await response.json();
      const availableModels = data.models?.map((m: { name: string }) => m.name.split('/').pop()) || [];

      const latencyMs = Date.now() - startTime;

      return {
        provider: this.type,
        healthy: true,
        latencyMs,
        availableModels,
        lastChecked: new Date(),
      };
    } catch (error) {
      logger.error('Gemini health check error:', error);
      return {
        provider: this.type,
        healthy: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        lastChecked: new Date(),
      };
    }
  }

  /**
   * Convert unified messages to Gemini format
   */
  private convertMessages(messages: UnifiedMessage[]): GeminiContent[] {
    const geminiContents: GeminiContent[] = [];

    for (const msg of messages) {
      // Skip system messages - Gemini doesn't support them in the same way
      // We'll prepend system content to the first user message instead
      if (msg.role === 'system') {
        continue;
      }

      const role = msg.role === 'assistant' ? 'model' : 'user';
      const parts: GeminiContent['parts'] = [];

      if (typeof msg.content === 'string') {
        parts.push({ text: msg.content });
      } else {
        for (const part of msg.content) {
          if (part.type === 'text' && part.text) {
            parts.push({ text: part.text });
          } else if (part.type === 'image_url' && part.image_url) {
            // Convert image URL to inline data format
            const url = part.image_url.url;
            if (url.startsWith('data:')) {
              // Extract mime type and base64 data
              const match = url.match(/^data:([^;]+);base64,(.+)$/);
              if (match) {
                parts.push({
                  inline_data: {
                    mime_type: match[1],
                    data: match[2],
                  },
                });
              }
            } else {
              logger.warn('Gemini only supports base64 inline images, external URLs not supported');
            }
          }
        }
      }

      if (parts.length > 0) {
        geminiContents.push({ parts, role });
      }
    }

    // Prepend system message to first user message if it exists
    const systemMsg = messages.find((m) => m.role === 'system');
    if (systemMsg && geminiContents.length > 0 && geminiContents[0].role === 'user') {
      const systemText = typeof systemMsg.content === 'string' ? systemMsg.content : '';
      if (systemText && geminiContents[0].parts[0]?.text) {
        geminiContents[0].parts[0].text = `${systemText}\n\n${geminiContents[0].parts[0].text}`;
      }
    }

    return geminiContents;
  }

  /**
   * Convert unified tools to Gemini function declarations
   */
  private convertTools(tools: UnifiedChatRequest['tools']): GeminiRequest['tools'] {
    if (!tools || tools.length === 0) {
      return undefined;
    }

    const functionDeclarations: GeminiFunctionDeclaration[] = tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: {
        type: 'object',
        properties: tool.parameters.properties || {},
        required: tool.parameters.required,
      },
    }));

    return [{ functionDeclarations }];
  }

  /**
   * Parse Gemini response to unified format
   */
  private parseResponse(
    response: GeminiResponse,
    modelId: string,
    durationMs: number
  ): UnifiedChatResponse {
    const candidate = response.candidates?.[0];

    if (!candidate) {
      throw new Error('No candidate in Gemini response');
    }

    let content = '';
    const toolCalls: UnifiedToolCall[] = [];

    for (const part of candidate.content.parts) {
      if (part.text) {
        content += part.text;
      } else if (part.functionCall) {
        toolCalls.push({
          id: `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          name: part.functionCall.name,
          arguments: JSON.stringify(part.functionCall.args),
        });
      }
    }

    const usage: TokenUsage | undefined = response.usageMetadata
      ? {
          promptTokens: response.usageMetadata.promptTokenCount,
          completionTokens: response.usageMetadata.candidatesTokenCount,
          totalTokens: response.usageMetadata.totalTokenCount,
        }
      : undefined;

    const finishReasonMap: Record<string, UnifiedChatResponse['metadata']['finishReason']> = {
      STOP: 'stop',
      MAX_TOKENS: 'length',
      SAFETY: 'content_filter',
      RECITATION: 'content_filter',
      OTHER: 'error',
    };

    return {
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage,
      metadata: {
        durationMs,
        finishReason: finishReasonMap[candidate.finishReason] || 'stop',
        provider: this.type,
        model: modelId,
      },
    };
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
      throw new Error(`Model ${modelId} not found in Gemini provider`);
    }

    logger.debug(`Starting chat request with model: ${modelId}`);

    const geminiRequest: GeminiRequest = {
      contents: this.convertMessages(request.messages),
      generationConfig: {
        temperature: request.temperature,
        maxOutputTokens: request.maxTokens,
        topP: request.topP,
        topK: request.topK,
        stopSequences: request.stopSequences,
      },
      tools: this.convertTools(request.tools),
    };

    const url = `${this.baseUrl}/models/${modelId}:generateContent?key=${this.apiKey}`;

    try {
      const controller = this.createAbortController(request.requestId);
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(geminiRequest),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      this.cleanupAbortController(request.requestId);

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(`Gemini API error: ${response.status} ${errorText}`);
        throw new Error(`Gemini API error: ${response.status} ${errorText}`);
      }

      const data: GeminiResponse = await response.json();
      const durationMs = Date.now() - startTime;

      logger.debug(`Chat request completed in ${durationMs}ms`);

      return this.parseResponse(data, modelId, durationMs);
    } catch (error) {
      this.cleanupAbortController(request.requestId);

      if (error instanceof Error && error.name === 'AbortError') {
        logger.warn('Chat request aborted');
        throw new Error('Request aborted');
      }

      logger.error('Chat request failed:', error);
      throw error;
    }
  }

  /**
   * Stream chat completion
   */
  async *stream(request: UnifiedChatRequest): AsyncIterable<UnifiedStreamChunk> {
    this.ensureInitialized();

    const startTime = Date.now();
    const modelId = request.model || this.config.defaultModel;
    const model = this.getModel(modelId);

    if (!model) {
      throw new Error(`Model ${modelId} not found in Gemini provider`);
    }

    logger.debug(`Starting streaming request with model: ${modelId}`);

    const geminiRequest: GeminiRequest = {
      contents: this.convertMessages(request.messages),
      generationConfig: {
        temperature: request.temperature,
        maxOutputTokens: request.maxTokens,
        topP: request.topP,
        topK: request.topK,
        stopSequences: request.stopSequences,
      },
      tools: this.convertTools(request.tools),
    };

    const url = `${this.baseUrl}/models/${modelId}:streamGenerateContent?key=${this.apiKey}&alt=sse`;

    try {
      const controller = this.createAbortController(request.requestId);
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(geminiRequest),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(`Gemini streaming API error: ${response.status} ${errorText}`);
        this.cleanupAbortController(request.requestId);
        throw new Error(`Gemini streaming API error: ${response.status} ${errorText}`);
      }

      if (!response.body) {
        this.cleanupAbortController(request.requestId);
        throw new Error('No response body for streaming');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let totalContent = '';
      let usage: TokenUsage | undefined;

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
            if (!line.trim() || !line.startsWith('data: ')) {
              continue;
            }

            const jsonStr = line.slice(6).trim();
            if (!jsonStr) {
              continue;
            }

            try {
              const data: GeminiResponse = JSON.parse(jsonStr);
              const candidate = data.candidates?.[0];

              if (!candidate) {
                continue;
              }

              let chunkContent = '';
              for (const part of candidate.content.parts) {
                if (part.text) {
                  chunkContent += part.text;
                }
              }

              if (chunkContent) {
                totalContent += chunkContent;
                yield {
                  content: chunkContent,
                  done: false,
                };
              }

              // Update usage if available
              if (data.usageMetadata) {
                usage = {
                  promptTokens: data.usageMetadata.promptTokenCount,
                  completionTokens: data.usageMetadata.candidatesTokenCount,
                  totalTokens: data.usageMetadata.totalTokenCount,
                };
              }
            } catch (parseError) {
              logger.warn('Failed to parse streaming chunk:', parseError);
            }
          }
        }

        // Final chunk
        const durationMs = Date.now() - startTime;
        yield {
          content: '',
          done: true,
          usage,
          metadata: {
            durationMs,
            finishReason: 'stop',
            provider: this.type,
            model: modelId,
          },
        };

        logger.debug(`Streaming request completed in ${durationMs}ms`);
      } finally {
        reader.releaseLock();
        this.cleanupAbortController(request.requestId);
      }
    } catch (error) {
      this.cleanupAbortController(request.requestId);

      if (error instanceof Error && error.name === 'AbortError') {
        logger.warn('Streaming request aborted');
        throw new Error('Request aborted');
      }

      logger.error('Streaming request failed:', error);
      throw error;
    }
  }
}

/**
 * Create a Gemini provider instance
 */
export function createGeminiProvider(config: Partial<GeminiProviderConfig>): GeminiProvider {
  return new GeminiProvider(config);
}
