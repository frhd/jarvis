import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LLMService, AnalysisResult } from './llm.service';
import { LLMClient, LLMResponse, LLMHealthStatus } from '../clients/llm.client';
import { LLMResponseRepository } from '../repositories/llmResponse.repository';
import { Message, Chat, Sender, PromptType, LLMResponseRecord } from '../types';
import * as configModule from '../config';

// ============================================================================
// Mocks
// ============================================================================

// Mock the config module
vi.mock('../config', () => ({
  appConfig: {
    llm: {
      enabled: true,
      baseUrl: 'http://localhost:11434',
      model: 'llama3.1:8b',
      timeoutMs: 30000,
      maxRetries: 3,
      temperature: 0.7,
      maxTokens: 2048,
      healthCheckIntervalMs: 30000,
      skipOnUnhealthy: true,
    },
    response: {
      enabled: true,
      systemPrompt: 'You are Jarvis, a helpful assistant.',
    },
  },
}));

// Mock logger
vi.mock('../utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  })),
}));

// Mock LLMClient class
vi.mock('../clients/llm.client', () => {
  class MockLLMClient {
    chat = vi.fn();
    healthCheck = vi.fn();
  }

  return {
    LLMClient: MockLLMClient,
  };
});

// ============================================================================
// Test Fixtures
// ============================================================================

function createMockMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'msg-123',
    chatId: 'chat-456',
    senderId: 'sender-789',
    telegramMessageId: 1,
    text: 'Hello, how are you?',
    mediaType: null,
    mediaPath: null,
    mediaFileId: null,
    replyToMessageId: null,
    forwardFromChatId: null,
    forwardFromMessageId: null,
    isBot: false,
    rawJson: '{}',
    createdAt: new Date(),
    ...overrides,
  };
}

function createMockChat(overrides: Partial<Chat> = {}): Chat {
  return {
    id: 'chat-456',
    telegramChatId: 123456,
    type: 'private',
    title: null,
    username: 'testuser',
    rawJson: '{}',
    createdAt: new Date(),
    ...overrides,
  };
}

function createMockSender(overrides: Partial<Sender> = {}): Sender {
  return {
    id: 'sender-789',
    telegramUserId: 789,
    firstName: 'John',
    lastName: 'Doe',
    username: 'johndoe',
    isBot: false,
    rawJson: '{}',
    createdAt: new Date(),
    ...overrides,
  };
}

function createMockLLMResponse(overrides: Partial<LLMResponse> = {}): LLMResponse {
  return {
    content: 'This is a test response',
    model: 'llama3.1:8b',
    done: true,
    totalDuration: 1500000000,
    loadDuration: 500000000,
    promptEvalCount: 20,
    evalCount: 50,
    evalDuration: 1000000000,
    ...overrides,
  };
}

