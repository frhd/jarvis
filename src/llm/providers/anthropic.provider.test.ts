/**
 * Anthropic Provider Tests
 *
 * Comprehensive unit tests for the Anthropic Claude LLM provider
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AnthropicProvider, createAnthropicProvider } from './anthropic.provider';
import type {
  ProviderConfig,
  UnifiedChatRequest,
  ModelConfig,
} from '../../types/llm.types';

// ============================================================================
// Test Setup
// ============================================================================

const mockAnthropicModels: ModelConfig[] = [
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
    tags: ['fast', 'smart'],
  },
];

function createTestConfig(overrides?: Partial<ProviderConfig>): ProviderConfig & { apiKey: string } {
  return {
    type: 'anthropic',
    enabled: true,
    baseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-sonnet-4-20250514',
    models: mockAnthropicModels,
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

describe('AnthropicProvider', () => {
  let provider: AnthropicProvider;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock as any;
    provider = new AnthropicProvider(createTestConfig());
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
      await expect(provider.initialize()).resolves.not.toThrow();
      expect(provider.config.models.length).toBeGreaterThan(0);
    });

    it('should throw error if API key is missing', async () => {
      const config = createTestConfig({ models: [] });
      delete (config as any).apiKey;

      const invalidProvider = new AnthropicProvider(config as any);
      await expect(invalidProvider.initialize()).rejects.toThrow('API key is required');
    });

    it('should validate config during initialization', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'msg_test',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'Hi' }],
          model: 'claude-sonnet-4-20250514',
          stop_reason: 'end_turn',
          usage: { input_tokens: 5, output_tokens: 1 },
        }),
      });

      await expect(provider.initialize()).resolves.not.toThrow();
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
          id: 'msg_test',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'Hi' }],
          model: 'claude-sonnet-4-20250514',
          stop_reason: 'end_turn',
          usage: { input_tokens: 5, output_tokens: 1 },
        }),
      });

      const health = await provider.healthCheck();

      expect(health.healthy).toBe(true);
      expect(health.provider).toBe('anthropic');
      expect(health.latencyMs).toBeGreaterThanOrEqual(0);
      expect(health.availableModels).toContain('claude-sonnet-4-20250514');
    });

    it('should return unhealthy status on API error', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      });

      const health = await provider.healthCheck();

      expect(health.healthy).toBe(false);
      expect(health.error).toContain('401');
    });

    it('should return unhealthy status on network error', async () => {
      fetchMock.mockRejectedValueOnce(new Error('Connection refused'));

      const health = await provider.healthCheck();

      expect(health.healthy).toBe(false);
      expect(health.error).toContain('Connection refused');
    });

    it('should include latency measurement', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'msg_test',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'Hi' }],
          model: 'claude-sonnet-4-20250514',
          stop_reason: 'end_turn',
          usage: { input_tokens: 5, output_tokens: 1 },
        }),
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
      await provider.initialize();
    });

    it('should send basic chat request successfully', async () => {
      const mockResponse = {
        id: 'msg_123',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello! How can I help you?' }],
        model: 'claude-sonnet-4-20250514',
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 8 },
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

    it('should handle system messages correctly', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'msg_123',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'Response' }],
          model: 'claude-sonnet-4-20250514',
          stop_reason: 'end_turn',
          usage: { input_tokens: 20, output_tokens: 5 },
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
      expect(sentRequest.system).toBe('You are a helpful assistant.');
      expect(sentRequest.messages).toHaveLength(1);
      expect(sentRequest.messages[0].role).toBe('user');
    });

    it('should combine multiple system messages', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'msg_123',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'Response' }],
          model: 'claude-sonnet-4-20250514',
          stop_reason: 'end_turn',
          usage: { input_tokens: 20, output_tokens: 5 },
        }),
      });

      const request: UnifiedChatRequest = {
        messages: [
          { role: 'system', content: 'System message 1' },
          { role: 'system', content: 'System message 2' },
          { role: 'user', content: 'Hello' },
        ],
      };

      await provider.chat(request);

      const sentRequest = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(sentRequest.system).toContain('System message 1');
      expect(sentRequest.system).toContain('System message 2');
    });

    it('should handle vision messages with base64 images', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'msg_123',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'I see an image' }],
          model: 'claude-sonnet-4-20250514',
          stop_reason: 'end_turn',
          usage: { input_tokens: 100, output_tokens: 10 },
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
                image_url: {
                  url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
                },
              },
            ],
          },
        ],
      };

      await provider.chat(request);

      const sentRequest = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(sentRequest.messages[0].content).toHaveLength(2);
      expect(sentRequest.messages[0].content[1].type).toBe('image');
      expect(sentRequest.messages[0].content[1].source.type).toBe('base64');
    });

    it('should handle tool calls in response', async () => {
      const mockResponse = {
        id: 'msg_123',
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'tool_123',
            name: 'get_weather',
            input: { location: 'London' },
          },
        ],
        model: 'claude-sonnet-4-20250514',
        stop_reason: 'tool_use',
        usage: { input_tokens: 50, output_tokens: 20 },
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
      expect(response.toolCalls![0].id).toBe('tool_123');
      expect(response.metadata?.finishReason).toBe('tool_calls');
    });

    it('should handle mixed text and tool use content', async () => {
      const mockResponse = {
        id: 'msg_123',
        type: 'message',
        role: 'assistant',
        content: [
          { type: 'text', text: 'Let me check the weather for you.' },
          {
            type: 'tool_use',
            id: 'tool_123',
            name: 'get_weather',
            input: { location: 'London' },
          },
        ],
        model: 'claude-sonnet-4-20250514',
        stop_reason: 'tool_use',
        usage: { input_tokens: 50, output_tokens: 30 },
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const request: UnifiedChatRequest = {
        messages: [{ role: 'user', content: 'What is the weather in London?' }],
      };

      const response = await provider.chat(request);

      expect(response.content).toBe('Let me check the weather for you.');
      expect(response.toolCalls).toHaveLength(1);
    });

    it('should handle tool result messages', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'msg_123',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'The weather is sunny.' }],
          model: 'claude-sonnet-4-20250514',
          stop_reason: 'end_turn',
          usage: { input_tokens: 100, output_tokens: 15 },
        }),
      });

      const request: UnifiedChatRequest = {
        messages: [
          { role: 'user', content: 'Weather in London?' },
          { role: 'assistant', content: '' },
          {
            role: 'tool',
            content: '{"temperature": 72, "condition": "sunny"}',
            toolCallId: 'tool_123',
          },
        ],
      };

      await provider.chat(request);

      const sentRequest = JSON.parse(fetchMock.mock.calls[0][1].body);
      const toolResultMsg = sentRequest.messages.find(
        (m: any) => m.content[0]?.type === 'tool_result'
      );
      expect(toolResultMsg).toBeDefined();
      expect(toolResultMsg.content[0].tool_use_id).toBe('tool_123');
    });

    it('should respect custom temperature', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'msg_123',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'Response' }],
          model: 'claude-sonnet-4-20250514',
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 5 },
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
          id: 'msg_123',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'Response' }],
          model: 'claude-sonnet-4-20250514',
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 5 },
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
      const uninitializedProvider = new AnthropicProvider(createTestConfig());

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
        status: 429,
        text: async () => 'Rate limit exceeded',
      });

      const request: UnifiedChatRequest = {
        messages: [{ role: 'user', content: 'Test' }],
      };

      await expect(provider.chat(request)).rejects.toThrow('Anthropic API error');
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

      await expect(provider.chat(request)).rejects.toThrow('timeout');
    });

    it('should include correct headers', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'msg_123',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'Response' }],
          model: 'claude-sonnet-4-20250514',
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
      });

      const request: UnifiedChatRequest = {
        messages: [{ role: 'user', content: 'Test' }],
      };

      await provider.chat(request);

      const headers = fetchMock.mock.calls[0][1].headers;
      expect(headers['anthropic-version']).toBe('2023-06-01');
      expect(headers['x-api-key']).toBe('test-api-key');
      expect(headers['content-type']).toBe('application/json');
    });
  });

  // ==========================================================================
  // Streaming Tests
  // ==========================================================================

  describe('Streaming', () => {
    beforeEach(async () => {
      await provider.initialize();
    });

    it('should handle streaming response', async () => {
      const events = [
        'data: {"type":"message_start","message":{"usage":{"input_tokens":10}}}\n\n',
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}\n\n',
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":" world"}}\n\n',
        'data: {"type":"message_delta","usage":{"output_tokens":5}}\n\n',
        'data: {"type":"message_stop"}\n\n',
      ];

      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          for (const event of events) {
            controller.enqueue(encoder.encode(event));
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
      let finalChunk: any;

      for await (const chunk of provider.stream(request)) {
        if (!chunk.done) {
          results.push(chunk.content);
        } else {
          finalChunk = chunk;
        }
      }

      expect(results).toEqual(['Hello', ' world']);
      expect(finalChunk.done).toBe(true);
      expect(finalChunk.usage?.promptTokens).toBe(10);
      expect(finalChunk.usage?.completionTokens).toBe(5);
    });

    it('should handle streaming error', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal server error',
      });

      const request: UnifiedChatRequest = {
        messages: [{ role: 'user', content: 'Test' }],
      };

      const iterator = provider.stream(request);
      await expect(iterator.next()).rejects.toThrow('Anthropic API error');
    });

    it('should skip empty lines and comments in SSE stream', async () => {
      const events = [
        '\n',
        ': comment\n\n',
        'data: {"type":"message_start","message":{"usage":{"input_tokens":5}}}\n\n',
        '\n',
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Test"}}\n\n',
        'data: {"type":"message_stop"}\n\n',
      ];

      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          for (const event of events) {
            controller.enqueue(encoder.encode(event));
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
        if (!chunk.done) {
          results.push(chunk.content);
        }
      }

      expect(results).toEqual(['Test']);
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
      await expect(iterator.next()).rejects.toThrow('No response body');
    });

    it('should handle API error in streaming', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => 'Bad request',
      });

      const request: UnifiedChatRequest = {
        messages: [{ role: 'user', content: 'Test' }],
      };

      const iterator = provider.stream(request);
      await expect(iterator.next()).rejects.toThrow('Anthropic API error');
    });
  });

  // ==========================================================================
  // Helper Function Tests
  // ==========================================================================

  describe('createAnthropicProvider', () => {
    it('should create provider with default models', () => {
      const provider = createAnthropicProvider('test-key');
      expect(provider.config.models.length).toBeGreaterThan(0);
      expect(provider.config.models[0].provider).toBe('anthropic');
    });

    it('should create provider with custom options', () => {
      const provider = createAnthropicProvider('test-key', {
        defaultModel: 'claude-opus-4-20250514',
        timeoutMs: 90000,
      });
      expect(provider.config.defaultModel).toBe('claude-opus-4-20250514');
      expect(provider.config.timeoutMs).toBe(90000);
    });

    it('should include Claude Sonnet, Opus, and Haiku models', () => {
      const provider = createAnthropicProvider('test-key');
      const modelIds = provider.config.models.map((m) => m.id);
      expect(modelIds).toContain('claude-sonnet-4-20250514');
      expect(modelIds).toContain('claude-opus-4-20250514');
      expect(modelIds).toContain('claude-3-5-haiku-20241022');
    });
  });

  // ==========================================================================
  // Error Handling Tests
  // ==========================================================================

  describe('Error Handling', () => {
    beforeEach(async () => {
      await provider.initialize();
    });

    it('should handle network errors', async () => {
      fetchMock.mockRejectedValueOnce(new Error('Network error'));

      const request: UnifiedChatRequest = {
        messages: [{ role: 'user', content: 'Test' }],
      };

      await expect(provider.chat(request)).rejects.toThrow('Network error');
    });

    it('should cleanup abort controller after request', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'msg_123',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'Response' }],
          model: 'claude-sonnet-4-20250514',
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
      });

      const request: UnifiedChatRequest = {
        messages: [{ role: 'user', content: 'Test' }],
        requestId: 'test-123',
      };

      await provider.chat(request);

      expect((provider as any).abortControllers.has('test-123')).toBe(false);
    });

    it('should reject non-base64 image URLs', async () => {
      const request: UnifiedChatRequest = {
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'What is this?' },
              {
                type: 'image_url',
                image_url: { url: 'https://example.com/image.jpg' },
              },
            ],
          },
        ],
      };

      await expect(provider.chat(request)).rejects.toThrow('base64 data URIs');
    });
  });

  // ==========================================================================
  // Configuration Tests
  // ==========================================================================

  describe('Configuration', () => {
    it('should use custom base URL', () => {
      const customProvider = new AnthropicProvider(
        createTestConfig({ baseUrl: 'https://custom-api.anthropic.com' })
      );
      expect((customProvider as any).baseUrl).toBe('https://custom-api.anthropic.com');
    });

    it('should use default base URL if not provided', () => {
      const config = createTestConfig();
      delete (config as any).baseUrl;
      const customProvider = new AnthropicProvider(config);
      expect((customProvider as any).baseUrl).toBe('https://api.anthropic.com/v1');
    });
  });
});
