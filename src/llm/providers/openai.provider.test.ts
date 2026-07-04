/**
 * OpenAI Provider Tests
 *
 * Comprehensive unit tests for the OpenAI LLM provider
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAIProvider } from './openai.provider';
import type {
  ProviderConfig,
  UnifiedChatRequest,
  ModelConfig,
} from '../../types/llm.types';

// ============================================================================
// Test Setup
// ============================================================================

const mockOpenAIModels: ModelConfig[] = [
  {
    id: 'gpt-4o-mini',
    provider: 'openai',
    displayName: 'GPT-4o Mini',
    contextWindow: 128000,
    maxOutputTokens: 16384,
    costPer1kInput: 0.00015,
    costPer1kOutput: 0.0006,
    capabilities: {
      streaming: true,
      toolCalling: true,
      vision: true,
      embeddings: false,
      jsonMode: true,
      functionCalling: true,
    },
    defaultTemperature: 1.0,
    tags: ['fast', 'cheap'],
  },
];

function createTestConfig(
  overrides?: Partial<ProviderConfig & { apiKey: string; organization?: string }>
): ProviderConfig & { apiKey: string; organization?: string } {
  return {
    type: 'openai',
    enabled: true,
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    models: mockOpenAIModels,
    timeoutMs: 60000,
    maxRetries: 3,
    apiKey: 'test-api-key',
    ...overrides,
  };
}

const originalFetch = global.fetch;

// ============================================================================
// Tests
// ============================================================================

describe('OpenAIProvider', () => {
  let provider: OpenAIProvider;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock as any;
    provider = new OpenAIProvider(createTestConfig());
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.clearAllMocks();
  });

  // ==========================================================================
  // Initialization Tests
  // ==========================================================================

  describe('Initialization', () => {
    it('should initialize successfully with valid config', async () => {
      // initialize() validates config and sets initialized flag, but doesn't make fetch calls
      await provider.initialize();
      expect((provider as any).initialized).toBe(true);
    });

    it('should throw error if API key is missing', () => {
      // Must provide models array to avoid length error, but omit apiKey
      expect(() => new OpenAIProvider({ models: [] } as any)).toThrow(
        'API key is required'
      );
    });

    it('should use default models if none provided', () => {
      const config = createTestConfig({ models: [] });
      const provider = new OpenAIProvider(config);
      expect(provider.config.models.length).toBeGreaterThan(0);
    });

    it('should include organization header if provided', () => {
      const providerWithOrg = new OpenAIProvider(
        createTestConfig({ organization: 'org-123' })
      );
      expect((providerWithOrg as any).organization).toBe('org-123');
    });
  });

  // ==========================================================================
  // Health Check Tests
  // ==========================================================================

  describe('Health Check', () => {
    it('should return healthy status when API is available', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            { id: 'gpt-4o-mini' },
            { id: 'gpt-4o' },
          ],
        }),
      });

      const health = await provider.healthCheck();

      expect(health.healthy).toBe(true);
      expect(health.provider).toBe('openai');
      expect(health.availableModels).toContain('gpt-4o-mini');
      expect(health.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('should return unhealthy status on API error', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
        json: async () => ({
          error: { message: 'Invalid API key', type: 'invalid_request_error', code: null },
        }),
      });

      const health = await provider.healthCheck();

      expect(health.healthy).toBe(false);
      expect(health.error).toBeDefined();
    });

    it('should return unhealthy status on network error', async () => {
      fetchMock.mockRejectedValueOnce(new Error('Network error'));

      const health = await provider.healthCheck();

      expect(health.healthy).toBe(false);
      expect(health.error).toContain('Network error');
    });

    it('should measure latency', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [] }),
      });

      const health = await provider.healthCheck();

      expect(health.latencyMs).toBeDefined();
      expect(health.latencyMs).toBeGreaterThanOrEqual(0);
    });
  });

  // ==========================================================================
  // Chat Completion Tests
  // ==========================================================================

  describe('Chat Completion', () => {
    beforeEach(async () => {
      // Note: initialize() doesn't make any fetch calls, it only validates config
      await provider.initialize();
    });

    it('should send basic chat request successfully', async () => {
      const mockResponse = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: 1234567890,
        model: 'gpt-4o-mini',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: 'Hello! How can I help you?',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 8,
          total_tokens: 18,
        },
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const request: UnifiedChatRequest = {
        messages: [{ role: 'user', content: 'Hello' }],
      };

      const response = await provider.chat(request);

      expect(response.content).toBe('Hello! How can I help you?');
      expect(response.usage?.promptTokens).toBe(10);
      expect(response.usage?.completionTokens).toBe(8);
      expect(response.metadata?.finishReason).toBe('stop');
    });

    it('should handle system messages', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'chatcmpl-123',
          object: 'chat.completion',
          created: 1234567890,
          model: 'gpt-4o-mini',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'Response' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 },
        }),
      });

      const request: UnifiedChatRequest = {
        messages: [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: 'Hello' },
        ],
      };

      await provider.chat(request);

      const sentRequest = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(sentRequest.messages).toHaveLength(2);
      expect(sentRequest.messages[0].role).toBe('system');
    });

    it('should handle vision messages', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'chatcmpl-123',
          object: 'chat.completion',
          created: 1234567890,
          model: 'gpt-4o-mini',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'I see an image' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 },
        }),
      });

      const request: UnifiedChatRequest = {
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'What is in this image?' },
              {
                type: 'image_url',
                image_url: { url: 'https://example.com/image.jpg' },
              },
            ],
          },
        ],
      };

      await provider.chat(request);

      const sentRequest = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(sentRequest.messages[0].content).toHaveLength(2);
      expect(sentRequest.messages[0].content[1].type).toBe('image_url');
    });

    it('should handle tool calls in response', async () => {
      const mockResponse = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: 1234567890,
        model: 'gpt-4o-mini',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_123',
                  type: 'function',
                  function: {
                    name: 'get_weather',
                    arguments: '{"location":"London"}',
                  },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
        usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 },
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const request: UnifiedChatRequest = {
        messages: [{ role: 'user', content: 'What is the weather in London?' }],
        tools: [
          {
            name: 'get_weather',
            description: 'Get weather for a location',
            parameters: {
              type: 'object',
              properties: {
                location: { type: 'string', description: 'City name' },
              },
              required: ['location'],
            },
          },
        ],
      };

      const response = await provider.chat(request);

      expect(response.toolCalls).toHaveLength(1);
      expect(response.toolCalls![0].name).toBe('get_weather');
      expect(response.toolCalls![0].id).toBe('call_123');
      expect(response.metadata?.finishReason).toBe('tool_calls');
    });

    it('should handle JSON mode', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'chatcmpl-123',
          object: 'chat.completion',
          created: 1234567890,
          model: 'gpt-4o-mini',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: '{"result": "success"}' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      });

      const request: UnifiedChatRequest = {
        messages: [{ role: 'user', content: 'Return JSON' }],
        jsonMode: true,
      };

      await provider.chat(request);

      const sentRequest = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(sentRequest.response_format).toEqual({ type: 'json_object' });
    });

    it('should respect custom temperature', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'chatcmpl-123',
          object: 'chat.completion',
          created: 1234567890,
          model: 'gpt-4o-mini',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'Response' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      });

      const request: UnifiedChatRequest = {
        messages: [{ role: 'user', content: 'Test' }],
        temperature: 0.5,
      };

      await provider.chat(request);

      const sentRequest = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(sentRequest.temperature).toBe(0.5);
    });

    it('should respect custom maxTokens', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'chatcmpl-123',
          object: 'chat.completion',
          created: 1234567890,
          model: 'gpt-4o-mini',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'Response' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      });

      const request: UnifiedChatRequest = {
        messages: [{ role: 'user', content: 'Test' }],
        maxTokens: 1000,
      };

      await provider.chat(request);

      const sentRequest = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(sentRequest.max_tokens).toBe(1000);
    });

    it('should throw error if provider not initialized', async () => {
      const uninitializedProvider = new OpenAIProvider(createTestConfig());

      await expect(
        uninitializedProvider.chat({
          messages: [{ role: 'user', content: 'Test' }],
        })
      ).rejects.toThrow('not initialized');
    });

    it('should throw error if model not found', async () => {
      const request: UnifiedChatRequest = {
        messages: [{ role: 'user', content: 'Test' }],
        model: 'nonexistent-model',
      };

      await expect(provider.chat(request)).rejects.toThrow('not found');
    });

    it('should throw error on API error response', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => 'Bad request',
        json: async () => ({
          error: {
            message: 'Invalid request',
            type: 'invalid_request_error',
            code: null,
          },
        }),
      });

      const request: UnifiedChatRequest = {
        messages: [{ role: 'user', content: 'Test' }],
      };

      await expect(provider.chat(request)).rejects.toThrow('OpenAI API error');
    });

    it('should handle timeout', async () => {
      fetchMock.mockImplementationOnce(() => {
        const error = new Error('The operation was aborted');
        error.name = 'AbortError';
        return Promise.reject(error);
      });

      const request: UnifiedChatRequest = {
        messages: [{ role: 'user', content: 'Test' }],
      };

      await expect(provider.chat(request)).rejects.toThrow('timeout or cancelled');
    });

    it('should include authorization header', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'chatcmpl-123',
          object: 'chat.completion',
          created: 1234567890,
          model: 'gpt-4o-mini',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'Response' },
              finish_reason: 'stop',
            },
          ],
        }),
      });

      const request: UnifiedChatRequest = {
        messages: [{ role: 'user', content: 'Test' }],
      };

      await provider.chat(request);

      const headers = fetchMock.mock.calls[0][1].headers;
      expect(headers.Authorization).toBe('Bearer test-api-key');
    });
  });

  // ==========================================================================
  // Retry Logic Tests
  // ==========================================================================

  describe('Retry Logic', () => {
    beforeEach(async () => {
      // Note: initialize() doesn't make any fetch calls, it only validates config
      await provider.initialize();
    });

    it('should retry on rate limit (429) error', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          headers: new Headers({ 'retry-after': '1' }),
          text: async () => 'Rate limited',
          json: async () => ({
            error: {
              message: 'Rate limit exceeded',
              type: 'rate_limit_error',
              code: null,
            },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            id: 'chatcmpl-123',
            object: 'chat.completion',
            created: 1234567890,
            model: 'gpt-4o-mini',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: 'Success after retry' },
                finish_reason: 'stop',
              },
            ],
          }),
        });

      const request: UnifiedChatRequest = {
        messages: [{ role: 'user', content: 'Test' }],
      };

      const response = await provider.chat(request);

      expect(response.content).toBe('Success after retry');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('should retry on network errors', async () => {
      // Use error message that triggers retry (must include 'fetch')
      fetchMock
        .mockRejectedValueOnce(new Error('fetch failed'))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            id: 'chatcmpl-123',
            object: 'chat.completion',
            created: 1234567890,
            model: 'gpt-4o-mini',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: 'Success after retry' },
                finish_reason: 'stop',
              },
            ],
          }),
        });

      const request: UnifiedChatRequest = {
        messages: [{ role: 'user', content: 'Test' }],
      };

      const response = await provider.chat(request);

      expect(response.content).toBe('Success after retry');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('should respect maxRetries limit', async () => {
      // Use 429 (rate limit) errors which trigger retry logic
      const rateLimitResponse = {
        ok: false,
        status: 429,
        headers: new Headers({ 'retry-after': '0' }),
        text: async () => 'Rate limited',
        json: async () => ({
          error: {
            message: 'Rate limit exceeded',
            type: 'rate_limit_error',
            code: null,
          },
        }),
      };

      // Set up to fail 3 times (maxRetries = 3)
      fetchMock
        .mockResolvedValueOnce(rateLimitResponse)
        .mockResolvedValueOnce(rateLimitResponse)
        .mockResolvedValueOnce(rateLimitResponse);

      const request: UnifiedChatRequest = {
        messages: [{ role: 'user', content: 'Test' }],
      };

      await expect(provider.chat(request)).rejects.toThrow('OpenAI API error');
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('should parse retry-after header', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          headers: new Headers({ 'retry-after': '2' }),
          text: async () => 'Rate limited',
          json: async () => ({
            error: {
              message: 'Rate limit exceeded',
              type: 'rate_limit_error',
              code: null,
            },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            id: 'chatcmpl-123',
            object: 'chat.completion',
            created: 1234567890,
            model: 'gpt-4o-mini',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: 'Success' },
                finish_reason: 'stop',
              },
            ],
          }),
        });

      const request: UnifiedChatRequest = {
        messages: [{ role: 'user', content: 'Test' }],
      };

      await provider.chat(request);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  // ==========================================================================
  // Streaming Tests
  // ==========================================================================

  describe('Streaming', () => {
    beforeEach(async () => {
      // Note: initialize() doesn't make any fetch calls, it only validates config
      await provider.initialize();
    });

    it('should handle streaming response', async () => {
      const chunks = [
        'data: {"id":"chatcmpl-123","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}\n\n',
        'data: {"id":"chatcmpl-123","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}\n\n',
        'data: {"id":"chatcmpl-123","choices":[{"index":0,"delta":{"content":" world"},"finish_reason":null}]}\n\n',
        'data: {"id":"chatcmpl-123","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
        'data: [DONE]\n\n',
      ];

      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(encoder.encode(chunk));
          }
          controller.close();
        },
      });

      fetchMock.mockResolvedValueOnce({
        ok: true,
        body: stream,
      });

      const request: UnifiedChatRequest = {
        messages: [{ role: 'user', content: 'Test' }],
      };

      const results: string[] = [];
      let doneChunk: any;

      for await (const chunk of provider.stream(request)) {
        if (!chunk.done) {
          if (chunk.content) {
            results.push(chunk.content);
          }
        } else {
          doneChunk = chunk;
        }
      }

      expect(results).toEqual(['Hello', ' world']);
      expect(doneChunk.done).toBe(true);
    });

    it('should handle streaming with tool calls', async () => {
      const chunks = [
        'data: {"id":"chatcmpl-123","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_123","type":"function","function":{"name":"get_weather"}}]},"finish_reason":null}]}\n\n',
        'data: {"id":"chatcmpl-123","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"location\\""}}]},"finish_reason":null}]}\n\n',
        'data: {"id":"chatcmpl-123","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":":\\"London\\"}"}}]},"finish_reason":null}]}\n\n',
        'data: {"id":"chatcmpl-123","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}\n\n',
        'data: [DONE]\n\n',
      ];

      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(encoder.encode(chunk));
          }
          controller.close();
        },
      });

      fetchMock.mockResolvedValueOnce({
        ok: true,
        body: stream,
      });

      const request: UnifiedChatRequest = {
        messages: [{ role: 'user', content: 'Weather?' }],
      };

      let finalChunk: any;
      for await (const chunk of provider.stream(request)) {
        if (chunk.done) {
          finalChunk = chunk;
        }
      }

      expect(finalChunk.toolCalls).toBeDefined();
      expect(finalChunk.toolCalls![0].name).toBe('get_weather');
      expect(finalChunk.toolCalls![0].arguments).toContain('London');
    });

    it('should handle streaming error', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Server error',
        json: async () => ({
          error: {
            message: 'Internal server error',
            type: 'server_error',
            code: null,
          },
        }),
      });

      const request: UnifiedChatRequest = {
        messages: [{ role: 'user', content: 'Test' }],
      };

      const iterator = provider.stream(request);
      await expect(iterator.next()).rejects.toThrow('OpenAI API error');
    });

    it('should throw error if response body is null', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        body: null,
      });

      const request: UnifiedChatRequest = {
        messages: [{ role: 'user', content: 'Test' }],
      };

      const iterator = provider.stream(request);
      await expect(iterator.next()).rejects.toThrow('Response body is null');
    });

    it('should skip empty lines in stream', async () => {
      const chunks = [
        '\n',
        '   \n',
        'data: {"id":"chatcmpl-123","choices":[{"index":0,"delta":{"content":"Test"},"finish_reason":null}]}\n\n',
        '\n',
        'data: [DONE]\n\n',
      ];

      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(encoder.encode(chunk));
          }
          controller.close();
        },
      });

      fetchMock.mockResolvedValueOnce({
        ok: true,
        body: stream,
      });

      const request: UnifiedChatRequest = {
        messages: [{ role: 'user', content: 'Test' }],
      };

      const results: string[] = [];
      for await (const chunk of provider.stream(request)) {
        if (chunk.content) {
          results.push(chunk.content);
        }
      }

      expect(results).toEqual(['Test']);
    });

    it('should handle malformed JSON gracefully', async () => {
      const chunks = [
        'data: invalid json\n\n',
        'data: {"id":"chatcmpl-123","choices":[{"index":0,"delta":{"content":"Valid"},"finish_reason":"stop"}]}\n\n',
        'data: [DONE]\n\n',
      ];

      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(encoder.encode(chunk));
          }
          controller.close();
        },
      });

      fetchMock.mockResolvedValueOnce({
        ok: true,
        body: stream,
      });

      const request: UnifiedChatRequest = {
        messages: [{ role: 'user', content: 'Test' }],
      };

      const results: string[] = [];
      for await (const chunk of provider.stream(request)) {
        if (chunk.content) {
          results.push(chunk.content);
        }
      }

      // At least one "Valid" result should be captured (malformed JSON skipped)
      expect(results.filter((r) => r === 'Valid').length).toBeGreaterThanOrEqual(1);
    });

    it('should fallback to non-streaming for models without streaming capability', async () => {
      const o1Model: ModelConfig = {
        id: 'o1',
        provider: 'openai',
        displayName: 'O1',
        contextWindow: 200000,
        maxOutputTokens: 100000,
        costPer1kInput: 0.015,
        costPer1kOutput: 0.06,
        capabilities: {
          streaming: false,
          toolCalling: false,
          vision: false,
          embeddings: false,
          jsonMode: false,
          functionCalling: false,
        },
        defaultTemperature: 1.0,
        tags: ['reasoning'],
      };

      const providerWithO1 = new OpenAIProvider(
        createTestConfig({ models: [o1Model] })
      );

      // initialize() doesn't make fetch calls
      await providerWithO1.initialize();

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'chatcmpl-123',
          object: 'chat.completion',
          created: 1234567890,
          model: 'o1',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'Full response' },
              finish_reason: 'stop',
            },
          ],
        }),
      });

      const request: UnifiedChatRequest = {
        messages: [{ role: 'user', content: 'Test' }],
        model: 'o1',
      };

      const results: string[] = [];
      for await (const chunk of providerWithO1.stream(request)) {
        results.push(chunk.content);
      }

      expect(results).toEqual(['Full response']);
    });
  });

  // ==========================================================================
  // Static Methods Tests
  // ==========================================================================

  describe('Static Methods', () => {
    it('should return default models', () => {
      const models = OpenAIProvider.getDefaultModels();
      expect(models.length).toBeGreaterThan(0);
      expect(models[0].provider).toBe('openai');
    });

    it('should include GPT-4o and GPT-4o-mini models', () => {
      const models = OpenAIProvider.getDefaultModels();
      const modelIds = models.map((m) => m.id);
      expect(modelIds).toContain('gpt-4o');
      expect(modelIds).toContain('gpt-4o-mini');
    });

    it('should include O1 reasoning models', () => {
      const models = OpenAIProvider.getDefaultModels();
      const modelIds = models.map((m) => m.id);
      expect(modelIds).toContain('o1');
      expect(modelIds).toContain('o1-mini');
    });
  });

  // ==========================================================================
  // Error Handling Tests
  // ==========================================================================

  describe('Error Handling', () => {
    beforeEach(async () => {
      // Note: initialize() doesn't make any fetch calls, it only validates config
      await provider.initialize();
    });

    it('should handle network errors', async () => {
      fetchMock.mockRejectedValueOnce(new Error('Network error'));

      const request: UnifiedChatRequest = {
        messages: [{ role: 'user', content: 'Test' }],
      };

      await expect(provider.chat(request)).rejects.toThrow();
    });

    it('should cleanup abort controller after request', async () => {
      const mockResponse = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: 1234567890,
        model: 'gpt-4o-mini',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Response' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      };

      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      const request: UnifiedChatRequest = {
        messages: [{ role: 'user', content: 'Test' }],
        requestId: 'test-123',
      };

      await provider.chat(request);

      expect((provider as any).abortControllers.has('test-123')).toBe(false);
    });

    it('should handle error response without JSON', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 502,
        statusText: 'Bad Gateway',
        text: async () => 'Bad Gateway',
        json: async () => {
          throw new Error('Not JSON');
        },
      });

      const request: UnifiedChatRequest = {
        messages: [{ role: 'user', content: 'Test' }],
      };

      await expect(provider.chat(request)).rejects.toThrow('502');
    });
  });

  // ==========================================================================
  // Configuration Tests
  // ==========================================================================

  describe('Configuration', () => {
    it('should use custom base URL', () => {
      const customProvider = new OpenAIProvider(
        createTestConfig({ baseUrl: 'https://custom.openai.com/v1' })
      );
      expect((customProvider as any).baseUrl).toBe('https://custom.openai.com/v1');
    });

    it('should use default base URL if not provided', () => {
      const config = createTestConfig();
      delete (config as any).baseUrl;
      const customProvider = new OpenAIProvider(config);
      expect((customProvider as any).baseUrl).toBe('https://api.openai.com/v1');
    });

    it('should include organization header when provided', async () => {
      const providerWithOrg = new OpenAIProvider(
        createTestConfig({ organization: 'org-123' })
      );

      // initialize() doesn't make fetch calls, just validates config
      await providerWithOrg.initialize();

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'chatcmpl-123',
          object: 'chat.completion',
          created: 1234567890,
          model: 'gpt-4o-mini',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'Response' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      });

      await providerWithOrg.chat({
        messages: [{ role: 'user', content: 'Test' }],
      });

      const headers = fetchMock.mock.calls[0][1].headers;
      expect(headers['OpenAI-Organization']).toBe('org-123');
    });
  });
});