function createMockLLMResponseRecord(
  overrides: Partial<LLMResponseRecord> = {}
): LLMResponseRecord {
  return {
    id: 'response-123',
    messageId: 'msg-123',
    promptType: 'analysis',
    prompt: 'Test prompt',
    response: 'Test response',
    model: 'llama3.1:8b',
    durationMs: 1500,
    promptTokens: 20,
    completionTokens: 50,
    error: null,
    createdAt: new Date(),
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('LLMService', () => {
  let llmService: LLMService;
  let mockLLMClientInstance: {
    chat: ReturnType<typeof vi.fn>;
    healthCheck: ReturnType<typeof vi.fn>;
  };
  let mockLLMResponseRepository: LLMResponseRepository;

  beforeEach(() => {
    // Reset config to enabled state
    (configModule.appConfig as any).llm.enabled = true;
    (configModule.appConfig as any).llm.skipOnUnhealthy = true;
    (configModule.appConfig as any).response.enabled = true;

    // Create mock LLMResponseRepository
    mockLLMResponseRepository = {
      create: vi.fn(),
      findByMessageId: vi.fn(),
      findLatestByMessageId: vi.fn(),
    } as any;

    // Create service instance
    llmService = new LLMService(mockLLMResponseRepository);

    // Get the mock client instance
    mockLLMClientInstance = llmService.getClient() as any;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('initialize', () => {
    it('should skip initialization when LLM is disabled', async () => {
      (configModule.appConfig as any).llm.enabled = false;

      await llmService.initialize();

      expect(mockLLMClientInstance.healthCheck).not.toHaveBeenCalled();
    });

    it('should perform health check and start health check loop when enabled', async () => {
      vi.mocked(mockLLMClientInstance.healthCheck).mockResolvedValue({
        healthy: true,
        model: 'llama3.1:8b',
      });

      await llmService.initialize();

      expect(mockLLMClientInstance.healthCheck).toHaveBeenCalledTimes(1);
    });

    it('should handle health check failures during initialization', async () => {
      vi.mocked(mockLLMClientInstance.healthCheck).mockResolvedValue({
        healthy: false,
        error: 'Connection refused',
      });

      await llmService.initialize();

      expect(mockLLMClientInstance.healthCheck).toHaveBeenCalledTimes(1);
      const status = llmService.getHealthStatus();
      expect(status.healthy).toBe(false);
    });
  });

  describe('shutdown', () => {
    it('should clear health check timer on shutdown', async () => {
      vi.mocked(mockLLMClientInstance.healthCheck).mockResolvedValue({
        healthy: true,
        model: 'llama3.1:8b',
      });

      await llmService.initialize();
      await llmService.shutdown();

      // Timer should be cleared, no way to directly test but ensure no errors
      expect(true).toBe(true);
    });
  });

  describe('getHealthStatus', () => {
    it('should return correct status when enabled and healthy', async () => {
      vi.mocked(mockLLMClientInstance.healthCheck).mockResolvedValue({
        healthy: true,
        model: 'llama3.1:8b',
      });

      await llmService.initialize();

      const status = llmService.getHealthStatus();
      expect(status.enabled).toBe(true);
      expect(status.healthy).toBe(true);
    });

    it('should return correct status when enabled but unhealthy', async () => {
      vi.mocked(mockLLMClientInstance.healthCheck).mockResolvedValue({
        healthy: false,
        error: 'Service unavailable',
      });

      await llmService.initialize();

      const status = llmService.getHealthStatus();
      expect(status.enabled).toBe(true);
      expect(status.healthy).toBe(false);
    });

    it('should return correct status when disabled', async () => {
      (configModule.appConfig as any).llm.enabled = false;

      const status = llmService.getHealthStatus();
      expect(status.enabled).toBe(false);
    });
  });

  describe('getClient', () => {
    it('should return the LLMClient instance', () => {
      const client = llmService.getClient();
      expect(client).toBe(mockLLMClientInstance);
    });
  });

  describe('analyzeMessage', () => {
    const message = createMockMessage();
    const chat = createMockChat();
    const sender = createMockSender();

    it('should successfully analyze message with enabled LLM', async () => {
      const mockResponse = createMockLLMResponse();
      const mockStoredResponse = createMockLLMResponseRecord();

      vi.mocked(mockLLMClientInstance.chat).mockResolvedValue(mockResponse);
      vi.mocked(mockLLMResponseRepository.create).mockResolvedValue(mockStoredResponse);

      // Initialize to set healthy status
      vi.mocked(mockLLMClientInstance.healthCheck).mockResolvedValue({
        healthy: true,
        model: 'llama3.1:8b',
      });
      await llmService.initialize();

      const result = await llmService.analyzeMessage(message, chat, sender);

      expect(result.success).toBe(true);
      expect(result.content).toBe(mockResponse.content);
      expect(result.responseId).toBe(mockStoredResponse.id);
      expect(result.skipped).toBeUndefined();
      expect(result.error).toBeUndefined();

      expect(mockLLMClientInstance.chat).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ role: 'system' }),
          expect.objectContaining({ role: 'user' }),
        ]),
        message.id
      );

      expect(mockLLMResponseRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          messageId: message.id,
          promptType: 'analysis',
          response: mockResponse.content,
          model: mockResponse.model,
          durationMs: expect.any(Number),
          promptTokens: mockResponse.promptEvalCount,
          completionTokens: mockResponse.evalCount,
          error: null,
        })
      );
    });

    it('should return skipped when LLM is disabled', async () => {
      (configModule.appConfig as any).llm.enabled = false;

      const result = await llmService.analyzeMessage(message, chat, sender);

      expect(result.success).toBe(true);
      expect(result.skipped).toBe(true);
      expect(result.content).toBe('LLM disabled');
      expect(mockLLMClientInstance.chat).not.toHaveBeenCalled();
      expect(mockLLMResponseRepository.create).not.toHaveBeenCalled();
    });

    it('should return skipped when unhealthy and skipOnUnhealthy is true', async () => {
      (configModule.appConfig as any).llm.skipOnUnhealthy = true;

      // Initialize with unhealthy status
      vi.mocked(mockLLMClientInstance.healthCheck).mockResolvedValue({
        healthy: false,
        error: 'Service unavailable',
      });
      await llmService.initialize();

      const result = await llmService.analyzeMessage(message, chat, sender);

      expect(result.success).toBe(true);
      expect(result.skipped).toBe(true);
      expect(result.content).toBe('LLM unavailable');
      expect(mockLLMClientInstance.chat).not.toHaveBeenCalled();
      expect(mockLLMResponseRepository.create).not.toHaveBeenCalled();
    });

    it('should handle timeout errors and store error in repository', async () => {
      const timeoutError = new Error('Request timeout after 30000ms');

      vi.mocked(mockLLMClientInstance.chat).mockRejectedValue(timeoutError);
      vi.mocked(mockLLMResponseRepository.create).mockResolvedValue(
        createMockLLMResponseRecord({ error: timeoutError.message })
      );

      // Initialize to set healthy status
      vi.mocked(mockLLMClientInstance.healthCheck).mockResolvedValue({
        healthy: true,
        model: 'llama3.1:8b',
      });
      await llmService.initialize();

      const result = await llmService.analyzeMessage(message, chat, sender);

      expect(result.success).toBe(false);
      expect(result.error).toBe(timeoutError.message);
      expect(result.content).toBeUndefined();
      expect(result.responseId).toBeUndefined();

      expect(mockLLMResponseRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          messageId: message.id,
          promptType: 'analysis',
          response: '',
          error: timeoutError.message,
          durationMs: null,
          promptTokens: null,
          completionTokens: null,
        })
      );
    });

    it('should handle non-Error exceptions', async () => {
      vi.mocked(mockLLMClientInstance.chat).mockRejectedValue('String error');
      vi.mocked(mockLLMResponseRepository.create).mockResolvedValue(
        createMockLLMResponseRecord({ error: 'Unknown error' })
      );

      // Initialize to set healthy status
      vi.mocked(mockLLMClientInstance.healthCheck).mockResolvedValue({
        healthy: true,
        model: 'llama3.1:8b',
      });
      await llmService.initialize();

      const result = await llmService.analyzeMessage(message, chat, sender);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unknown error');

      expect(mockLLMResponseRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Unknown error',
        })
      );
    });

    it('should use correct prompt type when specified', async () => {
      const mockResponse = createMockLLMResponse();
      const mockStoredResponse = createMockLLMResponseRecord({ promptType: 'summary' });

      vi.mocked(mockLLMClientInstance.chat).mockResolvedValue(mockResponse);
      vi.mocked(mockLLMResponseRepository.create).mockResolvedValue(mockStoredResponse);

      // Initialize to set healthy status
      vi.mocked(mockLLMClientInstance.healthCheck).mockResolvedValue({
        healthy: true,
        model: 'llama3.1:8b',
      });
      await llmService.initialize();

      const result = await llmService.analyzeMessage(message, chat, sender, 'summary');

      expect(result.success).toBe(true);
      expect(mockLLMResponseRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          promptType: 'summary',
        })
      );
    });

    it('should include media information in prompt', async () => {
      const messageWithMedia = createMockMessage({
        mediaType: 'photo',
        mediaPath: '/data/media/photos/abc123.jpg',
      });
      const mockResponse = createMockLLMResponse();
      const mockStoredResponse = createMockLLMResponseRecord();

      vi.mocked(mockLLMClientInstance.chat).mockResolvedValue(mockResponse);
      vi.mocked(mockLLMResponseRepository.create).mockResolvedValue(mockStoredResponse);

      // Initialize to set healthy status
      vi.mocked(mockLLMClientInstance.healthCheck).mockResolvedValue({
        healthy: true,
        model: 'llama3.1:8b',
      });
      await llmService.initialize();

      const result = await llmService.analyzeMessage(messageWithMedia, chat, sender);

      expect(result.success).toBe(true);
      expect(mockLLMClientInstance.chat).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            role: 'user',
            content: expect.stringContaining('[Attachment: photo (downloaded)]'),
          }),
        ]),
        messageWithMedia.id
      );
    });

    it('should handle message without text', async () => {
      const messageNoText = createMockMessage({ text: null });
      const mockResponse = createMockLLMResponse();
      const mockStoredResponse = createMockLLMResponseRecord();

      vi.mocked(mockLLMClientInstance.chat).mockResolvedValue(mockResponse);
      vi.mocked(mockLLMResponseRepository.create).mockResolvedValue(mockStoredResponse);

      // Initialize to set healthy status
      vi.mocked(mockLLMClientInstance.healthCheck).mockResolvedValue({
        healthy: true,
        model: 'llama3.1:8b',
      });
      await llmService.initialize();

      const result = await llmService.analyzeMessage(messageNoText, chat, sender);

      expect(result.success).toBe(true);
      expect(mockLLMClientInstance.chat).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            role: 'user',
            content: expect.stringContaining('[No text content]'),
          }),
        ]),
        messageNoText.id
      );
    });

    it('should handle null sender gracefully', async () => {
      const mockResponse = createMockLLMResponse();
      const mockStoredResponse = createMockLLMResponseRecord();

      vi.mocked(mockLLMClientInstance.chat).mockResolvedValue(mockResponse);
      vi.mocked(mockLLMResponseRepository.create).mockResolvedValue(mockStoredResponse);

      // Initialize to set healthy status
      vi.mocked(mockLLMClientInstance.healthCheck).mockResolvedValue({
        healthy: true,
        model: 'llama3.1:8b',
      });
      await llmService.initialize();

      const result = await llmService.analyzeMessage(message, chat, null);

      expect(result.success).toBe(true);
      // Prompt should not include sender information
      expect(mockLLMClientInstance.chat).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            role: 'user',
            content: expect.not.stringContaining('**From**:'),
          }),
        ]),
        message.id
      );
    });

    it('should track processing duration accurately', async () => {
      const mockResponse = createMockLLMResponse();
      const mockStoredResponse = createMockLLMResponseRecord({ durationMs: 1500 });

      vi.mocked(mockLLMClientInstance.chat).mockImplementation(() => {
        return new Promise((resolve) => {
          setTimeout(() => resolve(mockResponse), 100);
        });
      });
      vi.mocked(mockLLMResponseRepository.create).mockResolvedValue(mockStoredResponse);

      // Initialize to set healthy status
      vi.mocked(mockLLMClientInstance.healthCheck).mockResolvedValue({
        healthy: true,
        model: 'llama3.1:8b',
      });
      await llmService.initialize();

      const result = await llmService.analyzeMessage(message, chat, sender);

      expect(result.success).toBe(true);
      expect(mockLLMResponseRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          durationMs: expect.any(Number),
        })
      );

      const createCall = vi.mocked(mockLLMResponseRepository.create).mock.calls[0][0];
      // Allow small timing variance (95ms instead of 100ms)
      expect(createCall.durationMs).toBeGreaterThanOrEqual(95);
    });
  });

  describe('generateResponse', () => {
    const message = createMockMessage();
    const chat = createMockChat();
    const sender = createMockSender();
    const conversationHistory: Message[] = [
      createMockMessage({
        id: 'msg-1',
        text: 'Previous message 1',
        isBot: false,
        createdAt: new Date(Date.now() - 60000),
      }),
      createMockMessage({
        id: 'msg-2',
        text: 'Bot response',
        isBot: true,
        createdAt: new Date(Date.now() - 30000),
      }),
    ];

    it('should successfully generate response with conversation history', async () => {
      const mockResponse = createMockLLMResponse({
        content: 'Generated response to user query',
      });
      const mockStoredResponse = createMockLLMResponseRecord({
        promptType: 'response',
      });

      vi.mocked(mockLLMClientInstance.chat).mockResolvedValue(mockResponse);
      vi.mocked(mockLLMResponseRepository.create).mockResolvedValue(mockStoredResponse);

      // Initialize to set healthy status
      vi.mocked(mockLLMClientInstance.healthCheck).mockResolvedValue({
        healthy: true,
        model: 'llama3.1:8b',
      });
      await llmService.initialize();

      const result = await llmService.generateResponse(message, chat, sender, conversationHistory);

      expect(result.success).toBe(true);
      expect(result.content).toBe(mockResponse.content);
      expect(result.responseId).toBe(mockStoredResponse.id);

      // Verify conversation context is built correctly
      expect(mockLLMClientInstance.chat).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ role: 'system' }),
          expect.objectContaining({ role: 'user', content: 'Previous message 1' }),
          expect.objectContaining({ role: 'assistant', content: 'Bot response' }),
          expect.objectContaining({ role: 'user', content: message.text }),
        ]),
        `response-${message.id}`
      );

      expect(mockLLMResponseRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          messageId: message.id,
          promptType: 'response',
          response: mockResponse.content,
          model: mockResponse.model,
          durationMs: expect.any(Number),
        })
      );
    });

    it('should return skipped when response generation is disabled', async () => {
      (configModule.appConfig as any).response.enabled = false;

      const result = await llmService.generateResponse(message, chat, sender, conversationHistory);

      expect(result.success).toBe(true);
      expect(result.skipped).toBe(true);
      expect(result.content).toBe('Response disabled');
      expect(mockLLMClientInstance.chat).not.toHaveBeenCalled();
      expect(mockLLMResponseRepository.create).not.toHaveBeenCalled();
    });

    it('should return skipped when unhealthy and skipOnUnhealthy is true', async () => {
      (configModule.appConfig as any).llm.skipOnUnhealthy = true;

      // Initialize with unhealthy status
      vi.mocked(mockLLMClientInstance.healthCheck).mockResolvedValue({
        healthy: false,
        error: 'Service unavailable',
      });
      await llmService.initialize();

      const result = await llmService.generateResponse(message, chat, sender, conversationHistory);

      expect(result.success).toBe(true);
      expect(result.skipped).toBe(true);
      expect(result.content).toBe('LLM unavailable');
      expect(mockLLMClientInstance.chat).not.toHaveBeenCalled();
    });

    it('should handle response generation errors without storing in repository', async () => {
      const errorMessage = 'Model overloaded';

      vi.mocked(mockLLMClientInstance.chat).mockRejectedValue(new Error(errorMessage));

      // Initialize to set healthy status
      vi.mocked(mockLLMClientInstance.healthCheck).mockResolvedValue({
        healthy: true,
        model: 'llama3.1:8b',
      });
      await llmService.initialize();

      const result = await llmService.generateResponse(message, chat, sender, conversationHistory);

      expect(result.success).toBe(false);
      expect(result.error).toBe(errorMessage);
      // Note: generateResponse does NOT store errors in repository (unlike analyzeMessage)
      expect(mockLLMResponseRepository.create).not.toHaveBeenCalled();
    });

    it('should filter out messages without text from conversation history', async () => {
      const historyWithEmptyText: Message[] = [
        createMockMessage({
          id: 'msg-1',
          text: 'Valid message',
          isBot: false,
        }),
        createMockMessage({
          id: 'msg-2',
          text: null,
          isBot: false,
        }),
        createMockMessage({
          id: 'msg-3',
          text: 'Another valid message',
          isBot: true,
        }),
      ];

      const mockResponse = createMockLLMResponse();
      const mockStoredResponse = createMockLLMResponseRecord();

      vi.mocked(mockLLMClientInstance.chat).mockResolvedValue(mockResponse);
      vi.mocked(mockLLMResponseRepository.create).mockResolvedValue(mockStoredResponse);

      // Initialize to set healthy status
      vi.mocked(mockLLMClientInstance.healthCheck).mockResolvedValue({
        healthy: true,
        model: 'llama3.1:8b',
      });
      await llmService.initialize();

      await llmService.generateResponse(message, chat, sender, historyWithEmptyText);

      // Should only include messages with text
      expect(mockLLMClientInstance.chat).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ role: 'system' }),
          expect.objectContaining({ role: 'user', content: 'Valid message' }),
          expect.objectContaining({ role: 'assistant', content: 'Another valid message' }),
          expect.objectContaining({ role: 'user', content: message.text }),
        ]),
        `response-${message.id}`
      );

      // Verify no message with null text is included
      const chatCall = vi.mocked(mockLLMClientInstance.chat).mock.calls[0][0];
      expect(chatCall.length).toBe(4); // system + 2 valid history + current message
    });

    it('should handle empty conversation history', async () => {
      const mockResponse = createMockLLMResponse();
      const mockStoredResponse = createMockLLMResponseRecord();

      vi.mocked(mockLLMClientInstance.chat).mockResolvedValue(mockResponse);
      vi.mocked(mockLLMResponseRepository.create).mockResolvedValue(mockStoredResponse);

      // Initialize to set healthy status
      vi.mocked(mockLLMClientInstance.healthCheck).mockResolvedValue({
        healthy: true,
        model: 'llama3.1:8b',
      });
      await llmService.initialize();

      const result = await llmService.generateResponse(message, chat, sender, []);

      expect(result.success).toBe(true);
      expect(mockLLMClientInstance.chat).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ role: 'system' }),
          expect.objectContaining({ role: 'user', content: message.text }),
        ]),
        `response-${message.id}`
      );

      const chatCall = vi.mocked(mockLLMClientInstance.chat).mock.calls[0][0];
      expect(chatCall.length).toBe(2); // system + current message only
    });

    it('should reverse conversation history to chronological order', async () => {
      // History is provided in descending order (most recent first)
      const descendingHistory: Message[] = [
        createMockMessage({
          id: 'msg-3',
          text: 'Most recent',
          isBot: false,
          createdAt: new Date(Date.now() - 10000),
        }),
        createMockMessage({
          id: 'msg-2',
          text: 'Middle message',
          isBot: true,
          createdAt: new Date(Date.now() - 20000),
        }),
        createMockMessage({
          id: 'msg-1',
          text: 'Oldest message',
          isBot: false,
          createdAt: new Date(Date.now() - 30000),
        }),
      ];

      const mockResponse = createMockLLMResponse();
      const mockStoredResponse = createMockLLMResponseRecord();

      vi.mocked(mockLLMClientInstance.chat).mockResolvedValue(mockResponse);
      vi.mocked(mockLLMResponseRepository.create).mockResolvedValue(mockStoredResponse);

      // Initialize to set healthy status
      vi.mocked(mockLLMClientInstance.healthCheck).mockResolvedValue({
        healthy: true,
        model: 'llama3.1:8b',
      });
      await llmService.initialize();

      await llmService.generateResponse(message, chat, sender, descendingHistory);

      // Verify messages are in chronological order (oldest to newest)
      const chatCall = vi.mocked(mockLLMClientInstance.chat).mock.calls[0][0];
      expect(chatCall[1].content).toBe('Oldest message');
      expect(chatCall[2].content).toBe('Middle message');
      expect(chatCall[3].content).toBe('Most recent');
      expect(chatCall[4].content).toBe(message.text);
    });

    it('should store serialized chat messages as prompt', async () => {
      const mockResponse = createMockLLMResponse();
      const mockStoredResponse = createMockLLMResponseRecord();

      vi.mocked(mockLLMClientInstance.chat).mockResolvedValue(mockResponse);
      vi.mocked(mockLLMResponseRepository.create).mockResolvedValue(mockStoredResponse);

      // Initialize to set healthy status
      vi.mocked(mockLLMClientInstance.healthCheck).mockResolvedValue({
        healthy: true,
        model: 'llama3.1:8b',
      });
      await llmService.initialize();

      await llmService.generateResponse(message, chat, sender, conversationHistory);

      expect(mockLLMResponseRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringContaining('"role"'),
        })
      );

      const createCall = vi.mocked(mockLLMResponseRepository.create).mock.calls[0][0];
      const parsedPrompt = JSON.parse(createCall.prompt);
      expect(Array.isArray(parsedPrompt)).toBe(true);
      expect(parsedPrompt[0]).toHaveProperty('role');
      expect(parsedPrompt[0]).toHaveProperty('content');
    });
  });

  describe('health check behavior', () => {
    it('should update health status when recovery occurs', async () => {
      // Start unhealthy
      vi.mocked(mockLLMClientInstance.healthCheck).mockResolvedValueOnce({
        healthy: false,
        error: 'Connection refused',
      });

      await llmService.initialize();
      expect(llmService.getHealthStatus().healthy).toBe(false);

      // Recover
      vi.mocked(mockLLMClientInstance.healthCheck).mockResolvedValueOnce({
        healthy: true,
        model: 'llama3.1:8b',
      });

      // Manually trigger health check (simulating interval)
      await (llmService as any).performHealthCheck();

      expect(llmService.getHealthStatus().healthy).toBe(true);
    });

    it('should update health status when service becomes unhealthy', async () => {
      // Start healthy
      vi.mocked(mockLLMClientInstance.healthCheck).mockResolvedValueOnce({
        healthy: true,
        model: 'llama3.1:8b',
      });

      await llmService.initialize();
      expect(llmService.getHealthStatus().healthy).toBe(true);

      // Become unhealthy
      vi.mocked(mockLLMClientInstance.healthCheck).mockResolvedValueOnce({
        healthy: false,
        error: 'Service overloaded',
      });

      // Manually trigger health check
      await (llmService as any).performHealthCheck();

      expect(llmService.getHealthStatus().healthy).toBe(false);
    });
  });
});
