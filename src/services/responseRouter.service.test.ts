#!/usr/bin/env npx tsx
/**
 * ResponseRouterService Tests
 *
 * Run: npx tsx src/services/responseRouter.service.test.ts
 */

import { ResponseRouterService, ResponseRouterConfig } from './responseRouter.service';
import { IntentClassifierService, IntentClassificationResult } from './intentClassifier.service';
import { LLMClient, ChatMessage, LLMResponse } from '../clients/llm.client';
import { ClaudeClient, ClaudeResponse } from '../clients/claude.client';
import { LLMResponseRepository } from '../repositories/llmResponse.repository';
import { Message, Chat, Sender, LLMResponseRecord } from '../types';

// Simple test helpers
let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve(fn())
    .then(() => {
      console.log(`✓ ${name}`);
      passed++;
    })
    .catch((err) => {
      console.log(`✗ ${name}`);
      console.log(`  Error: ${err.message}`);
      failed++;
    });
}

function assertEqual<T>(actual: T, expected: T, message?: string) {
  if (actual !== expected) {
    throw new Error(message || `Expected ${expected}, got ${actual}`);
  }
}

function assertTrue(condition: boolean, message?: string) {
  if (!condition) {
    throw new Error(message || 'Expected true');
  }
}

// Mock classes
class MockIntentClassifier {
  private intent: IntentClassificationResult;

  constructor(intent: Partial<IntentClassificationResult> = {}) {
    this.intent = {
      intent: intent.intent || 'general_chat',
      confidence: intent.confidence || 0.9,
      durationMs: intent.durationMs || 100,
    };
  }

  async classifyIntent(_message: string, _context?: string): Promise<IntentClassificationResult> {
    return this.intent;
  }

  setIntent(intent: Partial<IntentClassificationResult>) {
    this.intent = { ...this.intent, ...intent };
  }
}

class MockOllamaClient {
  private response: LLMResponse;
  private shouldFail: boolean;
  public chatCalled = false;
  public lastMessages: ChatMessage[] = [];

  constructor(options: { response?: Partial<LLMResponse>; shouldFail?: boolean } = {}) {
    this.response = {
      content: options.response?.content || 'Hello! How can I help?',
      model: options.response?.model || 'test-model',
      promptEvalCount: options.response?.promptEvalCount ?? 10,
      evalCount: options.response?.evalCount ?? 20,
    };
    this.shouldFail = options.shouldFail || false;
  }

  async chat(messages: ChatMessage[], _requestId?: string): Promise<LLMResponse> {
    this.chatCalled = true;
    this.lastMessages = messages;

    if (this.shouldFail) {
      throw new Error('Ollama API error');
    }

    return this.response;
  }

  setResponse(response: Partial<LLMResponse>) {
    this.response = { ...this.response, ...response };
  }

  setFail(shouldFail: boolean) {
    this.shouldFail = shouldFail;
  }
}

class MockClaudeClient {
  private response: ClaudeResponse;
  public chatCalled = false;
  public lastMessage = '';
  public lastContext = '';

  constructor(options: { response?: Partial<ClaudeResponse> } = {}) {
    this.response = {
      success: options.response?.success ?? true,
      content: options.response?.content || 'Claude response here',
      error: options.response?.error,
      durationMs: options.response?.durationMs || 1000,
    };
  }

  async chat(message: string, context?: string): Promise<ClaudeResponse> {
    this.chatCalled = true;
    this.lastMessage = message;
    this.lastContext = context || '';
    return this.response;
  }

  setResponse(response: Partial<ClaudeResponse>) {
    this.response = { ...this.response, ...response };
  }
}

class MockLLMResponseRepository {
  public createdResponses: Array<Omit<LLMResponseRecord, 'id' | 'createdAt'> & { id: string }> = [];

  async create(
    data: Omit<LLMResponseRecord, 'id' | 'createdAt'>
  ): Promise<LLMResponseRecord> {
    const record = {
      ...data,
      id: `resp-${Date.now()}`,
      createdAt: new Date(),
    } as LLMResponseRecord;
    this.createdResponses.push({ ...data, id: record.id });
    return record;
  }

