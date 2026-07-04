/**
 * LLM Router Service Tests
 *
 * Comprehensive tests for the LLM Router Service which handles routing between
 * Ollama (fast responses) and Claude (complex tasks).
 *
 * Run: npx vitest src/services/routing/llm-router.service.test.ts
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { LLMRouterService, LLMRouterConfig, LLMRouterResult } from './llm-router.service.js';
import type { Message, Sender, Chat } from '../../types/index.js';
import type { EnhancedIntentResult, PlanIntent } from '../../types/intent.types.js';
import type { LLMClient, ChatMessage, LLMResponse } from '../../clients/llm.client.js';
import type { ClaudeClient, ClaudeResponse } from '../../clients/claude.client.js';
import type { LLMResponseRepository } from '../../repositories/llmResponse.repository.js';
import { CircuitBreakerService, CircuitOpenError } from '../circuitBreaker.service.js';
import type { PlanIntentHandlerService } from '../planIntentHandler.service.js';

// ============================================================================
// Mocks
// ============================================================================

// Mock logger to avoid noise in test output
vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

// Mock feature flags with controlled state
let mockWebSearchEnabled = true;
let mockBrowserMCPEnabled = false;
vi.mock('../../config/feature-flags.js', () => ({
  isWebSearchEnabled: () => mockWebSearchEnabled,
  isBrowserMCPEnabled: () => mockBrowserMCPEnabled,
  featureFlags: {
    isEnabled: vi.fn().mockReturnValue(true),
    getAllFlags: vi.fn().mockReturnValue({}),
    setFlag: vi.fn(),
  },
}));

// Mock app config — must include database.path for transitive db/client.ts import
vi.mock('../../config/index.js', () => ({
  appConfig: {
    browser: {
      mcpConfigPath: '/mock/browser-mcp.json',
      fetchTopN: 3,
    },
    database: {
      path: ':memory:',
    },
  },
}));

// Mock web search tool
const mockWebSearchExecute = vi.fn();
const mockWebSearchFormatForLLM = vi.fn();
const mockWebSearchGetCachedResults = vi.fn().mockReturnValue(null);
vi.mock('../tools/web-search.tool.js', () => ({
  WebSearchTool: vi.fn(),
  webSearchTool: {
    execute: (...args: unknown[]) => mockWebSearchExecute(...args),
    formatForLLM: (...args: unknown[]) => mockWebSearchFormatForLLM(...args),
    getCachedResults: (...args: unknown[]) => mockWebSearchGetCachedResults(...args),
  },
}));

// Mock PlanIntentHandlerService
const mockHandlePlanIntent = vi.fn();
vi.mock('../planIntentHandler.service.js', () => ({
  PlanIntentHandlerService: class MockPlanIntentHandlerService {
    handlePlanIntent = mockHandlePlanIntent;
  },
}));

// Mock language preference service
vi.mock('../languagePreference.service.js', () => ({
  languagePreferenceService: {
    getLanguageContext: vi.fn().mockReturnValue(''),
    detectLanguageSwitch: vi.fn().mockReturnValue(null),
    detectLanguageFromMessages: vi.fn().mockReturnValue({ language: 'en', confidence: 50 }),
    addToHistory: vi.fn(),
    getMostDetectedLanguage: vi.fn().mockReturnValue(null),
  },
}));

// Mock capabilities
vi.mock('../../config/capabilities.js', () => ({
  capabilityManifest: {
    generateCapabilityPrompt: vi.fn().mockReturnValue(''),
    generateShortSummary: vi.fn().mockReturnValue(''),
    isCapabilityEnabled: vi.fn().mockReturnValue(true),
    getEnabledCapabilities: vi.fn().mockReturnValue([]),
  },
  CAPABILITIES: [],
  CapabilityCategory: {
    MESSAGING: 'messaging',
    FILE_OPS: 'file_operations',
    SYSTEM: 'system_ops',
    AI: 'ai_features',
    MEMORY: 'memory_system',
    SECURITY: 'security',
  },
}));

// ============================================================================
// Helpers
// ============================================================================

const createMockMessage = (overrides?: Partial<Message>): Message => ({
  id: 'msg-1',
  chatId: 'chat-1',
  senderId: 'sender-1',
  telegramMessageId: 12345,
  text: 'Hello',
  isBot: false,
  mediaType: null,
  mediaPath: null,
  mediaFileId: null,
  replyToMessageId: null,
  forwardFromChatId: null,
  forwardFromMessageId: null,
  rawJson: '{}',
  createdAt: new Date(),
  transcript: null,
  transcriptStatus: null,
  transcriptLanguage: null,
  transcriptDurationMs: null,
  transcriptedAt: null,
  transcriptError: null,
  ...overrides,
});

const createMockSender = (overrides?: Partial<Sender>): Sender => ({
  id: 'sender-1',
  telegramId: 12345,
  firstName: 'John',
  lastName: 'Doe',
  username: 'johndoe',
  isBot: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const createMockChat = (overrides?: Partial<Chat>): Chat => ({
  id: 'chat-1',
  telegramId: '123456789',
  type: 'private',
  title: 'Test Chat',
  username: 'testuser',
  firstName: 'Test',
  lastName: 'User',
  isActive: true,
  preferredLanguage: 'en',
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const createMockLLMResponse = (overrides?: Partial<LLMResponse>): LLMResponse => ({
  content: 'Hello! How can I help you today?',
  model: 'llama3.1:8b',
  totalDuration: 1500,
  promptEvalCount: 50,
  evalCount: 30,
  ...overrides,
});

const createMockClaudeResponse = (overrides?: Partial<ClaudeResponse>): ClaudeResponse => ({
  success: true,
  content: 'I can help you with that complex task.',
  durationMs: 2000,
  ...overrides,
});

const createMockEnhancedIntent = (
  childIntent: PlanIntent,
  overrides?: Partial<EnhancedIntentResult>
): EnhancedIntentResult => ({
  parentIntent: 'command',
  childIntent,
  confidence: 0.9,
  confidenceLevel: 'high',
  reasoning: 'Detected plan intent',
  rawResponse: '',
  processingTimeMs: 100,
  tier: 2,
  ...overrides,
});

// ============================================================================
// Tests
// ============================================================================

describe('LLMRouterService', () => {
  let service: LLMRouterService;
  let mockOllamaClient: Partial<LLMClient>;
  let mockClaudeClient: Partial<ClaudeClient>;
  let mockLLMResponseRepo: Partial<LLMResponseRepository>;
  let mockConfig: LLMRouterConfig;

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset feature flag state
    mockWebSearchEnabled = true;
    mockBrowserMCPEnabled = false;

    // Create mock Ollama client
    mockOllamaClient = {
      chat: vi.fn().mockResolvedValue(createMockLLMResponse()),
    };

    // Create mock Claude client
    mockClaudeClient = {
      chat: vi.fn().mockResolvedValue(createMockClaudeResponse()),
      runAgent: vi.fn().mockResolvedValue(createMockClaudeResponse({
        content: 'Agentic task completed successfully.',
      })),
    };

    // Create mock LLM response repository
    mockLLMResponseRepo = {
      create: vi.fn().mockResolvedValue({
        id: 'response-1',
        messageId: 'msg-1',
        promptType: 'response',
        prompt: '{}',
        response: 'Test response',
        model: 'test',
        durationMs: 100,
        promptTokens: 10,
        completionTokens: 20,
        error: null,
        createdAt: new Date(),
      }),
    };

    // Create mock config
    mockConfig = {
      claudeEnabled: true,
      claudeModel: 'sonnet',
    };

    // Reset plan intent handler mock
    mockHandlePlanIntent.mockReset();

    // Create service instance
    service = new LLMRouterService(
      mockOllamaClient as LLMClient,
      mockClaudeClient as ClaudeClient,
      mockLLMResponseRepo as LLMResponseRepository,
      mockConfig
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // handleGreeting Tests
  // ==========================================================================

  describe('handleGreeting', () => {
    it('should handle greeting successfully via Ollama', async () => {
      const message = createMockMessage({ text: 'Hello!' });
      const sender = createMockSender();

      const result = await service.handleGreeting(message, sender);

      expect(result.success).toBe(true);
      expect(result.content).toBe('Hello! How can I help you today?');
      expect(result.routedTo).toBe('ollama');
      expect(result.responseId).toBe('response-1');
      expect(mockOllamaClient.chat).toHaveBeenCalledTimes(1);
      expect(mockLLMResponseRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          messageId: 'msg-1',
          promptType: 'response',
          model: 'llama3.1:8b',
        })
      );
    });

    it('should include personalization context in system prompt', async () => {
      const message = createMockMessage({ text: 'Good morning!' });
      const sender = createMockSender({ firstName: 'Alice' });
      const personalizationContext = 'User prefers casual conversation style.';

      await service.handleGreeting(message, sender, personalizationContext);

      expect(mockOllamaClient.chat).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            role: 'system',
            content: expect.stringContaining('User prefers casual conversation style.'),
          }),
        ]),
        expect.any(String)
      );
    });

    it('should handle null message text', async () => {
      const message = createMockMessage({ text: null as any });
      const sender = createMockSender();

      const result = await service.handleGreeting(message, sender);

      expect(result.success).toBe(true);
      expect(mockOllamaClient.chat).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            role: 'user',
            content: 'Hello', // Default fallback
          }),
        ]),
        expect.any(String)
      );
    });

    it('should fallback to pre-canned response when Ollama fails', async () => {
      const message = createMockMessage({ text: 'Hi there!' });
      const sender = createMockSender();

      vi.mocked(mockOllamaClient.chat!).mockRejectedValue(new Error('Ollama connection failed'));

      const result = await service.handleGreeting(message, sender);

      expect(result.success).toBe(true);
      expect(result.routedTo).toBe('ollama');
      // Should be one of the pre-canned responses
      expect([
        'Hey there!',
        'Hi!',
        'Hello!',
        'Hey, good to hear from you.',
        'Hi there!',
      ]).toContain(result.content);
      expect(mockLLMResponseRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'fallback',
          error: 'Ollama connection failed',
        })
      );
    });

    it('should handle circuit breaker open error and fallback to pre-canned response', async () => {
      const message = createMockMessage({ text: 'Hey!' });
      const sender = createMockSender();

      const circuitOpenError = new CircuitOpenError('ollama', new Date());
      vi.mocked(mockOllamaClient.chat!).mockRejectedValue(circuitOpenError);

      const result = await service.handleGreeting(message, sender);

      expect(result.success).toBe(true);
      expect([
        'Hey there!',
        'Hi!',
        'Hello!',
        'Hey, good to hear from you.',
        'Hi there!',
      ]).toContain(result.content);
    });

    it('should use circuit breaker when configured', async () => {
      const message = createMockMessage({ text: 'Hello!' });
      const sender = createMockSender();

      const mockCircuitBreaker = {
        execute: vi.fn().mockImplementation((fn) => fn()),
        isOpen: vi.fn().mockReturnValue(false),
      } as unknown as CircuitBreakerService;

      service.setOllamaCircuitBreaker(mockCircuitBreaker);

      await service.handleGreeting(message, sender);

      expect(mockCircuitBreaker.execute).toHaveBeenCalledTimes(1);
    });
  });

  // ==========================================================================
  // handleWithClaude Tests
  // ==========================================================================

  describe('handleWithClaude', () => {
    it('should handle complex messages successfully via Claude', async () => {
      const message = createMockMessage({ text: 'Explain quantum computing' });
      const context = 'User is a software engineer';
      const conversationHistory: Message[] = [];

      const result = await service.handleWithClaude(message, context, conversationHistory);

      expect(result.success).toBe(true);
      expect(result.content).toBe('I can help you with that complex task.');
      expect(result.routedTo).toBe('claude');
      expect(mockClaudeClient.chat).toHaveBeenCalledWith(
        'Explain quantum computing',
        'User is a software engineer'
      );
      expect(mockLLMResponseRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'claude-sonnet',
          promptType: 'response',
        })
      );
    });

    it('should fallback to Ollama when Claude is disabled', async () => {
      const message = createMockMessage({ text: 'Complex question' });
      const context = '';
      const conversationHistory: Message[] = [];

      // Create service with Claude disabled
      const disabledConfig: LLMRouterConfig = {
        claudeEnabled: false,
        claudeModel: 'sonnet',
      };
      const serviceWithDisabledClaude = new LLMRouterService(
        mockOllamaClient as LLMClient,
        mockClaudeClient as ClaudeClient,
        mockLLMResponseRepo as LLMResponseRepository,
        disabledConfig
      );

      const result = await serviceWithDisabledClaude.handleWithClaude(
        message,
        context,
        conversationHistory
      );

      expect(result.success).toBe(true);
      expect(result.routedTo).toBe('ollama');
      expect(mockClaudeClient.chat).not.toHaveBeenCalled();
      expect(mockOllamaClient.chat).toHaveBeenCalled();
    });

    it('should fallback to Ollama when Claude circuit breaker is open', async () => {
      const message = createMockMessage({ text: 'Another complex question' });
      const context = '';
      const conversationHistory: Message[] = [];

      const mockCircuitBreaker = {
        execute: vi.fn(),
        isOpen: vi.fn().mockReturnValue(true),
      } as unknown as CircuitBreakerService;

      service.setClaudeCircuitBreaker(mockCircuitBreaker);

      const result = await service.handleWithClaude(message, context, conversationHistory);

      expect(result.success).toBe(true);
      expect(result.routedTo).toBe('ollama');
      expect(mockCircuitBreaker.isOpen).toHaveBeenCalled();
      expect(mockClaudeClient.chat).not.toHaveBeenCalled();
    });

    it('should fallback to Ollama when Claude returns unsuccessful response', async () => {
      const message = createMockMessage({ text: 'Question' });
      const context = '';
      const conversationHistory: Message[] = [];

      vi.mocked(mockClaudeClient.chat!).mockResolvedValue({
        success: false,
        content: '',
        error: 'Rate limited',
        durationMs: 100,
      });

      const result = await service.handleWithClaude(message, context, conversationHistory);

      expect(result.success).toBe(true);
      expect(result.routedTo).toBe('ollama');
      expect(mockOllamaClient.chat).toHaveBeenCalled();
    });

    it('should fallback to Ollama when Claude throws an error', async () => {
      const message = createMockMessage({ text: 'Question' });
      const context = '';
      const conversationHistory: Message[] = [];

      vi.mocked(mockClaudeClient.chat!).mockRejectedValue(new Error('Claude CLI crashed'));

      const result = await service.handleWithClaude(message, context, conversationHistory);

      expect(result.success).toBe(true);
      expect(result.routedTo).toBe('ollama');
    });

    it('should use circuit breaker for Claude calls when configured', async () => {
      const message = createMockMessage({ text: 'Question' });
      const context = '';
      const conversationHistory: Message[] = [];

      const mockCircuitBreaker = {
        execute: vi.fn().mockImplementation((fn) => fn()),
        isOpen: vi.fn().mockReturnValue(false),
      } as unknown as CircuitBreakerService;

      service.setClaudeCircuitBreaker(mockCircuitBreaker);

      await service.handleWithClaude(message, context, conversationHistory);

      expect(mockCircuitBreaker.execute).toHaveBeenCalled();
    });

    it('should handle CircuitOpenError from Claude circuit breaker', async () => {
      const message = createMockMessage({ text: 'Question' });
      const context = '';
      const conversationHistory: Message[] = [];

      const mockCircuitBreaker = {
        execute: vi.fn().mockRejectedValue(new CircuitOpenError('claude', new Date())),
        isOpen: vi.fn().mockReturnValue(false),
      } as unknown as CircuitBreakerService;

      service.setClaudeCircuitBreaker(mockCircuitBreaker);

      const result = await service.handleWithClaude(message, context, conversationHistory);

      expect(result.success).toBe(true);
      expect(result.routedTo).toBe('ollama');
    });
  });

  // ==========================================================================
  // handleAgenticRequest Tests
  // ==========================================================================

  describe('handleAgenticRequest', () => {
    it('should handle agentic request successfully', async () => {
      const message = createMockMessage({ text: 'Create a file called test.ts' });
      const sender = createMockSender({ firstName: 'Alice', username: 'alice' });
      const conversationHistory: Message[] = [];

      const result = await service.handleAgenticRequest(message, conversationHistory, sender);

      expect(result.success).toBe(true);
      expect(result.content).toBe('Agentic task completed successfully.');
      expect(result.routedTo).toBe('claude');
      expect(mockClaudeClient.runAgent).toHaveBeenCalledWith(
        expect.stringContaining('Create a file called test.ts'),
        expect.objectContaining({
          timeoutMs: 120000,
          allowedTools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'],
        })
      );
    });

    it('should include conversation history in context', async () => {
      const message = createMockMessage({ text: 'Do the same thing again' });
      const sender = createMockSender({ id: 'sender-1' });
      const conversationHistory: Message[] = [
        createMockMessage({
          id: 'msg-old',
          text: 'Previous message',
          senderId: 'sender-1',
          isBot: false,
        }),
        createMockMessage({
          id: 'msg-bot',
          text: 'Bot response',
          senderId: 'bot-id',
          isBot: true,
        }),
      ];

      await service.handleAgenticRequest(message, conversationHistory, sender);

      expect(mockClaudeClient.runAgent).toHaveBeenCalledWith(
        expect.stringContaining('Previous message'),
        expect.any(Object)
      );
    });

    it('should NOT fallback to Ollama when agentic task fails (to avoid inconsistent state)', async () => {
      const message = createMockMessage({ text: 'Create file test.ts' });
      const sender = createMockSender();
      const conversationHistory: Message[] = [];

      vi.mocked(mockClaudeClient.runAgent!).mockResolvedValue({
        success: false,
        content: '',
        error: 'Agent timeout',
        durationMs: 120000,
      });

      const result = await service.handleAgenticRequest(message, conversationHistory, sender);

      // Should NOT fall back to Ollama - agentic tasks may have side effects
      expect(result.success).toBe(false);
      expect(result.routedTo).toBe('claude');
      expect(result.error).toBe('Agent timeout');
      expect(mockOllamaClient.chat).not.toHaveBeenCalled();
    });

    it('should NOT fallback to Ollama when runAgent throws an error (to avoid inconsistent state)', async () => {
      const message = createMockMessage({ text: 'Create file test.ts' });
      const sender = createMockSender();
      const conversationHistory: Message[] = [];

      vi.mocked(mockClaudeClient.runAgent!).mockRejectedValue(new Error('CLI not found'));

      const result = await service.handleAgenticRequest(message, conversationHistory, sender);

      // Should NOT fall back to Ollama - agentic tasks may have side effects
      expect(result.success).toBe(false);
      expect(result.routedTo).toBe('claude');
      expect(result.error).toBe('CLI not found');
      expect(mockOllamaClient.chat).not.toHaveBeenCalled();
    });

    it('should use circuit breaker for agentic requests when configured', async () => {
      const message = createMockMessage({ text: 'Create file' });
      const sender = createMockSender();
      const conversationHistory: Message[] = [];

      const mockCircuitBreaker = {
        execute: vi.fn().mockImplementation((fn) => fn()),
        isOpen: vi.fn().mockReturnValue(false),
      } as unknown as CircuitBreakerService;

      service.setClaudeCircuitBreaker(mockCircuitBreaker);

      await service.handleAgenticRequest(message, conversationHistory, sender);

      expect(mockCircuitBreaker.execute).toHaveBeenCalled();
    });

    it('should handle null sender gracefully', async () => {
      const message = createMockMessage({ text: 'Create file test.ts' });
      const conversationHistory: Message[] = [];

      const result = await service.handleAgenticRequest(message, conversationHistory, null);

      expect(result.success).toBe(true);
      expect(mockClaudeClient.runAgent).toHaveBeenCalled();
    });

    it('should pass mcpConfigPath when browser MCP is enabled', async () => {
      mockBrowserMCPEnabled = true;
      const message = createMockMessage({ text: 'Create file test.ts' });
      const sender = createMockSender();
      const conversationHistory: Message[] = [];

      await service.handleAgenticRequest(message, conversationHistory, sender);

      expect(mockClaudeClient.runAgent).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          mcpConfigPath: '/mock/browser-mcp.json',
        })
      );
    });

    it('should omit mcpConfigPath when browser MCP is disabled', async () => {
      mockBrowserMCPEnabled = false;
      const message = createMockMessage({ text: 'Create file test.ts' });
      const sender = createMockSender();
      const conversationHistory: Message[] = [];

      await service.handleAgenticRequest(message, conversationHistory, sender);

      expect(mockClaudeClient.runAgent).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          mcpConfigPath: undefined,
        })
      );
    });
  });

  // ==========================================================================
  // handleWebSearchRequest Tests
  // ==========================================================================

  describe('handleWebSearchRequest', () => {
    beforeEach(() => {
      mockWebSearchExecute.mockResolvedValue({
        success: true,
        results: [
          { title: 'Result 1', url: 'https://example.com/1', snippet: 'Snippet 1' },
          { title: 'Result 2', url: 'https://example.com/2', snippet: 'Snippet 2' },
        ],
        query: 'test query',
        durationMs: 500,
      });
      mockWebSearchFormatForLLM.mockReturnValue('Formatted search results');
    });

    it('should handle web search request successfully', async () => {
      const message = createMockMessage({ text: 'Search for latest news about AI' });
      const context = '';
      const conversationHistory: Message[] = [];

      const result = await service.handleWebSearchRequest(message, context, conversationHistory);

      expect(result.success).toBe(true);
      expect(result.routedTo).toBe('claude');
      expect(mockWebSearchExecute).toHaveBeenCalledWith('latest news about AI');
      expect(mockClaudeClient.chat).toHaveBeenCalledWith(
        'Search for latest news about AI',
        expect.stringContaining('Formatted search results')
      );
    });

    it('should fallback to Claude without search when web search is disabled', async () => {
      mockWebSearchEnabled = false;
      const message = createMockMessage({ text: 'Search for something' });
      const context = '';
      const conversationHistory: Message[] = [];

      const result = await service.handleWebSearchRequest(message, context, conversationHistory);

      expect(result.success).toBe(true);
      expect(mockWebSearchExecute).not.toHaveBeenCalled();
      expect(mockClaudeClient.chat).toHaveBeenCalled();
    });

    it('should proceed with enhanced context when web search fails', async () => {
      mockWebSearchExecute.mockResolvedValue({
        success: false,
        results: [],
        query: 'test',
        error: 'Search API unavailable',
        durationMs: 100,
      });

      const message = createMockMessage({ text: 'Search for weather' });
      const context = 'base context';
      const conversationHistory: Message[] = [];

      const result = await service.handleWebSearchRequest(message, context, conversationHistory);

      expect(result.success).toBe(true);
      expect(mockClaudeClient.chat).toHaveBeenCalledWith(
        'Search for weather',
        expect.stringContaining('Web search is temporarily unavailable')
      );
    });

    it('should handle web search throwing an error', async () => {
      mockWebSearchExecute.mockRejectedValue(new Error('Network timeout'));

      const message = createMockMessage({ text: 'Search for something' });
      const context = '';
      const conversationHistory: Message[] = [];

      const result = await service.handleWebSearchRequest(message, context, conversationHistory);

      expect(result.success).toBe(true);
      expect(mockClaudeClient.chat).toHaveBeenCalled();
    });

    it('should extract search query from message text', async () => {
      const message = createMockMessage({ text: 'Search for machine learning tutorials' });
      const context = '';
      const conversationHistory: Message[] = [];

      await service.handleWebSearchRequest(message, context, conversationHistory);

      expect(mockWebSearchExecute).toHaveBeenCalledWith('machine learning tutorials');
    });

    it('should extract query from "google" prefix', async () => {
      const message = createMockMessage({ text: 'Google best restaurants near me' });
      const context = '';
      const conversationHistory: Message[] = [];

      await service.handleWebSearchRequest(message, context, conversationHistory);

      expect(mockWebSearchExecute).toHaveBeenCalledWith('best restaurants near me');
    });

    it('should enrich search results with browser content when browserService is set', async () => {
      const mockBrowserService = {
        fetchMultiplePages: vi.fn().mockResolvedValue([
          { url: 'https://example.com/1', success: true, content: 'Full page 1 content', durationMs: 500 },
          { url: 'https://example.com/2', success: true, content: 'Full page 2 content', durationMs: 600 },
        ]),
      };
      service.setBrowserService(mockBrowserService as any);

      const message = createMockMessage({ text: 'Search for AI news' });
      const context = '';
      const conversationHistory: Message[] = [];

      await service.handleWebSearchRequest(message, context, conversationHistory);

      expect(mockBrowserService.fetchMultiplePages).toHaveBeenCalledWith([
        'https://example.com/1',
        'https://example.com/2',
      ]);
      expect(mockClaudeClient.chat).toHaveBeenCalledWith(
        'Search for AI news',
        expect.stringContaining('[Full Page Content]')
      );
      expect(mockClaudeClient.chat).toHaveBeenCalledWith(
        'Search for AI news',
        expect.stringContaining('Full page 1 content')
      );
    });

    it('should fall back to snippets when browserService fetch fails', async () => {
      const mockBrowserService = {
        fetchMultiplePages: vi.fn().mockRejectedValue(new Error('Browser crashed')),
      };
      service.setBrowserService(mockBrowserService as any);

      const message = createMockMessage({ text: 'Search for AI news' });
      const context = '';
      const conversationHistory: Message[] = [];

      const result = await service.handleWebSearchRequest(message, context, conversationHistory);

      expect(result.success).toBe(true);
      expect(mockClaudeClient.chat).toHaveBeenCalledWith(
        'Search for AI news',
        expect.not.stringContaining('[Full Page Content]')
      );
    });

    it('should work without browserService (existing behavior preserved)', async () => {
      // browserService is null by default
      const message = createMockMessage({ text: 'Search for AI news' });
      const context = '';
      const conversationHistory: Message[] = [];

      const result = await service.handleWebSearchRequest(message, context, conversationHistory);

      expect(result.success).toBe(true);
      expect(mockClaudeClient.chat).toHaveBeenCalledWith(
        'Search for AI news',
        expect.stringContaining('Formatted search results')
      );
      expect(mockClaudeClient.chat).toHaveBeenCalledWith(
        'Search for AI news',
        expect.not.stringContaining('[Full Page Content]')
      );
    });
  });

  // ==========================================================================
  // handlePlanIntent Tests
  // ==========================================================================

  describe('handlePlanIntent', () => {
    it('should handle plan_propose intent', async () => {
      const message = createMockMessage({ text: 'Create a plan to build a REST API' });
      const chat = createMockChat();
      const sender = createMockSender();
      const enhancedIntent = createMockEnhancedIntent('plan_propose');

      mockHandlePlanIntent.mockResolvedValue({
        success: true,
        response: 'Plan created successfully',
        plan: { id: 'plan-1', status: 'draft' },
      });

      const result = await service.handlePlanIntent(message, chat, sender, enhancedIntent);

      expect(result.success).toBe(true);
      expect(result.content).toBe('Plan created successfully');
      expect(result.routedTo).toBe('claude');
      expect(mockHandlePlanIntent).toHaveBeenCalledWith('plan_propose', {
        message,
        chat,
        sender,
        messageText: message.text,
      });
    });

    it('should handle plan_approve intent', async () => {
      const message = createMockMessage({ text: 'Approve the plan' });
      const chat = createMockChat();
      const sender = createMockSender();
      const enhancedIntent = createMockEnhancedIntent('plan_approve');

      mockHandlePlanIntent.mockResolvedValue({
        success: true,
        response: 'Plan approved',
        plan: { id: 'plan-1', status: 'approved' },
      });

      const result = await service.handlePlanIntent(message, chat, sender, enhancedIntent);

      expect(result.success).toBe(true);
      expect(result.content).toBe('Plan approved');
    });

    it('should handle plan_execute intent', async () => {
      const message = createMockMessage({ text: 'Execute the plan' });
      const chat = createMockChat();
      const sender = createMockSender();
      const enhancedIntent = createMockEnhancedIntent('plan_execute');

      mockHandlePlanIntent.mockResolvedValue({
        success: true,
        response: 'Plan execution started',
        plan: { id: 'plan-1', status: 'executing' },
      });

      const result = await service.handlePlanIntent(message, chat, sender, enhancedIntent);

      expect(result.success).toBe(true);
      expect(result.content).toBe('Plan execution started');
    });

    it('should handle plan intent handler failure', async () => {
      const message = createMockMessage({ text: 'Create a plan' });
      const chat = createMockChat();
      const sender = createMockSender();
      const enhancedIntent = createMockEnhancedIntent('plan_propose');

      mockHandlePlanIntent.mockResolvedValue({
        success: false,
        response: 'Failed to create plan',
      });

      const result = await service.handlePlanIntent(message, chat, sender, enhancedIntent);

      expect(result.success).toBe(false);
      expect(result.content).toBe('Failed to create plan');
      expect(result.routedTo).toBe('claude');
    });

    it('should handle plan intent handler throwing an error', async () => {
      const message = createMockMessage({ text: 'Create a plan' });
      const chat = createMockChat();
      const sender = createMockSender();
      const enhancedIntent = createMockEnhancedIntent('plan_propose');

      mockHandlePlanIntent.mockRejectedValue(new Error('Database connection lost'));

      const result = await service.handlePlanIntent(message, chat, sender, enhancedIntent);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Database connection lost');
      expect(result.content).toContain('Database connection lost');
    });

    it('should store plan response in repository', async () => {
      const message = createMockMessage({ text: 'Create a plan' });
      const chat = createMockChat();
      const sender = createMockSender();
      const enhancedIntent = createMockEnhancedIntent('plan_propose');

      mockHandlePlanIntent.mockResolvedValue({
        success: true,
        response: 'Plan created',
        plan: { id: 'plan-1', status: 'draft' },
      });

      await service.handlePlanIntent(message, chat, sender, enhancedIntent);

      expect(mockLLMResponseRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          messageId: 'msg-1',
          promptType: 'response',
          model: 'claude-plan-handler',
        })
      );
    });
  });

  // ==========================================================================
  // fallbackToOllama Tests
  // ==========================================================================

  describe('fallbackToOllama', () => {
    it('should fallback to Ollama successfully', async () => {
      const message = createMockMessage({ text: 'Some question' });
      const conversationHistory: Message[] = [];

      const result = await service.fallbackToOllama(message, conversationHistory);

      expect(result.success).toBe(true);
      expect(result.routedTo).toBe('ollama');
      expect(mockOllamaClient.chat).toHaveBeenCalled();
    });

    it('should include conversation history in fallback', async () => {
      const message = createMockMessage({ text: 'Follow up question' });
      const conversationHistory: Message[] = [
        createMockMessage({ text: 'Previous question', isBot: false }),
        createMockMessage({ text: 'Previous answer', isBot: true }),
      ];

      await service.fallbackToOllama(message, conversationHistory);

      expect(mockOllamaClient.chat).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ role: 'system' }),
          expect.objectContaining({ role: 'user', content: 'Previous question' }),
          expect.objectContaining({ role: 'assistant', content: 'Previous answer' }),
          expect.objectContaining({ role: 'user', content: 'Follow up question' }),
        ]),
        expect.any(String)
      );
    });

    it('should return last-resort static response when Ollama fallback also fails', async () => {
      const message = createMockMessage({ text: 'Some question' });
      const conversationHistory: Message[] = [];

      vi.mocked(mockOllamaClient.chat!).mockRejectedValue(new Error('Ollama unavailable'));

      const result = await service.fallbackToOllama(message, conversationHistory);

      expect(result.success).toBe(true);
      expect(result.content).toBeTruthy();
      expect(result.routedTo).toBe('last_resort');
    });

    it('should store failed fallback attempt', async () => {
      const message = createMockMessage({ text: 'Some question' });
      const conversationHistory: Message[] = [];

      vi.mocked(mockOllamaClient.chat!).mockRejectedValue(new Error('Connection refused'));

      await service.fallbackToOllama(message, conversationHistory);

      expect(mockLLMResponseRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'ollama',
          error: 'Connection refused',
          response: '',
        })
      );
    });

    it('should use circuit breaker when configured', async () => {
      const message = createMockMessage({ text: 'Question' });
      const conversationHistory: Message[] = [];

      const mockCircuitBreaker = {
        execute: vi.fn().mockImplementation((fn) => fn()),
        isOpen: vi.fn().mockReturnValue(false),
      } as unknown as CircuitBreakerService;

      service.setOllamaCircuitBreaker(mockCircuitBreaker);

      await service.fallbackToOllama(message, conversationHistory);

      expect(mockCircuitBreaker.execute).toHaveBeenCalled();
    });

    it('should return last-resort response when circuit breaker is open', async () => {
      const message = createMockMessage({ text: 'Question' });
      const conversationHistory: Message[] = [];

      const mockCircuitBreaker = {
        execute: vi.fn().mockRejectedValue(new CircuitOpenError('ollama', new Date())),
        isOpen: vi.fn().mockReturnValue(false),
      } as unknown as CircuitBreakerService;

      service.setOllamaCircuitBreaker(mockCircuitBreaker);

      const result = await service.fallbackToOllama(message, conversationHistory);

      expect(result.success).toBe(true);
      expect(result.routedTo).toBe('last_resort');
    });

    it('should skip messages without text in conversation history', async () => {
      const message = createMockMessage({ text: 'Current message' });
      const conversationHistory: Message[] = [
        createMockMessage({ text: null as any, isBot: false }),
        createMockMessage({ text: 'Valid message', isBot: false }),
      ];

      await service.fallbackToOllama(message, conversationHistory);

      const chatCall = vi.mocked(mockOllamaClient.chat!).mock.calls[0][0] as ChatMessage[];
      // System + 1 valid history + current = 3 messages
      expect(chatCall).toHaveLength(3);
    });
  });

  // ==========================================================================
  // isAgenticRequest Tests
  // ==========================================================================

  describe('isAgenticRequest', () => {
    describe('file operations patterns', () => {
      it('should detect "create a file" pattern', () => {
        expect(service.isAgenticRequest('create a file called test.ts')).toBe(true);
        expect(service.isAgenticRequest('Create file config.json')).toBe(true);
        expect(service.isAgenticRequest('please create a file')).toBe(true);
      });

      it('should detect "write to file" pattern', () => {
        expect(service.isAgenticRequest('write to file README.md')).toBe(true);
        expect(service.isAgenticRequest('Write file contents')).toBe(true);
      });

      it('should detect "save to" pattern', () => {
        expect(service.isAgenticRequest('save to test.txt')).toBe(true);
        expect(service.isAgenticRequest('save in the config folder')).toBe(true);
        expect(service.isAgenticRequest('save into database')).toBe(true);
      });

      it('should detect "put in" pattern', () => {
        expect(service.isAgenticRequest('put it in the src folder')).toBe(true);
        expect(service.isAgenticRequest('put inside the container')).toBe(true);
        expect(service.isAgenticRequest('put into the config')).toBe(true);
      });

      it('should detect "implement" pattern with file extensions', () => {
        expect(service.isAgenticRequest('implement auth.service.ts')).toBe(true);
        expect(service.isAgenticRequest('implement the feature in utils.js')).toBe(true);
        expect(service.isAgenticRequest('implement readme.md')).toBe(true);
      });

      it('should detect file extension patterns', () => {
        expect(service.isAgenticRequest('update the .ts file in src')).toBe(true);
        expect(service.isAgenticRequest('create impl.md')).toBe(true);
        expect(service.isAgenticRequest('put this in .json file')).toBe(true);
      });

      it('should detect "draw up a plan" pattern', () => {
        expect(service.isAgenticRequest('draw up a plan for the feature')).toBe(true);
      });

      it('should detect "write code" pattern', () => {
        expect(service.isAgenticRequest('write code for authentication')).toBe(true);
        expect(service.isAgenticRequest('write implementation for the API')).toBe(true);
      });
    });

    describe('shell/script operations patterns', () => {
      it('should detect "run script" pattern', () => {
        expect(service.isAgenticRequest('run the script')).toBe(true);
        expect(service.isAgenticRequest('run command npm install')).toBe(true);
        expect(service.isAgenticRequest('run bash')).toBe(true);
      });

      it('should detect "execute" pattern', () => {
        expect(service.isAgenticRequest('execute the script')).toBe(true);
        expect(service.isAgenticRequest('execute command')).toBe(true);
      });

      it('should detect "start/stop/restart" patterns', () => {
        expect(service.isAgenticRequest('start the server')).toBe(true);
        expect(service.isAgenticRequest('stop the service')).toBe(true);
        expect(service.isAgenticRequest('restart process')).toBe(true);
      });

      it('should detect "kick off" pattern', () => {
        expect(service.isAgenticRequest('kick off the build')).toBe(true);
        expect(service.isAgenticRequest('kick it off')).toBe(true);
      });

      it('should detect .sh file references', () => {
        expect(service.isAgenticRequest('run loop.sh')).toBe(true);
        expect(service.isAgenticRequest('execute deploy.sh')).toBe(true);
      });

      it('should detect "check if running" patterns', () => {
        expect(service.isAgenticRequest('check if running')).toBe(true);
        expect(service.isAgenticRequest("check if it's running")).toBe(true);
        expect(service.isAgenticRequest('is it running?')).toBe(true);
      });

      it('should detect process status patterns', () => {
        expect(service.isAgenticRequest('ps aux')).toBe(true);
        expect(service.isAgenticRequest('process list')).toBe(true);
        expect(service.isAgenticRequest('processes running')).toBe(true);
      });
    });

    describe('system operations patterns', () => {
      it('should detect "install" pattern', () => {
        expect(service.isAgenticRequest('install the dependency')).toBe(true);
        expect(service.isAgenticRequest('install node')).toBe(true);
      });

      it('should detect "deploy" pattern', () => {
        expect(service.isAgenticRequest('deploy to production')).toBe(true);
      });

      it('should detect "build" pattern', () => {
        expect(service.isAgenticRequest('build the project')).toBe(true);
        expect(service.isAgenticRequest('build the app')).toBe(true);
      });

      it('should detect npm commands', () => {
        expect(service.isAgenticRequest('npm run build')).toBe(true);
        expect(service.isAgenticRequest('npm install lodash')).toBe(true);
        expect(service.isAgenticRequest('npm start')).toBe(true);
        expect(service.isAgenticRequest('npm test')).toBe(true);
      });

      it('should detect git commands', () => {
        expect(service.isAgenticRequest('git status')).toBe(true);
        expect(service.isAgenticRequest('git pull origin main')).toBe(true);
        expect(service.isAgenticRequest('git push')).toBe(true);
        expect(service.isAgenticRequest('git commit -m "fix"')).toBe(true);
        expect(service.isAgenticRequest('git clone repo')).toBe(true);
      });
    });

    describe('follow-up patterns with conversation history', () => {
      it('should detect "try again" as follow-up to agentic request', () => {
        const conversationHistory: Message[] = [
          createMockMessage({ text: 'create a file test.ts' }),
        ];

        expect(service.isAgenticRequest('try again', conversationHistory)).toBe(true);
        expect(service.isAgenticRequest('try one more', conversationHistory)).toBe(true);
      });

      it('should detect "do it" as follow-up to agentic request', () => {
        const conversationHistory: Message[] = [
          createMockMessage({ text: 'write to file config.json' }),
        ];

        expect(service.isAgenticRequest('do it', conversationHistory)).toBe(true);
      });

      it('should detect "go ahead" as follow-up', () => {
        const conversationHistory: Message[] = [
          createMockMessage({ text: 'npm install lodash' }),
        ];

        expect(service.isAgenticRequest('go ahead', conversationHistory)).toBe(true);
        expect(service.isAgenticRequest('go for it', conversationHistory)).toBe(true);
      });

      it('should detect "yes please" as follow-up', () => {
        const conversationHistory: Message[] = [
          createMockMessage({ text: 'run the script' }),
        ];

        expect(service.isAgenticRequest('yes please', conversationHistory)).toBe(true);
        expect(service.isAgenticRequest('yes', conversationHistory)).toBe(true);
      });

      it('should detect "retry" as follow-up', () => {
        const conversationHistory: Message[] = [
          createMockMessage({ text: 'git push' }),
        ];

        expect(service.isAgenticRequest('retry', conversationHistory)).toBe(true);
      });

      it('should not detect follow-up without agentic history', () => {
        const conversationHistory: Message[] = [
          createMockMessage({ text: 'what is the weather?' }),
        ];

        expect(service.isAgenticRequest('try again', conversationHistory)).toBe(false);
        expect(service.isAgenticRequest('do it', conversationHistory)).toBe(false);
      });

      it('should check last 5 messages for agentic patterns', () => {
        const conversationHistory: Message[] = [
          createMockMessage({ text: 'create file test.ts' }), // This should be found
          createMockMessage({ text: 'response 1' }),
          createMockMessage({ text: 'response 2' }),
          createMockMessage({ text: 'response 3' }),
          createMockMessage({ text: 'response 4' }),
        ];

        expect(service.isAgenticRequest('try again', conversationHistory)).toBe(true);
      });
    });

    describe('non-agentic patterns', () => {
      it('should return false for simple questions', () => {
        expect(service.isAgenticRequest('What is the weather?')).toBe(false);
        expect(service.isAgenticRequest('How are you?')).toBe(false);
        expect(service.isAgenticRequest('Tell me about quantum computing')).toBe(false);
      });

      it('should return false for empty text', () => {
        expect(service.isAgenticRequest('')).toBe(false);
      });

      it('should return false without conversation history for follow-up patterns', () => {
        expect(service.isAgenticRequest('try again')).toBe(false);
        expect(service.isAgenticRequest('do it')).toBe(false);
      });
    });
  });

  // ==========================================================================
  // requiresWebSearch Tests
  // ==========================================================================

  describe('requiresWebSearch', () => {
    describe('weather patterns', () => {
      it('should detect weather queries', () => {
        expect(service.requiresWebSearch('What is the weather in New York?')).toBe(true);
        expect(service.requiresWebSearch('forecast for tomorrow')).toBe(true);
        expect(service.requiresWebSearch('temperature in London')).toBe(true);
      });
    });

    describe('current events and news patterns', () => {
      it('should detect current news queries', () => {
        expect(service.requiresWebSearch('current news about AI')).toBe(true);
        expect(service.requiresWebSearch("today's news")).toBe(true);
        expect(service.requiresWebSearch('latest news')).toBe(true);
        expect(service.requiresWebSearch('recent stock price')).toBe(true);
      });

      it('should detect "who won" queries', () => {
        expect(service.requiresWebSearch('who won the game yesterday')).toBe(true);
        expect(service.requiresWebSearch('who won last night')).toBe(true);
      });

      it('should detect time zone queries', () => {
        expect(service.requiresWebSearch('what time is it in Tokyo?')).toBe(true);
      });

      it('should detect "what is happening" queries', () => {
        expect(service.requiresWebSearch("what's going on in the world?")).toBe(true);
        expect(service.requiresWebSearch("what's happening in tech")).toBe(true);
      });

      it('should detect news/headlines patterns', () => {
        expect(service.requiresWebSearch('news about climate change')).toBe(true);
        expect(service.requiresWebSearch('headlines from CNN')).toBe(true);
        expect(service.requiresWebSearch('give me the news')).toBe(true);
        expect(service.requiresWebSearch('tell me the headlines')).toBe(true);
      });
    });

    describe('explicit search patterns', () => {
      it('should detect "search" prefix', () => {
        expect(service.requiresWebSearch('search for best restaurants')).toBe(true);
        expect(service.requiresWebSearch('search me something')).toBe(true);
      });

      it('should detect "google" prefix', () => {
        expect(service.requiresWebSearch('google best practices')).toBe(true);
      });

      it('should detect "look up" pattern', () => {
        expect(service.requiresWebSearch('look up TypeScript documentation')).toBe(true);
      });

      it('should detect "find" prefix', () => {
        expect(service.requiresWebSearch('find me a recipe')).toBe(true);
      });
    });

    describe('price and market patterns', () => {
      it('should detect price queries', () => {
        expect(service.requiresWebSearch('price of gold')).toBe(true);
        expect(service.requiresWebSearch('cost for iPhone')).toBe(true);
      });

      it('should detect crypto/stock queries', () => {
        expect(service.requiresWebSearch('bitcoin price')).toBe(true);
        expect(service.requiresWebSearch('ethereum value')).toBe(true);
        expect(service.requiresWebSearch('stock price of AAPL')).toBe(true);
        expect(service.requiresWebSearch('crypto worth')).toBe(true);
      });
    });

    describe('sports patterns', () => {
      it('should detect score queries', () => {
        expect(service.requiresWebSearch('score of the game')).toBe(true);
        expect(service.requiresWebSearch('result from yesterday')).toBe(true);
      });

      it('should detect "who is playing" queries', () => {
        expect(service.requiresWebSearch('who is playing tonight')).toBe(true);
        expect(service.requiresWebSearch('who won the match')).toBe(true);
        expect(service.requiresWebSearch('who lost yesterday')).toBe(true);
      });
    });

    describe('non-search patterns', () => {
      it('should return false for general questions', () => {
        expect(service.requiresWebSearch('How does async/await work?')).toBe(false);
        expect(service.requiresWebSearch('Explain recursion')).toBe(false);
        expect(service.requiresWebSearch('What is TypeScript?')).toBe(false);
      });

      it('should return false for empty or null text', () => {
        expect(service.requiresWebSearch('')).toBe(false);
        expect(service.requiresWebSearch(null as any)).toBe(false);
      });

      it('should return false when web search is disabled', () => {
        mockWebSearchEnabled = false;
        expect(service.requiresWebSearch('What is the weather?')).toBe(false);
      });
    });
  });

  // ==========================================================================
  // Circuit Breaker Configuration Tests
  // ==========================================================================

  describe('setOllamaCircuitBreaker', () => {
    it('should configure Ollama circuit breaker', async () => {
      const mockCircuitBreaker = {
        execute: vi.fn().mockImplementation((fn) => fn()),
        isOpen: vi.fn().mockReturnValue(false),
      } as unknown as CircuitBreakerService;

      service.setOllamaCircuitBreaker(mockCircuitBreaker);

      const message = createMockMessage({ text: 'Hello' });
      await service.handleGreeting(message, createMockSender());

      expect(mockCircuitBreaker.execute).toHaveBeenCalled();
    });
  });

  describe('setClaudeCircuitBreaker', () => {
    it('should configure Claude circuit breaker', async () => {
      const mockCircuitBreaker = {
        execute: vi.fn().mockImplementation((fn) => fn()),
        isOpen: vi.fn().mockReturnValue(false),
      } as unknown as CircuitBreakerService;

      service.setClaudeCircuitBreaker(mockCircuitBreaker);

      const message = createMockMessage({ text: 'Complex question' });
      await service.handleWithClaude(message, '', []);

      expect(mockCircuitBreaker.execute).toHaveBeenCalled();
    });

    it('should check isOpen before making Claude calls', async () => {
      const mockCircuitBreaker = {
        execute: vi.fn(),
        isOpen: vi.fn().mockReturnValue(true),
      } as unknown as CircuitBreakerService;

      service.setClaudeCircuitBreaker(mockCircuitBreaker);

      const message = createMockMessage({ text: 'Question' });
      const result = await service.handleWithClaude(message, '', []);

      expect(mockCircuitBreaker.isOpen).toHaveBeenCalled();
      expect(mockCircuitBreaker.execute).not.toHaveBeenCalled();
      expect(result.routedTo).toBe('ollama');
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('edge cases', () => {
    it('should handle message with only whitespace', async () => {
      const message = createMockMessage({ text: '   ' });
      const sender = createMockSender();

      const result = await service.handleGreeting(message, sender);

      expect(result.success).toBe(true);
    });

    it('should handle very long message text', async () => {
      const longText = 'x'.repeat(10000);
      const message = createMockMessage({ text: longText });
      const sender = createMockSender();

      const result = await service.handleGreeting(message, sender);

      expect(result.success).toBe(true);
    });

    it('should handle empty conversation history array', async () => {
      const message = createMockMessage({ text: 'Question' });
      const result = await service.fallbackToOllama(message, []);

      expect(result.success).toBe(true);
    });

    it('should handle large conversation history', async () => {
      const message = createMockMessage({ text: 'Question' });
      const largeHistory: Message[] = Array.from({ length: 100 }, (_, i) =>
        createMockMessage({ id: `msg-${i}`, text: `Message ${i}` })
      );

      const result = await service.fallbackToOllama(message, largeHistory);

      expect(result.success).toBe(true);
      // Should only use last 10 messages
      const chatCall = vi.mocked(mockOllamaClient.chat!).mock.calls[0][0] as ChatMessage[];
      // system + 10 history + current
      expect(chatCall.length).toBeLessThanOrEqual(12);
    });
  });
});
