#!/usr/bin/env npx tsx
/**
 * IntentClassifierService Tests
 *
 * Run: npx tsx src/services/intentClassifier.service.test.ts
 */

import { IntentClassifierService, IntentCategory } from './intentClassifier.service';
import { LLMClient, ChatMessage, LLMResponse } from '../clients/llm.client';

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

// Mock LLMClient for testing
class MockLLMClient {
  private response: string;
  private shouldTimeout: boolean;
  private shouldFail: boolean;
  public chatCalled = false;
  public lastMessages: ChatMessage[] = [];

  constructor(options: { response?: string; shouldTimeout?: boolean; shouldFail?: boolean } = {}) {
    this.response = options.response || '{"intent": "general_chat", "confidence": 0.9}';
    this.shouldTimeout = options.shouldTimeout || false;
    this.shouldFail = options.shouldFail || false;
  }

  async chat(messages: ChatMessage[], _requestId?: string): Promise<LLMResponse> {
    this.chatCalled = true;
    this.lastMessages = messages;

    if (this.shouldFail) {
      throw new Error('LLM API error');
    }

    if (this.shouldTimeout) {
      await new Promise((resolve) => setTimeout(resolve, 10000));
    }

    return {
      content: this.response,
      model: 'test-model',
    };
  }

  cancelRequest(_requestId: string): void {
    // No-op for mock
  }
}

async function runTests() {
  console.log('\n=== IntentClassifierService Tests ===\n');

  // Test 1: Parses valid JSON response
  await test('parses valid JSON response with simple_greeting', async () => {
    const mockClient = new MockLLMClient({
      response: '{"intent": "simple_greeting", "confidence": 0.95}',
    });
    const classifier = new IntentClassifierService(mockClient as unknown as LLMClient);

    const result = await classifier.classifyIntent('hello');

    assertEqual(result.intent, 'simple_greeting');
    assertTrue(result.confidence >= 0.9 && result.confidence <= 1.0);
    assertTrue(result.durationMs >= 0);
  });

  // Test 2: Parses needs_web_search intent
  await test('parses needs_web_search intent', async () => {
    const mockClient = new MockLLMClient({
      response: '{"intent": "needs_web_search", "confidence": 0.85}',
    });
    const classifier = new IntentClassifierService(mockClient as unknown as LLMClient);

    const result = await classifier.classifyIntent("What's the weather today?");

    assertEqual(result.intent, 'needs_web_search');
    assertTrue(result.confidence === 0.85);
  });

  // Test 3: Parses complex_task intent
  await test('parses complex_task intent', async () => {
    const mockClient = new MockLLMClient({
      response: '{"intent": "complex_task", "confidence": 0.9}',
    });
    const classifier = new IntentClassifierService(mockClient as unknown as LLMClient);

    const result = await classifier.classifyIntent('Write a Python function to sort a list');

    assertEqual(result.intent, 'complex_task');
  });

  // Test 4: Parses general_chat intent
  await test('parses general_chat intent', async () => {
    const mockClient = new MockLLMClient({
      response: '{"intent": "general_chat", "confidence": 0.8}',
    });
    const classifier = new IntentClassifierService(mockClient as unknown as LLMClient);

    const result = await classifier.classifyIntent('What do you think about AI?');

    assertEqual(result.intent, 'general_chat');
  });

  // Test 5: Extracts JSON from response with extra text
  await test('extracts JSON from response with extra text', async () => {
    const mockClient = new MockLLMClient({
      response: 'Here is my classification: {"intent": "simple_greeting", "confidence": 0.9} That is my answer.',
    });
    const classifier = new IntentClassifierService(mockClient as unknown as LLMClient);

    const result = await classifier.classifyIntent('hi');

    assertEqual(result.intent, 'simple_greeting');
  });

  // Test 6: Falls back to general_chat on invalid JSON
  await test('falls back to general_chat on invalid JSON', async () => {
    const mockClient = new MockLLMClient({
      response: 'This is not valid JSON at all',
    });
    const classifier = new IntentClassifierService(mockClient as unknown as LLMClient);

    const result = await classifier.classifyIntent('random message');

    assertEqual(result.intent, 'general_chat');
    assertTrue(result.confidence <= 0.6, 'Confidence should be lower for fallback');
  });

  // Test 7: Falls back to general_chat on invalid intent
  await test('falls back to general_chat on invalid intent', async () => {
    const mockClient = new MockLLMClient({
      response: '{"intent": "invalid_category", "confidence": 0.9}',
    });
    const classifier = new IntentClassifierService(mockClient as unknown as LLMClient);

    const result = await classifier.classifyIntent('test message');

    assertEqual(result.intent, 'general_chat');
  });

  // Test 8: Infers intent from raw text when JSON parsing fails
  await test('infers simple_greeting from raw text', async () => {
    const mockClient = new MockLLMClient({
      response: 'I think this is a simple_greeting because they said hello',
    });
    const classifier = new IntentClassifierService(mockClient as unknown as LLMClient);

    const result = await classifier.classifyIntent('hello');

    assertEqual(result.intent, 'simple_greeting');
  });

  // Test 9: Infers needs_web_search from raw text
  await test('infers needs_web_search from raw text', async () => {
    const mockClient = new MockLLMClient({
      response: 'This needs_web_search to get current info',
    });
    const classifier = new IntentClassifierService(mockClient as unknown as LLMClient);

    const result = await classifier.classifyIntent("what's the weather?");

    assertEqual(result.intent, 'needs_web_search');
  });

  // Test 10: Falls back to general_chat on LLM error
  await test('falls back to general_chat on LLM error', async () => {
    const mockClient = new MockLLMClient({
      shouldFail: true,
    });
    const classifier = new IntentClassifierService(mockClient as unknown as LLMClient);

    const result = await classifier.classifyIntent('hello');

    assertEqual(result.intent, 'general_chat');
    assertEqual(result.confidence, 0.5);
  });

  // Test 11: Handles conversation context
  await test('includes conversation context in prompt', async () => {
    const mockClient = new MockLLMClient({
      response: '{"intent": "general_chat", "confidence": 0.8}',
    });
    const classifier = new IntentClassifierService(mockClient as unknown as LLMClient);

    await classifier.classifyIntent('yes', 'User: Do you like pizza?\nAssistant: I think so!');

    assertTrue(mockClient.chatCalled);
    const userMessage = mockClient.lastMessages.find((m) => m.role === 'user');
    assertTrue(userMessage?.content.includes('Recent conversation context') ?? false);
    assertTrue(userMessage?.content.includes('Do you like pizza') ?? false);
  });

  // Test 12: Default confidence for invalid confidence value
  await test('uses default confidence for invalid value', async () => {
    const mockClient = new MockLLMClient({
      response: '{"intent": "general_chat", "confidence": "high"}',
    });
    const classifier = new IntentClassifierService(mockClient as unknown as LLMClient);

    const result = await classifier.classifyIntent('test');

    assertEqual(result.intent, 'general_chat');
    assertEqual(result.confidence, 0.7); // Default confidence
  });

  // Test 13: Handles confidence out of range
  await test('handles confidence out of range', async () => {
    const mockClient = new MockLLMClient({
      response: '{"intent": "general_chat", "confidence": 1.5}',
    });
    const classifier = new IntentClassifierService(mockClient as unknown as LLMClient);

    const result = await classifier.classifyIntent('test');

    assertEqual(result.intent, 'general_chat');
    assertEqual(result.confidence, 0.7); // Default confidence for out of range
  });

  // Print summary
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(console.error);
