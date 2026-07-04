/**
 * Ollama Provider Tests
 *
 * Comprehensive unit tests for the Ollama LLM provider
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OllamaProvider } from './ollama.provider';
import type {
  ProviderConfig,
  UnifiedChatRequest,
  ModelConfig,
} from '../../types/llm.types';

// ============================================================================
// Test Setup
// ============================================================================

const mockOllamaModels: ModelConfig[] = [
  {
    id: 'mistral',
    provider: 'ollama',
    displayName: 'Mistral',
    contextWindow: 8192,
    maxOutputTokens: 4096,
    costPer1kInput: 0,
    costPer1kOutput: 0,
    capabilities: {
      streaming: true,
      toolCalling: true,
      vision: false,
      embeddings: false,
      jsonMode: false,
      functionCalling: true,
    },
    defaultTemperature: 0.7,
    tags: ['fast', 'local'],
  },
];

function createTestConfig(overrides?: Partial<ProviderConfig>): ProviderConfig {
  return {
    type: 'ollama',
    enabled: true,
    baseUrl: 'http://localhost:11434',
    defaultModel: 'mistral',
    models: mockOllamaModels,
    timeoutMs: 30000,
    maxRetries: 3,
    ...overrides,
  };
}

// Mock fetch globally
const originalFetch = global.fetch;

// ============================================================================
// Tests
// ============================================================================

describe('OllamaProvider', () => {
  let provider: OllamaProvider;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock as any;
    provider = new OllamaProvider(createTestConfig());
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
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          models: [
            {
              name: 'mistral:latest',
              model: 'mistral',
              modified_at: '2024-01-01',
              size: 4000000000,
              digest: 'sha256:abc123',
            },
          ],
        }),
      });

      await provider.initialize();
      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:11434/api/tags',
        expect.any(Object)
      );
    });

    it('should throw error if health check fails during initialization', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      await expect(provider.initialize()).rejects.toThrow(
        'Ollama provider initialization failed'
      );
    });

    it('should throw error if connection refused', async () => {
      fetchMock.mockRejectedValueOnce(new Error('Connection refused'));

      await expect(provider.initialize()).rejects.toThrow(
        'Ollama provider initialization failed'
      );
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
          models: [
            { name: 'mistral:latest', model: 'mistral' },
            { name: 'llama2:latest', model: 'llama2' },
          ],
        }),
      });

      const health = await provider.healthCheck();

      expect(health.healthy).toBe(true);
      expect(health.provider).toBe('ollama');
      expect(health.availableModels).toEqual(['mistral:latest', 'llama2:latest']);
      expect(health.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('should return unhealthy status when API returns error', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
      });

      const health = await provider.healthCheck();

      expect(health.healthy).toBe(false);
      expect(health.error).toContain('503');
    });

    it('should return unhealthy status when network error occurs', async () => {
      fetchMock.mockRejectedValueOnce(new Error('Network timeout'));

      const health = await provider.healthCheck();

      expect(health.healthy).toBe(false);
      expect(health.error).toContain('Network timeout');
    });

    it('should warn if default model is not loaded', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          models: [{ name: 'llama2:latest', model: 'llama2' }],
        }),
      });

      const health = await provider.healthCheck();

      expect(health.healthy).toBe(true);
      expect(health.error).toContain('not found');
    });
  });

  // ==========================================================================
  // Chat Completion Tests
  // ==========================================================================

  describe('Chat Completion', () => {
    beforeEach(async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: [{ name: 'mistral:latest' }] }),
      });
      await provider.initialize();
      fetchMock.mockClear();
    });

    it('should send basic chat request successfully', async () => {
      const mockResponse = {
        model: 'mistral',
        message: {
          role: 'assistant',
          content: 'Hello! How can I help you?',
        },
        done: true,
        total_duration: 1000000000,
        prompt_eval_count: 10,
        eval_count: 15,
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
      expect(response.usage?.completionTokens).toBe(15);
      expect(response.metadata?.finishReason).toBe('stop');
    });

    it('should handle multimodal messages with text extraction', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          model: 'mistral',
          message: { role: 'assistant', content: 'Response' },
          done: true,
        }),
      });

      const request: UnifiedChatRequest = {
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Hello' },
              { type: 'text', text: 'World' },
            ],
          },
        ],
      };

      await provider.chat(request);

      const sentRequest = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(sentRequest.messages[0].content).toContain('Hello');
      expect(sentRequest.messages[0].content).toContain('World');
    });

    it('should send tools with request when provided', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          model: 'mistral',
          message: { role: 'assistant', content: 'Response' },
          done: true,
        }),
      });

      const request: UnifiedChatRequest = {
        messages: [{ role: 'user', content: 'What is the weather?' }],
        tools: [
          {
            name: 'get_weather',
            description: 'Get weather information',
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

      await provider.chat(request);

      const sentRequest = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(sentRequest.tools).toHaveLength(1);
      expect(sentRequest.tools[0].function.name).toBe('get_weather');
    });

    it('should handle tool calls in response', async () => {
      const mockResponse = {
        model: 'mistral',
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              function: {
                name: 'get_weather',
                arguments: '{"location":"London"}',
              },
            },
          ],
        },
        done: true,
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const request: UnifiedChatRequest = {
        messages: [{ role: 'user', content: 'Weather in London?' }],
      };

      const response = await provider.chat(request);

      expect(response.toolCalls).toHaveLength(1);
      expect(response.toolCalls![0].name).toBe('get_weather');
      expect(response.toolCalls![0].arguments).toContain('London');
      expect(response.metadata?.finishReason).toBe('tool_calls');
    });

    it('should handle tool calls with object arguments', async () => {
      const mockResponse = {
        model: 'mistral',
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              function: {
                name: 'get_weather',
                arguments: { location: 'London', units: 'celsius' },
              },
            },
          ],
        },
        done: true,
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const request: UnifiedChatRequest = {
        messages: [{ role: 'user', content: 'Weather?' }],
      };

      const response = await provider.chat(request);

      expect(response.toolCalls).toHaveLength(1);
      const args = JSON.parse(response.toolCalls![0].arguments);
      expect(args.location).toBe('London');
    });

    it('should respect custom temperature', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          model: 'mistral',
          message: { role: 'assistant', content: 'Response' },
          done: true,
        }),
      });

      const request: UnifiedChatRequest = {
        messages: [{ role: 'user', content: 'Test' }],
        temperature: 0.5,
      };

      await provider.chat(request);

      const sentRequest = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(sentRequest.options.temperature).toBe(0.5);
    });

    it('should respect custom maxTokens', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          model: 'mistral',
          message: { role: 'assistant', content: 'Response' },
          done: true,
        }),
      });

      const request: UnifiedChatRequest = {
        messages: [{ role: 'user', content: 'Test' }],
        maxTokens: 1000,
      };

      await provider.chat(request);

      const sentRequest = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(sentRequest.options.num_predict).toBe(1000);
    });

    it('should throw error if provider not initialized', async () => {
      const uninitializedProvider = new OllamaProvider(createTestConfig());

      await expect(
        uninitializedProvider.chat({
          messages: [{ role: 'user', content: 'Test' }],
        })
      ).rejects.toThrow('not initialized');
    });

    it('should throw error on API error response', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      const request: UnifiedChatRequest = {
        messages: [{ role: 'user', content: 'Test' }],
      };

      await expect(provider.chat(request)).rejects.toThrow('Ollama API error');
    });

    it.skip('should handle timeout with custom timeout', async () => {
      // Note: Timeout testing with mocked fetch is challenging
      // In real scenarios, setTimeout triggers the AbortSignal
      // This test is skipped as it requires more complex mock setup
    });
  });

  // ==========================================================================
  // Streaming Tests
  // ==========================================================================

  describe('Streaming', () => {
    beforeEach(async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: [{ name: 'mistral:latest' }] }),
      });
      await provider.initialize();
      fetchMock.mockClear();
    });

    it('should handle streaming response', async () => {
      const chunks = [
        { model: 'mistral', message: { content: 'Hello' }, done: false },
        { model: 'mistral', message: { content: ' world' }, done: false },
        {
          model: 'mistral',
          message: { content: '!' },
          done: true,
          prompt_eval_count: 5,
          eval_count: 10,
        },
      ];

      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(encoder.encode(JSON.stringify(chunk) + '\n'));
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
        results.push(chunk.content);
        if (chunk.done) {
          expect(chunk.usage?.promptTokens).toBe(5);
          expect(chunk.usage?.completionTokens).toBe(10);
        }
      }

      expect(results).toEqual(['Hello', ' world', '!']);
    });

    it('should handle streaming with tool calls', async () => {
      const chunks = [
        {
          model: 'mistral',
          message: {
            content: '',
            tool_calls: [
              {
                function: { name: 'get_weather', arguments: '{"location":"NYC"}' },
              },
            ],
          },
          done: true,
        },
      ];

      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(encoder.encode(JSON.stringify(chunk) + '\n'));
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

      const results: any[] = [];
      for await (const chunk of provider.stream(request)) {
        results.push(chunk);
      }

      expect(results[0].toolCalls).toBeDefined();
      expect(results[0].toolCalls![0].name).toBe('get_weather');
    });

    it('should handle streaming error gracefully', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      const request: UnifiedChatRequest = {
        messages: [{ role: 'user', content: 'Test' }],
      };

      const iterator = provider.stream(request);
      await expect(iterator.next()).rejects.toThrow('Ollama API error');
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
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          controller.enqueue(encoder.encode('\n'));
          controller.enqueue(encoder.encode('   \n'));
          controller.enqueue(
            encoder.encode(
              JSON.stringify({
                model: 'mistral',
                message: { content: 'Test' },
                done: true,
              }) + '\n'
            )
          );
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
        results.push(chunk.content);
      }

      expect(results).toEqual(['Test']);
    });

    it('should handle malformed JSON in stream gracefully', async () => {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          controller.enqueue(encoder.encode('invalid json\n'));
          controller.enqueue(
            encoder.encode(
              JSON.stringify({
                model: 'mistral',
                message: { content: 'Valid' },
                done: true,
              }) + '\n'
            )
          );
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
        results.push(chunk.content);
      }

      expect(results).toEqual(['Valid']);
    });
  });

  // ==========================================================================
  // Error Handling Tests
  // ==========================================================================

  describe('Error Handling', () => {
    beforeEach(async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: [{ name: 'mistral:latest' }] }),
      });
      await provider.initialize();
      fetchMock.mockClear();
    });

    it('should handle network errors', async () => {
      fetchMock.mockRejectedValueOnce(new Error('Network error'));

      const request: UnifiedChatRequest = {
        messages: [{ role: 'user', content: 'Test' }],
      };

      await expect(provider.chat(request)).rejects.toThrow('Network error');
    });

    it('should handle abort errors with proper message', async () => {
      fetchMock.mockImplementationOnce(() => {
        const error = new Error('The operation was aborted');
        error.name = 'AbortError';
        return Promise.reject(error);
      });

      const request: UnifiedChatRequest = {
        messages: [{ role: 'user', content: 'Test' }],
      };

      await expect(provider.chat(request)).rejects.toThrow('timed out');
    });

    it('should cleanup abort controller after request', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          model: 'mistral',
          message: { role: 'assistant', content: 'Response' },
          done: true,
        }),
      });

      const request: UnifiedChatRequest = {
        messages: [{ role: 'user', content: 'Test' }],
        requestId: 'test-123',
      };

      await provider.chat(request);

      expect((provider as any).abortControllers.has('test-123')).toBe(false);
    });
  });

  // ==========================================================================
  // Configuration Tests
  // ==========================================================================

  describe('Configuration', () => {
    it('should use custom base URL', () => {
      const customProvider = new OllamaProvider(
        createTestConfig({ baseUrl: 'http://custom:11434' })
      );
      expect((customProvider as any).ollamaConfig.baseUrl).toBe('http://custom:11434');
    });

    it('should use custom default model', () => {
      const customProvider = new OllamaProvider(
        createTestConfig({ defaultModel: 'llama2' })
      );
      expect((customProvider as any).ollamaConfig.defaultModel).toBe('llama2');
    });

    it('should use custom timeout', () => {
      const customProvider = new OllamaProvider(
        createTestConfig({ timeoutMs: 60000 })
      );
      expect((customProvider as any).ollamaConfig.timeoutMs).toBe(60000);
    });
  });
});
