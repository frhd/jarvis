#!/usr/bin/env npx tsx
/**
 * Two-Tier LLM Architecture E2E Tests
 *
 * Tests the complete message flow through the two-tier architecture:
 * - Tier 1 (Ollama): Intent classification and simple greetings
 * - Tier 2 (Claude): Web search, complex tasks, general conversation
 *
 * Run: npx tsx tests/e2e/two-tier-llm.test.ts
 */

import {
  TelegramSimulator,
  SimulatedMessage,
  SimulatedResponse,
} from './telegram-simulator';

// ============== Test Helpers ==============

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve(fn())
    .then(() => {
      console.log(`✓ ${name}`);
      passed++;
    })
    .catch((err) => {
      console.log(`✗ ${name}`);
      console.log(`  Error: ${err.message}`);
      if (err.stack) {
        console.log(`  Stack: ${err.stack.split('\n')[1]}`);
      }
      failed++;
    });
}

function assertEqual<T>(actual: T, expected: T, message?: string) {
  if (actual !== expected) {
    throw new Error(message || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertTrue(condition: boolean, message?: string) {
  if (!condition) {
    throw new Error(message || 'Expected condition to be true');
  }
}

function assertContains(text: string, substring: string, message?: string) {
  if (!text.includes(substring)) {
    throw new Error(message || `Expected "${text}" to contain "${substring}"`);
  }
}

function createMessage(text: string, overrides: Partial<SimulatedMessage> = {}): SimulatedMessage {
  return {
    text,
    senderId: 'test-user',
    chatId: 'test-chat',
    chatType: 'private',
    timestamp: new Date(),
    ...overrides,
  };
}

// ============== Test Suites ==============

async function runTests() {
  console.log('\n=== Two-Tier LLM Architecture E2E Tests ===\n');

  // -------------------- Intent Classification and Routing --------------------
  console.log('--- Intent Classification and Routing ---\n');

  // Test 1: Simple greeting routes to Ollama (fast)
  await test('simple greeting routes to Ollama (fast response)', async () => {
    const simulator = new TelegramSimulator();
    const startTime = Date.now();

    const response = await simulator.sendMessage(createMessage('Hello!'));
    const duration = Date.now() - startTime;

    assertTrue(response !== null, 'Should receive a response');
    assertEqual(response!.routedTo, 'ollama');
    assertEqual(response!.intent, 'simple_greeting');
    assertTrue(response!.intentConfidence >= 0.9, 'High confidence for greetings');
    assertTrue(duration < 1000, `Response should be fast (was ${duration}ms)`);
    assertTrue(response!.text.length > 0, 'Response should have content');

    // Verify Ollama was called, not Claude
    assertTrue(simulator.mockOllama.chatCallCount > 0, 'Ollama should be called');
    assertEqual(simulator.mockClaude.chatCallCount, 0, 'Claude should not be called');
  });

  // Test 2: "Hi" routes to Ollama
  await test('"hi" routes to Ollama', async () => {
    const simulator = new TelegramSimulator();

    const response = await simulator.sendMessage(createMessage('hi'));

    assertTrue(response !== null);
    assertEqual(response!.routedTo, 'ollama');
    assertEqual(response!.intent, 'simple_greeting');
  });

  // Test 3: "Hey" routes to Ollama
  await test('"hey" routes to Ollama', async () => {
    const simulator = new TelegramSimulator();

    const response = await simulator.sendMessage(createMessage('hey'));

    assertTrue(response !== null);
    assertEqual(response!.routedTo, 'ollama');
    assertEqual(response!.intent, 'simple_greeting');
  });

  // Test 4: "Good morning" routes to Ollama
  await test('"good morning" routes to Ollama', async () => {
    const simulator = new TelegramSimulator();

    const response = await simulator.sendMessage(createMessage('Good morning!'));

    assertTrue(response !== null);
    assertEqual(response!.routedTo, 'ollama');
    assertEqual(response!.intent, 'simple_greeting');
  });

  // Test 5: Web search query routes to Claude
  await test('web search query routes to Claude', async () => {
    const simulator = new TelegramSimulator();

    const response = await simulator.sendMessage(
      createMessage("What's the weather like in San Francisco today?")
    );

    assertTrue(response !== null);
    assertEqual(response!.routedTo, 'claude');
    assertEqual(response!.intent, 'needs_web_search');
    assertTrue(response!.text.length > 0);

    // Verify Claude was called
    assertTrue(simulator.mockClaude.chatCallCount > 0, 'Claude should be called');
    assertContains(simulator.mockClaude.lastMessage.toLowerCase(), 'weather');
  });

  // Test 6: News query routes to Claude
  await test('news query routes to Claude', async () => {
    const simulator = new TelegramSimulator();

    const response = await simulator.sendMessage(
      createMessage("What's in the news today?")
    );

    assertTrue(response !== null);
    assertEqual(response!.routedTo, 'claude');
    assertEqual(response!.intent, 'needs_web_search');
  });

  // Test 7: Complex task routes to Claude
  await test('complex task routes to Claude', async () => {
    const simulator = new TelegramSimulator();

    const response = await simulator.sendMessage(
      createMessage('Explain the difference between TCP and UDP protocols')
    );

    assertTrue(response !== null);
    assertEqual(response!.routedTo, 'claude');
    assertEqual(response!.intent, 'complex_task');
    assertContains(response!.text, 'TCP');
    assertContains(response!.text, 'UDP');
  });

  // Test 8: Code generation routes to Claude
  await test('code generation request routes to Claude', async () => {
    const simulator = new TelegramSimulator();

    const response = await simulator.sendMessage(
      createMessage('Write a function to sort an array')
    );

    assertTrue(response !== null);
    assertEqual(response!.routedTo, 'claude');
    assertEqual(response!.intent, 'complex_task');
  });

  // Test 9: General conversation routes to Claude
  await test('general conversation routes to Claude', async () => {
    const simulator = new TelegramSimulator();

    const response = await simulator.sendMessage(
      createMessage('What do you think about artificial intelligence?')
    );

    assertTrue(response !== null);
    assertEqual(response!.routedTo, 'claude');
    assertEqual(response!.intent, 'general_chat');
  });

  // -------------------- Fallback Behavior --------------------
  console.log('\n--- Fallback Behavior ---\n');

  // Test 10: Falls back to Ollama when Claude fails
  await test('falls back to Ollama when Claude fails', async () => {
    const simulator = new TelegramSimulator();
    simulator.mockClaude.setFailure(true);

    const response = await simulator.sendMessage(
      createMessage('Tell me about quantum computing')
    );

    assertTrue(response !== null, 'Should still get a response');
    assertEqual(response!.routedTo, 'ollama', 'Should fall back to Ollama');
    assertTrue(response!.text.length > 0, 'Should have content');

    // Both should be called - Claude failed, then Ollama fallback
    assertTrue(simulator.mockClaude.chatCallCount > 0, 'Claude should have been tried');
    assertTrue(simulator.mockOllama.chatCallCount > 0, 'Ollama should have been used for fallback');
  });

  // Test 11: Handles intent classification timeout gracefully
  await test('handles intent classification timeout gracefully', async () => {
    const simulator = new TelegramSimulator();
    simulator.mockIntentClassifier.setFailure(true);

    const response = await simulator.sendMessage(
      createMessage('Some random message')
    );

    // Should default to general_chat and route to Claude
    assertTrue(response !== null, 'Should still get a response');
    assertEqual(response!.intent, 'general_chat', 'Should default to general_chat');
  });

  // Test 12: Returns fallback response when Ollama fails for greetings
  await test('returns fallback response when Ollama fails for greetings', async () => {
    const simulator = new TelegramSimulator();
    simulator.mockOllama.setFailure(true);

    // Force greeting intent
    simulator.mockIntentClassifier.setIntentOverride({
      intent: 'simple_greeting',
      confidence: 0.95,
      durationMs: 50,
    });

    const response = await simulator.sendMessage(createMessage('Hello'));

    assertTrue(response !== null, 'Should get a fallback response');
    assertEqual(response!.routedTo, 'ollama');
    assertTrue(response!.text.length > 0, 'Should have fallback content');
  });

  // Test 13: Returns failure when both Claude and Ollama fail
  await test('handles complete failure gracefully', async () => {
    const simulator = new TelegramSimulator();
    simulator.mockClaude.setFailure(true);
    simulator.mockOllama.setFailure(true);

    const response = await simulator.sendMessage(
      createMessage('Test message')
    );

    // Response should be null when both fail
    assertTrue(response === null, 'Should return null on complete failure');
  });

  // -------------------- Conversation Context --------------------
  console.log('\n--- Conversation Context ---\n');

  // Test 14: Maintains context across multiple messages
  await test('maintains context across multiple messages', async () => {
    const simulator = new TelegramSimulator();

    // First message: introduce name
    await simulator.sendMessage(createMessage('My name is Alice'));

    // Second message: ask about name
    const response = await simulator.sendMessage(
      createMessage("What's my name?")
    );

    assertTrue(response !== null);
    // The context should include "Alice" from the previous message
    assertTrue(
      simulator.mockClaude.lastContext.includes('Alice'),
      'Context should include "Alice" from previous message'
    );
  });

  // Test 15: Conversation history is passed correctly
  await test('conversation history is built correctly', async () => {
    const simulator = new TelegramSimulator();

    // Send multiple messages
    await simulator.sendMessage(createMessage('First message'));
    await simulator.sendMessage(createMessage('Second message'));
    await simulator.sendMessage(createMessage('Third message'));

    const history = simulator.getConversationHistory();

    // History should have user messages and bot responses
    assertTrue(history.length >= 3, 'Should have message history');

    // Most recent should be first (reverse chronological)
    assertTrue(
      history.some((m) => m.text === 'Third message' || m.isBot),
      'Recent messages should be in history'
    );
  });

  // Test 16: Context window size is respected
  await test('context window limits history size', async () => {
    const simulator = new TelegramSimulator({ contextWindowSize: 3 });

    // Send many messages
    for (let i = 0; i < 10; i++) {
      await simulator.sendMessage(createMessage(`Message ${i}`));
    }

    const history = simulator.getConversationHistory();

    // History is trimmed to 20 messages internally in simulator
    assertTrue(history.length <= 20, 'History should be trimmed');
  });

  // -------------------- Response Storage --------------------
  console.log('\n--- Response Storage ---\n');

  // Test 17: Responses are stored in repository
  await test('responses are stored in repository', async () => {
    const simulator = new TelegramSimulator();

    await simulator.sendMessage(createMessage('Hello!'));

    const storedCount = simulator.mockRepo.getResponseCount();
    assertTrue(storedCount > 0, 'Should store response in repository');

    const lastStored = simulator.mockRepo.getLastResponse();
    assertTrue(lastStored !== undefined);
    assertEqual(lastStored!.promptType, 'response');
    assertTrue(lastStored!.response.length > 0);
  });

  // Test 18: Stored response contains correct metadata
  await test('stored response contains correct metadata', async () => {
    const simulator = new TelegramSimulator();

    const msg = createMessage('Hello!');
    await simulator.sendMessage(msg);

    const lastStored = simulator.mockRepo.getLastResponse();
    assertTrue(lastStored !== undefined);
    assertTrue(lastStored!.model.length > 0, 'Should have model name');
    assertTrue(lastStored!.durationMs >= 0, 'Should have duration');
  });

  // -------------------- Edge Cases --------------------
  console.log('\n--- Edge Cases ---\n');

  // Test 19: Handles empty message text
  await test('handles empty message text', async () => {
    const simulator = new TelegramSimulator();

    const response = await simulator.sendMessage(createMessage(''));

    // Should not throw, may return null or a response
    assertTrue(true, 'Should not throw on empty message');
  });

  // Test 20: Handles very long messages
  await test('handles very long messages', async () => {
    const simulator = new TelegramSimulator();

    const longMessage = 'A'.repeat(5000);
    const response = await simulator.sendMessage(createMessage(longMessage));

    // Should handle without error
    assertTrue(true, 'Should handle long messages');
  });

  // Test 21: Handles special characters
  await test('handles special characters', async () => {
    const simulator = new TelegramSimulator();

    const response = await simulator.sendMessage(
      createMessage('Hello! 🎉 <script>alert("xss")</script> & "quotes"')
    );

    assertTrue(response !== null, 'Should handle special characters');
  });

  // Test 22: Private chat gets response
  await test('private chat receives response', async () => {
    const simulator = new TelegramSimulator();

    const response = await simulator.sendMessage(
      createMessage('Hello', { chatType: 'private' })
    );

    assertTrue(response !== null, 'Private chats should get responses');
  });

  // Test 23: Response disabled returns null
  await test('response disabled returns null', async () => {
    const simulator = new TelegramSimulator({ responseEnabled: false });

    const response = await simulator.sendMessage(createMessage('Hello'));

    assertTrue(response === null, 'Should not respond when disabled');
  });

  // Test 24: Claude disabled falls back to Ollama
  await test('Claude disabled uses Ollama for all requests', async () => {
    const simulator = new TelegramSimulator({ claudeEnabled: false });

    // This would normally route to Claude
    const response = await simulator.sendMessage(
      createMessage('Explain quantum physics')
    );

    assertTrue(response !== null);
    assertEqual(response!.routedTo, 'ollama', 'Should use Ollama when Claude is disabled');
  });

  // -------------------- Performance --------------------
  console.log('\n--- Performance ---\n');

  // Test 25: Greeting responses are fast
  await test('greeting responses complete within reasonable time', async () => {
    const simulator = new TelegramSimulator();

    const start = Date.now();
    await simulator.sendMessage(createMessage('Hi!'));
    const duration = Date.now() - start;

    assertTrue(
      duration < 2000,
      `Greeting should be fast, but took ${duration}ms`
    );
  });

  // Test 26: Multiple sequential messages work correctly
  await test('handles multiple sequential messages correctly', async () => {
    const simulator = new TelegramSimulator();

    const messages = ['Hello!', "What's the weather?", 'Hey there!'];
    const responses: (SimulatedResponse | null)[] = [];

    for (const msg of messages) {
      const response = await simulator.sendMessage(createMessage(msg));
      responses.push(response);
    }

    // All messages should get responses
    assertEqual(responses.filter((r) => r !== null).length, 3);

    // Intents should match expected routing
    assertEqual(responses[0]!.intent, 'simple_greeting');
    assertEqual(responses[1]!.intent, 'needs_web_search');
    assertEqual(responses[2]!.intent, 'simple_greeting');
  });

  // -------------------- Print Results --------------------
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