  getLastResponse() {
    return this.createdResponses[this.createdResponses.length - 1];
  }
}

// Test fixtures
function createMockMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'msg-123',
    chatId: 'chat-456',
    senderId: 'sender-789',
    telegramMessageId: 1,
    text: 'Hello there!',
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
    telegramId: '123456',
    type: 'private',
    title: null,
    username: 'testuser',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function createMockSender(overrides: Partial<Sender> = {}): Sender {
  return {
    id: 'sender-789',
    telegramId: '987654',
    firstName: 'Test',
    lastName: 'User',
    username: 'testuser',
    phone: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// Default test config with Claude enabled
const testConfig: ResponseRouterConfig = {
  responseEnabled: true,
  claudeEnabled: true,
  claudeModel: 'sonnet',
  contextWindowSize: 10,
  systemPrompt: 'You are a test assistant.',
  useEnhancedClassifier: false, // Use legacy classifier for these tests
  enableIntentLogging: false, // Disable logging for tests
  enableCache: false, // Disable cache for these tests
};

async function runTests() {
  console.log('\n=== ResponseRouterService Tests ===\n');

  // Test 1: Routes simple_greeting to Ollama
  await test('routes simple_greeting intent to Ollama', async () => {
    const mockClassifier = new MockIntentClassifier({ intent: 'simple_greeting', confidence: 0.95 });
    const mockOllama = new MockOllamaClient({ response: { content: 'Hi there!' } });
    const mockClaude = new MockClaudeClient();
    const mockRepo = new MockLLMResponseRepository();

    const router = new ResponseRouterService(
      mockClassifier as unknown as IntentClassifierService,
      mockOllama as unknown as LLMClient,
      mockClaude as unknown as ClaudeClient,
      mockRepo as unknown as LLMResponseRepository,
      testConfig
    );

    const result = await router.generateResponse(
      createMockMessage({ text: 'hello' }),
      createMockChat(),
      createMockSender(),
      []
    );

    assertTrue(result.success);
    assertEqual(result.routedTo, 'ollama');
    assertEqual(result.intent, 'simple_greeting');
    assertTrue(mockOllama.chatCalled);
    assertTrue(!mockClaude.chatCalled);
  });

  // Test 2: Routes needs_web_search to Claude
  await test('routes needs_web_search intent to Claude', async () => {
    const mockClassifier = new MockIntentClassifier({ intent: 'needs_web_search', confidence: 0.9 });
    const mockOllama = new MockOllamaClient();
    const mockClaude = new MockClaudeClient({ response: { content: 'The weather is sunny.' } });
    const mockRepo = new MockLLMResponseRepository();

    const router = new ResponseRouterService(
      mockClassifier as unknown as IntentClassifierService,
      mockOllama as unknown as LLMClient,
      mockClaude as unknown as ClaudeClient,
      mockRepo as unknown as LLMResponseRepository,
      testConfig
    );

    const result = await router.generateResponse(
      createMockMessage({ text: "What's the weather today?" }),
      createMockChat(),
      createMockSender(),
      []
    );

    assertTrue(result.success);
    assertEqual(result.routedTo, 'claude');
    assertEqual(result.intent, 'needs_web_search');
    assertTrue(mockClaude.chatCalled);
  });

  // Test 3: Routes complex_task to Claude
  await test('routes complex_task intent to Claude', async () => {
    const mockClassifier = new MockIntentClassifier({ intent: 'complex_task', confidence: 0.9 });
    const mockOllama = new MockOllamaClient();
    const mockClaude = new MockClaudeClient({ response: { content: 'Here is the code...' } });
    const mockRepo = new MockLLMResponseRepository();

    const router = new ResponseRouterService(
      mockClassifier as unknown as IntentClassifierService,
      mockOllama as unknown as LLMClient,
      mockClaude as unknown as ClaudeClient,
      mockRepo as unknown as LLMResponseRepository,
      testConfig
    );

    const result = await router.generateResponse(
      createMockMessage({ text: 'Write a sorting algorithm' }),
      createMockChat(),
      createMockSender(),
      []
    );

    assertTrue(result.success);
    assertEqual(result.routedTo, 'claude');
    assertEqual(result.intent, 'complex_task');
  });

  // Test 4: Routes general_chat to Claude
  await test('routes general_chat intent to Claude', async () => {
    const mockClassifier = new MockIntentClassifier({ intent: 'general_chat', confidence: 0.85 });
    const mockOllama = new MockOllamaClient();
    const mockClaude = new MockClaudeClient({ response: { content: 'That is interesting!' } });
    const mockRepo = new MockLLMResponseRepository();

    const router = new ResponseRouterService(
      mockClassifier as unknown as IntentClassifierService,
      mockOllama as unknown as LLMClient,
      mockClaude as unknown as ClaudeClient,
      mockRepo as unknown as LLMResponseRepository,
      testConfig
    );

    const result = await router.generateResponse(
      createMockMessage({ text: 'What do you think about AI?' }),
      createMockChat(),
      createMockSender(),
      []
    );

    assertTrue(result.success);
    assertEqual(result.routedTo, 'claude');
    assertEqual(result.intent, 'general_chat');
  });

  // Test 5: Falls back to Ollama when Claude fails
  await test('falls back to Ollama when Claude fails', async () => {
    const mockClassifier = new MockIntentClassifier({ intent: 'general_chat', confidence: 0.9 });
    const mockOllama = new MockOllamaClient({ response: { content: 'Fallback response' } });
    const mockClaude = new MockClaudeClient({
      response: { success: false, content: '', error: 'Claude CLI failed' },
    });
    const mockRepo = new MockLLMResponseRepository();

    const router = new ResponseRouterService(
      mockClassifier as unknown as IntentClassifierService,
      mockOllama as unknown as LLMClient,
      mockClaude as unknown as ClaudeClient,
      mockRepo as unknown as LLMResponseRepository,
      testConfig
    );

    const result = await router.generateResponse(
      createMockMessage({ text: 'Tell me a joke' }),
      createMockChat(),
      createMockSender(),
      []
    );

    assertTrue(result.success);
    assertEqual(result.routedTo, 'ollama');
    assertEqual(result.content, 'Fallback response');
    assertTrue(mockClaude.chatCalled);
    assertTrue(mockOllama.chatCalled);
  });

  // Test 6: Stores response in repository
  await test('stores response in repository', async () => {
    const mockClassifier = new MockIntentClassifier({ intent: 'simple_greeting' });
    const mockOllama = new MockOllamaClient({ response: { content: 'Hey!' } });
    const mockClaude = new MockClaudeClient();
    const mockRepo = new MockLLMResponseRepository();

    const router = new ResponseRouterService(
      mockClassifier as unknown as IntentClassifierService,
      mockOllama as unknown as LLMClient,
      mockClaude as unknown as ClaudeClient,
      mockRepo as unknown as LLMResponseRepository,
      testConfig
    );

    const message = createMockMessage({ text: 'hi' });
    await router.generateResponse(message, createMockChat(), createMockSender(), []);

    assertTrue(mockRepo.createdResponses.length > 0);
    const stored = mockRepo.getLastResponse();
    assertEqual(stored?.messageId, message.id);
    assertEqual(stored?.promptType, 'response');
    assertEqual(stored?.response, 'Hey!');
  });

  // Test 7: Includes intent info in result
  await test('includes intent info in result', async () => {
    const mockClassifier = new MockIntentClassifier({
      intent: 'needs_web_search',
      confidence: 0.92,
    });
    const mockOllama = new MockOllamaClient();
    const mockClaude = new MockClaudeClient();
    const mockRepo = new MockLLMResponseRepository();

    const router = new ResponseRouterService(
      mockClassifier as unknown as IntentClassifierService,
      mockOllama as unknown as LLMClient,
      mockClaude as unknown as ClaudeClient,
      mockRepo as unknown as LLMResponseRepository,
      testConfig
    );

    const result = await router.generateResponse(
      createMockMessage({ text: 'weather update' }),
      createMockChat(),
      createMockSender(),
      []
    );

    assertEqual(result.intent, 'needs_web_search');
    assertEqual(result.intentConfidence, 0.92);
  });

  // Test 8: Passes conversation history to Claude
  await test('passes conversation history to Claude', async () => {
    const mockClassifier = new MockIntentClassifier({ intent: 'general_chat' });
    const mockOllama = new MockOllamaClient();
    const mockClaude = new MockClaudeClient();
    const mockRepo = new MockLLMResponseRepository();

    const router = new ResponseRouterService(
      mockClassifier as unknown as IntentClassifierService,
      mockOllama as unknown as LLMClient,
      mockClaude as unknown as ClaudeClient,
      mockRepo as unknown as LLMResponseRepository,
      testConfig
    );

    const history: Message[] = [
      createMockMessage({ id: 'msg-1', text: 'My name is Alice', isBot: false }),
      createMockMessage({ id: 'msg-2', text: 'Nice to meet you, Alice!', isBot: true }),
    ];

    await router.generateResponse(
      createMockMessage({ text: "What's my name?" }),
      createMockChat(),
      createMockSender(),
      history
    );

    assertTrue(mockClaude.chatCalled);
    assertTrue(mockClaude.lastContext.includes('Alice'));
  });

  // Test 9: Handles Ollama greeting failure with fallback response
  await test('handles Ollama greeting failure with fallback response', async () => {
    const mockClassifier = new MockIntentClassifier({ intent: 'simple_greeting' });
    const mockOllama = new MockOllamaClient({ shouldFail: true });
    const mockClaude = new MockClaudeClient();
    const mockRepo = new MockLLMResponseRepository();

    const router = new ResponseRouterService(
      mockClassifier as unknown as IntentClassifierService,
      mockOllama as unknown as LLMClient,
      mockClaude as unknown as ClaudeClient,
      mockRepo as unknown as LLMResponseRepository,
      testConfig
    );

    const result = await router.generateResponse(
      createMockMessage({ text: 'hello' }),
      createMockChat(),
      createMockSender(),
      []
    );

    assertTrue(result.success);
    assertEqual(result.routedTo, 'ollama');
    assertTrue((result.content?.length || 0) > 0); // Should have fallback response
  });

  // Test 10: Returns failure when both Claude and Ollama fail
  await test('returns failure when both Claude and Ollama fail', async () => {
    const mockClassifier = new MockIntentClassifier({ intent: 'general_chat' });
    const mockOllama = new MockOllamaClient({ shouldFail: true });
    const mockClaude = new MockClaudeClient({
      response: { success: false, content: '', error: 'Claude failed' },
    });
    const mockRepo = new MockLLMResponseRepository();

    const router = new ResponseRouterService(
      mockClassifier as unknown as IntentClassifierService,
      mockOllama as unknown as LLMClient,
      mockClaude as unknown as ClaudeClient,
      mockRepo as unknown as LLMResponseRepository,
      testConfig
    );

    const result = await router.generateResponse(
      createMockMessage({ text: 'complex question' }),
      createMockChat(),
      createMockSender(),
      []
    );

    assertTrue(!result.success);
    assertTrue((result.error?.length || 0) > 0);
  });

  // Test 11: Handles empty message text
  await test('handles empty message text', async () => {
    const mockClassifier = new MockIntentClassifier({ intent: 'general_chat' });
    const mockOllama = new MockOllamaClient();
    const mockClaude = new MockClaudeClient();
    const mockRepo = new MockLLMResponseRepository();

    const router = new ResponseRouterService(
      mockClassifier as unknown as IntentClassifierService,
      mockOllama as unknown as LLMClient,
      mockClaude as unknown as ClaudeClient,
      mockRepo as unknown as LLMResponseRepository,
      testConfig
    );

    const result = await router.generateResponse(
      createMockMessage({ text: '' }),
      createMockChat(),
      createMockSender(),
      []
    );

    assertTrue(result.success || !result.success); // Should not throw
  });

  // Print summary
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(console.error);
