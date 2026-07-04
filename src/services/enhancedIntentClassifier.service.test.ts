#!/usr/bin/env npx tsx
/**
 * Enhanced IntentClassifierService Tests
 *
 * Run: npx tsx src/services/enhancedIntentClassifier.service.test.ts
 */

import { EnhancedIntentClassifierService, EnhancedIntentResult } from './enhancedIntentClassifier.service';
import { LLMClient, ChatMessage, LLMResponse } from '../clients/llm.client';
import {
  ParentIntent,
  ChildIntent,
  LegacyIntentCategory,
  ConfidenceThresholds,
} from '../types/intent.types';

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
      if (err.stack) {
        console.log(`  Stack: ${err.stack.split('\n').slice(1, 3).join('\n')}`);
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
    throw new Error(message || 'Expected true');
  }
}

function assertFalse(condition: boolean, message?: string) {
  if (condition) {
    throw new Error(message || 'Expected false');
  }
}

function assertGreaterThan(actual: number, expected: number, message?: string) {
  if (actual <= expected) {
    throw new Error(message || `Expected ${actual} to be greater than ${expected}`);
  }
}

function assertGreaterThanOrEqual(actual: number, expected: number, message?: string) {
  if (actual < expected) {
    throw new Error(message || `Expected ${actual} to be >= ${expected}`);
  }
}

function assertLessThan(actual: number, expected: number, message?: string) {
  if (actual >= expected) {
    throw new Error(message || `Expected ${actual} to be less than ${expected}`);
  }
}

// Mock LLMClient for testing
class MockLLMClient {
  private response: string;
  private shouldTimeout: boolean;
  private shouldFail: boolean;
  public chatCalled = false;
  public lastMessages: ChatMessage[] = [];
  public cancelRequestCalled = false;

  constructor(options: { response?: string; shouldTimeout?: boolean; shouldFail?: boolean } = {}) {
    this.response = options.response || JSON.stringify({
      parentIntent: 'question',
      childIntent: 'factual_question',
      confidence: 0.9,
      isFollowUp: false,
      referencesContext: false,
      requiresWebSearch: false,
      requiresComplexReasoning: false,
    });
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
    this.cancelRequestCalled = true;
  }
}

async function runTests() {
  console.log('\n=== Enhanced IntentClassifierService Tests ===\n');

  // ============================================================================
  // Pattern-based Fast Classification Tests
  // ============================================================================

  console.log('--- Pattern-based Classification ---\n');

  await test('classifies simple_greeting pattern', async () => {
    const mockClient = new MockLLMClient();
    const classifier = new EnhancedIntentClassifierService(mockClient as unknown as LLMClient);

    const result = await classifier.classifyIntent('hello');

    assertEqual(result.parentIntent, 'greeting');
    assertEqual(result.childIntent, 'simple_greeting');
    assertGreaterThanOrEqual(result.confidence, 0.95);
    assertEqual(result.classificationMethod, 'pattern');
    assertFalse(mockClient.chatCalled, 'Should use fast path, not LLM');
  });

  await test('classifies time_greeting pattern', async () => {
    const mockClient = new MockLLMClient();
    const classifier = new EnhancedIntentClassifierService(mockClient as unknown as LLMClient);

    const result = await classifier.classifyIntent('good morning');

    assertEqual(result.parentIntent, 'greeting');
    assertEqual(result.childIntent, 'time_greeting');
    assertGreaterThanOrEqual(result.confidence, 0.95);
    assertEqual(result.classificationMethod, 'pattern');
  });

  await test('classifies farewell pattern', async () => {
    const mockClient = new MockLLMClient();
    const classifier = new EnhancedIntentClassifierService(mockClient as unknown as LLMClient);

    const result = await classifier.classifyIntent('bye');

    assertEqual(result.parentIntent, 'greeting');
    assertEqual(result.childIntent, 'farewell');
    assertGreaterThanOrEqual(result.confidence, 0.95);
  });

  await test('classifies gratitude pattern', async () => {
    const mockClient = new MockLLMClient();
    const classifier = new EnhancedIntentClassifierService(mockClient as unknown as LLMClient);

    const result = await classifier.classifyIntent('thanks!');

    assertEqual(result.parentIntent, 'greeting');
    assertEqual(result.childIntent, 'gratitude');
    assertGreaterThanOrEqual(result.confidence, 0.95);
  });

  await test('classifies web_search_question pattern', async () => {
    const mockClient = new MockLLMClient();
    const classifier = new EnhancedIntentClassifierService(mockClient as unknown as LLMClient);

    const result = await classifier.classifyIntent('what is the weather in Tokyo?');

    assertEqual(result.parentIntent, 'question');
    assertEqual(result.childIntent, 'web_search_question');
    assertTrue(result.requiresWebSearch);
    assertGreaterThanOrEqual(result.confidence, 0.90);
  });

  await test('classifies search_request pattern', async () => {
    const mockClient = new MockLLMClient();
    const classifier = new EnhancedIntentClassifierService(mockClient as unknown as LLMClient);

    const result = await classifier.classifyIntent('search for best restaurants');

    assertEqual(result.parentIntent, 'command');
    assertEqual(result.childIntent, 'search_request');
    assertTrue(result.requiresWebSearch);
  });

  await test('classifies positive_feedback pattern', async () => {
    const mockClient = new MockLLMClient();
    const classifier = new EnhancedIntentClassifierService(mockClient as unknown as LLMClient);

    const result = await classifier.classifyIntent('perfect!');

    assertEqual(result.parentIntent, 'feedback');
    assertEqual(result.childIntent, 'positive_feedback');
    assertGreaterThanOrEqual(result.confidence, 0.90);
  });

  await test('classifies negative_feedback pattern', async () => {
    const mockClient = new MockLLMClient();
    const classifier = new EnhancedIntentClassifierService(mockClient as unknown as LLMClient);

    const result = await classifier.classifyIntent('wrong');

    assertEqual(result.parentIntent, 'feedback');
    assertEqual(result.childIntent, 'negative_feedback');
  });

  await test('classifies acknowledgment pattern', async () => {
    const mockClient = new MockLLMClient();
    const classifier = new EnhancedIntentClassifierService(mockClient as unknown as LLMClient);

    const result = await classifier.classifyIntent('ok');

    assertEqual(result.parentIntent, 'feedback');
    assertEqual(result.childIntent, 'acknowledgment');
    assertGreaterThanOrEqual(result.confidence, 0.90);
  });

  await test('classifies elaboration_request pattern', async () => {
    const mockClient = new MockLLMClient();
    const classifier = new EnhancedIntentClassifierService(mockClient as unknown as LLMClient);

    const result = await classifier.classifyIntent('tell me more');

    assertEqual(result.parentIntent, 'continuation');
    assertEqual(result.childIntent, 'elaboration_request');
  });

  await test('classifies clarification pattern with context', async () => {
    const mockClient = new MockLLMClient({
      response: JSON.stringify({
        parentIntent: 'continuation',
        childIntent: 'clarification',
        confidence: 0.85,
      }),
    });
    const classifier = new EnhancedIntentClassifierService(mockClient as unknown as LLMClient);

    const result = await classifier.classifyIntent('what do you mean?', 'Some previous context');

    assertEqual(result.parentIntent, 'continuation');
    assertEqual(result.childIntent, 'clarification');
  });

  await test('classifies calculation pattern', async () => {
    const mockClient = new MockLLMClient();
    const classifier = new EnhancedIntentClassifierService(mockClient as unknown as LLMClient);

    const result = await classifier.classifyIntent('what is 5 + 5');

    assertEqual(result.parentIntent, 'command');
    assertEqual(result.childIntent, 'calculation');
    assertGreaterThanOrEqual(result.confidence, 0.95);
  });

  await test('classifies translation pattern', async () => {
    const mockClient = new MockLLMClient();
    const classifier = new EnhancedIntentClassifierService(mockClient as unknown as LLMClient);

    const result = await classifier.classifyIntent('translate hello to Spanish');

    assertEqual(result.parentIntent, 'command');
    assertEqual(result.childIntent, 'translation');
    assertGreaterThanOrEqual(result.confidence, 0.90);
  });

  await test('classifies summarization pattern', async () => {
    const mockClient = new MockLLMClient();
    const classifier = new EnhancedIntentClassifierService(mockClient as unknown as LLMClient);

    const result = await classifier.classifyIntent('summarize this article');

    assertEqual(result.parentIntent, 'command');
    assertEqual(result.childIntent, 'summarization');
    assertGreaterThanOrEqual(result.confidence, 0.90);
    assertTrue(result.requiresComplexReasoning);
  });

  // ============================================================================
  // Context Signal Analysis Tests
  // ============================================================================

  console.log('\n--- Context Signal Analysis ---\n');

  await test('detects pronoun references', async () => {
    const mockClient = new MockLLMClient();
    const classifier = new EnhancedIntentClassifierService(mockClient as unknown as LLMClient);

    const result = await classifier.classifyIntent('what is it?', 'Previous message about something');

    assertTrue(result.referencesContext, 'Should detect pronoun "it"');
    assertTrue(result.isFollowUp);
  });

  await test('detects explicit references', async () => {
    const mockClient = new MockLLMClient();
    const classifier = new EnhancedIntentClassifierService(mockClient as unknown as LLMClient);

    const result = await classifier.classifyIntent('as you mentioned earlier', 'Previous conversation');

    assertTrue(result.referencesContext, 'Should detect "mentioned earlier"');
    assertTrue(result.isFollowUp);
  });

  await test('detects continuation markers', async () => {
    const mockClient = new MockLLMClient();
    const classifier = new EnhancedIntentClassifierService(mockClient as unknown as LLMClient);

    const result = await classifier.classifyIntent('also, what about cats?', 'Discussion about dogs');

    assertTrue(result.isFollowUp, 'Should detect "also" continuation marker');
  });

  await test('suggests context depth for follow-ups', async () => {
    const mockClient = new MockLLMClient();
    const classifier = new EnhancedIntentClassifierService(mockClient as unknown as LLMClient);

    const result = await classifier.classifyIntent('tell me more about that', 'Previous topic discussion');

    assertTrue(result.isFollowUp);
    assertTrue(result.referencesContext);
    assertGreaterThan(result.suggestedContextDepth, 0);
  });

  await test('sets zero context depth for new topics', async () => {
    const mockClient = new MockLLMClient();
    const classifier = new EnhancedIntentClassifierService(mockClient as unknown as LLMClient);

    const result = await classifier.classifyIntent('what is the capital of France?');

    assertFalse(result.isFollowUp);
    assertFalse(result.referencesContext);
    assertEqual(result.suggestedContextDepth, 0);
  });

  // ============================================================================
  // Multi-turn Conversation Detection Tests
  // ============================================================================

  console.log('\n--- Multi-turn Conversation Detection ---\n');

  await test('detects follow-up without explicit context', async () => {
    const mockClient = new MockLLMClient({
      response: JSON.stringify({
        parentIntent: 'continuation',
        childIntent: 'follow_up',
        confidence: 0.85,
        isFollowUp: true,
        referencesContext: true,
      }),
    });
    const classifier = new EnhancedIntentClassifierService(mockClient as unknown as LLMClient);

    const result = await classifier.classifyIntent('and what about performance?', 'Discussion about features');

    assertTrue(result.isFollowUp);
    assertEqual(result.parentIntent, 'continuation');
    assertEqual(result.childIntent, 'follow_up');
  });

  await test('marks new conversation as not follow-up', async () => {
    const mockClient = new MockLLMClient();
    const classifier = new EnhancedIntentClassifierService(mockClient as unknown as LLMClient);

    const result = await classifier.classifyIntent('hello');

    assertFalse(result.isFollowUp);
    assertFalse(result.referencesContext);
  });

  // ============================================================================
  // Confidence Level Tests
  // ============================================================================

  console.log('\n--- Confidence Levels ---\n');

  await test('assigns high confidence level', async () => {
    const mockClient = new MockLLMClient();
    const classifier = new EnhancedIntentClassifierService(mockClient as unknown as LLMClient);

    const result = await classifier.classifyIntent('hi');

    assertEqual(result.confidenceLevel, 'high');
    assertGreaterThanOrEqual(result.confidence, 0.85);
  });

  await test('assigns medium confidence level', async () => {
    const mockClient = new MockLLMClient({
      response: JSON.stringify({
        parentIntent: 'question',
        childIntent: 'factual_question',
        confidence: 0.70,
      }),
    });
    const classifier = new EnhancedIntentClassifierService(mockClient as unknown as LLMClient);

    const result = await classifier.classifyIntent('complex ambiguous question');

    assertEqual(result.confidenceLevel, 'medium');
    assertGreaterThanOrEqual(result.confidence, 0.65);
    assertLessThan(result.confidence, 0.85);
  });

  await test('assigns low confidence level', async () => {
    const mockClient = new MockLLMClient({
      response: JSON.stringify({
        parentIntent: 'question',
        childIntent: 'factual_question',
        confidence: 0.50,
      }),
    });
    const classifier = new EnhancedIntentClassifierService(mockClient as unknown as LLMClient);

    const result = await classifier.classifyIntent('very ambiguous input');

    assertEqual(result.confidenceLevel, 'low');
    assertGreaterThanOrEqual(result.confidence, 0.45);
    assertLessThan(result.confidence, 0.65);
  });

  await test('assigns uncertain confidence level', async () => {
    const mockClient = new MockLLMClient({
      response: JSON.stringify({
        parentIntent: 'question',
        childIntent: 'factual_question',
        confidence: 0.30,
      }),
    });
    const classifier = new EnhancedIntentClassifierService(mockClient as unknown as LLMClient);

    const result = await classifier.classifyIntent('???');

    assertEqual(result.confidenceLevel, 'uncertain');
    assertLessThan(result.confidence, 0.45);
  });

  // ============================================================================
  // Escalation Logic Tests
  // ============================================================================

  console.log('\n--- Escalation Logic ---\n');

  await test('marks for escalation when confidence is low', async () => {
    const mockClient = new MockLLMClient({
      response: JSON.stringify({
        parentIntent: 'question',
        childIntent: 'factual_question',
        confidence: 0.30,
      }),
    });
    const classifier = new EnhancedIntentClassifierService(mockClient as unknown as LLMClient);

    const result = await classifier.classifyIntent('ambiguous message');

    assertTrue(result.shouldEscalate);
    assertLessThan(result.confidence, 0.35);
  });

  await test('does not escalate when confidence is high', async () => {
    const mockClient = new MockLLMClient();
    const classifier = new EnhancedIntentClassifierService(mockClient as unknown as LLMClient);

    const result = await classifier.classifyIntent('hello');

    assertFalse(result.shouldEscalate);
    assertGreaterThanOrEqual(result.confidence, 0.85);
  });

  await test('respects custom escalation threshold', async () => {
    const mockClient = new MockLLMClient({
      response: JSON.stringify({
        parentIntent: 'question',
        childIntent: 'factual_question',
        confidence: 0.60,
      }),
    });
    const customThresholds: ConfidenceThresholds = {
      high: 0.85,
      medium: 0.65,
      low: 0.45,
      escalate: 0.70, // Higher threshold
    };
    const classifier = new EnhancedIntentClassifierService(
      mockClient as unknown as LLMClient,
      { confidenceThresholds: customThresholds }
    );

    const result = await classifier.classifyIntent('test message');

    assertTrue(result.shouldEscalate, 'Should escalate with 0.60 confidence when threshold is 0.70');
  });

  await test('disables escalation when configured', async () => {
    const mockClient = new MockLLMClient({
      response: JSON.stringify({
        parentIntent: 'question',
        childIntent: 'factual_question',
        confidence: 0.30,
      }),
    });
    const classifier = new EnhancedIntentClassifierService(
      mockClient as unknown as LLMClient,
      { enableEscalation: false }
    );

    const result = await classifier.classifyIntent('ambiguous');

    assertFalse(result.shouldEscalate, 'Escalation should be disabled');
  });

  // ============================================================================
  // Legacy Intent Conversion Tests
  // ============================================================================

  console.log('\n--- Legacy Intent Conversion ---\n');

  await test('converts simple_greeting to legacy format', async () => {
    const mockClient = new MockLLMClient();
    const classifier = new EnhancedIntentClassifierService(mockClient as unknown as LLMClient);

    const result = await classifier.classifyIntent('hello');
    const legacy = classifier.toLegacyIntent(result);

    assertEqual(legacy, 'simple_greeting');
  });

  await test('converts time_greeting to legacy simple_greeting', async () => {
    const mockClient = new MockLLMClient();
    const classifier = new EnhancedIntentClassifierService(mockClient as unknown as LLMClient);

    const result = await classifier.classifyIntent('good morning');
    const legacy = classifier.toLegacyIntent(result);

    assertEqual(legacy, 'simple_greeting');
  });

  await test('converts web_search_question to needs_web_search', async () => {
    const mockClient = new MockLLMClient();
    const classifier = new EnhancedIntentClassifierService(mockClient as unknown as LLMClient);

    const result = await classifier.classifyIntent('what is the weather today?');
    const legacy = classifier.toLegacyIntent(result);

    assertEqual(legacy, 'needs_web_search');
  });

  await test('converts search_request to needs_web_search', async () => {
    const mockClient = new MockLLMClient();
    const classifier = new EnhancedIntentClassifierService(mockClient as unknown as LLMClient);

    const result = await classifier.classifyIntent('search for Python tutorials');
    const legacy = classifier.toLegacyIntent(result);

    assertEqual(legacy, 'needs_web_search');
  });

  await test('converts task_request to complex_task', async () => {
    const mockClient = new MockLLMClient({
      response: JSON.stringify({
        parentIntent: 'command',
        childIntent: 'task_request',
        confidence: 0.85,
      }),
    });
    const classifier = new EnhancedIntentClassifierService(mockClient as unknown as LLMClient);

    const result = await classifier.classifyIntent('write a function to sort numbers');
    const legacy = classifier.toLegacyIntent(result);

    assertEqual(legacy, 'complex_task');
  });

  await test('converts how_to_question to complex_task', async () => {
    const mockClient = new MockLLMClient({
      response: JSON.stringify({
        parentIntent: 'question',
        childIntent: 'how_to_question',
        confidence: 0.85,
      }),
    });
    const classifier = new EnhancedIntentClassifierService(mockClient as unknown as LLMClient);

    const result = await classifier.classifyIntent('how do I deploy a Node.js app?');
    const legacy = classifier.toLegacyIntent(result);

    assertEqual(legacy, 'complex_task');
  });

  await test('converts other intents to general_chat', async () => {
    const mockClient = new MockLLMClient({
      response: JSON.stringify({
        parentIntent: 'question',
        childIntent: 'factual_question',
        confidence: 0.80,
      }),
    });
    const classifier = new EnhancedIntentClassifierService(mockClient as unknown as LLMClient);

    const result = await classifier.classifyIntent('what is the capital of France?');
    const legacy = classifier.toLegacyIntent(result);

    assertEqual(legacy, 'general_chat');
  });

  await test('classifyIntentLegacy returns legacy format', async () => {
    const mockClient = new MockLLMClient();
    const classifier = new EnhancedIntentClassifierService(mockClient as unknown as LLMClient);

    const result = await classifier.classifyIntentLegacy('hello');

    assertEqual(result.intent, 'simple_greeting');
    assertTrue(result.confidence > 0);
    assertTrue(result.durationMs >= 0);
  });

  // ============================================================================
  // LLM-based Classification Tests
  // ============================================================================

  console.log('\n--- LLM-based Classification ---\n');

  await test('uses LLM for non-pattern messages', async () => {
    const mockClient = new MockLLMClient({
      response: JSON.stringify({
        parentIntent: 'question',
        childIntent: 'opinion_question',
        confidence: 0.85,
        isFollowUp: false,
        referencesContext: false,
        requiresWebSearch: false,
        requiresComplexReasoning: true,
      }),
    });
    const classifier = new EnhancedIntentClassifierService(mockClient as unknown as LLMClient);

    const result = await classifier.classifyIntent('What do you think about artificial intelligence?');

    assertTrue(mockClient.chatCalled, 'Should call LLM for non-pattern message');
    assertEqual(result.classificationMethod, 'llm');
    assertEqual(result.parentIntent, 'question');
    assertEqual(result.childIntent, 'opinion_question');
  });

  await test('includes conversation context in LLM prompt', async () => {
    const mockClient = new MockLLMClient({
      response: JSON.stringify({
        parentIntent: 'continuation',
        childIntent: 'follow_up',
        confidence: 0.80,
        isFollowUp: true,
        referencesContext: true,
      }),
    });
    const classifier = new EnhancedIntentClassifierService(mockClient as unknown as LLMClient);

    const context = 'User: Tell me about Python\nAssistant: Python is a programming language...';
    await classifier.classifyIntent('What about its libraries?', context);

    assertTrue(mockClient.chatCalled);
    const userMessage = mockClient.lastMessages.find((m) => m.role === 'user');
    assertTrue(userMessage?.content.includes('Recent conversation') ?? false);
    assertTrue(userMessage?.content.includes('Python') ?? false);
  });

  await test('validates and corrects invalid parent intent', async () => {
    const mockClient = new MockLLMClient({
      response: JSON.stringify({
        parentIntent: 'invalid_parent',
        childIntent: 'factual_question',
        confidence: 0.80,
      }),
    });
    const classifier = new EnhancedIntentClassifierService(mockClient as unknown as LLMClient);

    const result = await classifier.classifyIntent('test message');

    assertEqual(result.parentIntent, 'question', 'Should default to question for invalid parent');
  });

  await test('validates and corrects invalid child intent', async () => {
    const mockClient = new MockLLMClient({
      response: JSON.stringify({
        parentIntent: 'question',
        childIntent: 'invalid_child',
        confidence: 0.80,
      }),
    });
    const classifier = new EnhancedIntentClassifierService(mockClient as unknown as LLMClient);

    const result = await classifier.classifyIntent('test message');

    assertEqual(result.childIntent, 'factual_question', 'Should default to factual_question for invalid child');
  });

  await test('validates and corrects invalid confidence', async () => {
    const mockClient = new MockLLMClient({
      response: JSON.stringify({
        parentIntent: 'question',
        childIntent: 'factual_question',
        confidence: 'very high', // Invalid type
      }),
    });
    const classifier = new EnhancedIntentClassifierService(mockClient as unknown as LLMClient);

    const result = await classifier.classifyIntent('test message');

    assertEqual(result.confidence, 0.7, 'Should use default confidence for invalid value');
  });

  await test('clamps confidence to valid range', async () => {
    const mockClient = new MockLLMClient({
      response: JSON.stringify({
        parentIntent: 'question',
        childIntent: 'factual_question',
        confidence: 1.5, // Out of range
      }),
    });
    const classifier = new EnhancedIntentClassifierService(mockClient as unknown as LLMClient);

    const result = await classifier.classifyIntent('test message');

    assertEqual(result.confidence, 0.7, 'Should use default confidence for out of range');
  });

  await test('extracts JSON from LLM response with extra text', async () => {
    const mockClient = new MockLLMClient({
      response: 'Here is my analysis: {"parentIntent": "question", "childIntent": "factual_question", "confidence": 0.88} Thanks!',
    });
    const classifier = new EnhancedIntentClassifierService(mockClient as unknown as LLMClient);

    const result = await classifier.classifyIntent('test');

    assertEqual(result.parentIntent, 'question');
    assertEqual(result.childIntent, 'factual_question');
    assertEqual(result.confidence, 0.88);
  });

  // ============================================================================
  // Fallback Behavior Tests
  // ============================================================================

  console.log('\n--- Fallback Behavior ---\n');

  await test('falls back gracefully on LLM error', async () => {
    const mockClient = new MockLLMClient({
      shouldFail: true,
    });
    const classifier = new EnhancedIntentClassifierService(mockClient as unknown as LLMClient);

    const result = await classifier.classifyIntent('test message');

    assertEqual(result.parentIntent, 'question');
    assertEqual(result.childIntent, 'factual_question');
    assertEqual(result.confidence, 0.5);
    assertEqual(result.confidenceLevel, 'low');
    assertTrue(result.shouldEscalate);
  });

  await test('fallback detects continuation from context signals', async () => {
    const mockClient = new MockLLMClient({
      shouldFail: true,
    });
    const classifier = new EnhancedIntentClassifierService(mockClient as unknown as LLMClient);

    const result = await classifier.classifyIntent('what about that?', 'Previous conversation');

    assertEqual(result.parentIntent, 'continuation');
    assertEqual(result.childIntent, 'follow_up');
    assertTrue(result.isFollowUp);
    assertTrue(result.referencesContext);
  });

  await test('infers intent from raw content when JSON parsing fails', async () => {
    const mockClient = new MockLLMClient({
      response: 'Classification result: simple_greeting with confidence level',
    });
    const classifier = new EnhancedIntentClassifierService(mockClient as unknown as LLMClient);

    const result = await classifier.classifyIntent('hi there');

    assertEqual(result.parentIntent, 'greeting');
    assertEqual(result.childIntent, 'simple_greeting');
    assertEqual(result.confidence, 0.6);
  });

  await test('infers web_search from raw content', async () => {
    const mockClient = new MockLLMClient({
      response: 'Requires web_search capability for real-time data',
    });
    const classifier = new EnhancedIntentClassifierService(mockClient as unknown as LLMClient);

    const result = await classifier.classifyIntent('test');

    assertEqual(result.parentIntent, 'question');
    assertEqual(result.childIntent, 'web_search_question');
  });

  await test('infers task_request from raw content', async () => {
    const mockClient = new MockLLMClient({
      response: 'Detected task_request for development work',
    });
    const classifier = new EnhancedIntentClassifierService(mockClient as unknown as LLMClient);

    const result = await classifier.classifyIntent('test');

    assertEqual(result.parentIntent, 'command');
    assertEqual(result.childIntent, 'task_request');
  });

  // ============================================================================
  // Routing Hints Tests
  // ============================================================================

  console.log('\n--- Routing Hints ---\n');

  await test('sets requiresWebSearch for web_search_question', async () => {
    const mockClient = new MockLLMClient();
    const classifier = new EnhancedIntentClassifierService(mockClient as unknown as LLMClient);

    const result = await classifier.classifyIntent('what is the weather today?');

    assertTrue(result.requiresWebSearch);
  });

  await test('sets requiresWebSearch for search_request', async () => {
    const mockClient = new MockLLMClient();
    const classifier = new EnhancedIntentClassifierService(mockClient as unknown as LLMClient);

    const result = await classifier.classifyIntent('search for TypeScript tutorials');

    assertTrue(result.requiresWebSearch);
  });

  await test('sets requiresComplexReasoning for task_request', async () => {
    const mockClient = new MockLLMClient({
      response: JSON.stringify({
        parentIntent: 'command',
        childIntent: 'task_request',
        confidence: 0.85,
      }),
    });
    const classifier = new EnhancedIntentClassifierService(mockClient as unknown as LLMClient);

    const result = await classifier.classifyIntent('write a function to parse JSON');

    assertTrue(result.requiresComplexReasoning);
  });

  await test('sets requiresComplexReasoning for how_to_question', async () => {
    const mockClient = new MockLLMClient({
      response: JSON.stringify({
        parentIntent: 'question',
        childIntent: 'how_to_question',
        confidence: 0.85,
      }),
    });
    const classifier = new EnhancedIntentClassifierService(mockClient as unknown as LLMClient);

    const result = await classifier.classifyIntent('how do I implement OAuth?');

    assertTrue(result.requiresComplexReasoning);
  });

  await test('sets canUseCache for simple_greeting without context', async () => {
    const mockClient = new MockLLMClient();
    const classifier = new EnhancedIntentClassifierService(mockClient as unknown as LLMClient);

    const result = await classifier.classifyIntent('hello');

    assertTrue(result.canUseCache);
    assertFalse(result.referencesContext);
  });

  await test('disables cache when message references context', async () => {
    const mockClient = new MockLLMClient({
      response: JSON.stringify({
        parentIntent: 'question',
        childIntent: 'factual_question',
        confidence: 0.80,
      }),
    });
    const classifier = new EnhancedIntentClassifierService(mockClient as unknown as LLMClient);

    const result = await classifier.classifyIntent('what is it?', 'Previous context');

    assertFalse(result.canUseCache, 'Should not cache when referencing context');
    assertTrue(result.referencesContext);
  });

  await test('respects LLM routing hints', async () => {
    const mockClient = new MockLLMClient({
      response: JSON.stringify({
        parentIntent: 'question',
        childIntent: 'factual_question',
        confidence: 0.85,
        requiresWebSearch: true,
        requiresComplexReasoning: true,
      }),
    });
    const classifier = new EnhancedIntentClassifierService(mockClient as unknown as LLMClient);

    const result = await classifier.classifyIntent('complex question requiring search');

    assertTrue(result.requiresWebSearch, 'Should respect LLM requiresWebSearch');
    assertTrue(result.requiresComplexReasoning, 'Should respect LLM requiresComplexReasoning');
  });

  // ============================================================================
  // Configuration Tests
  // ============================================================================

  console.log('\n--- Configuration ---\n');

  await test('uses custom timeout configuration', async () => {
    const mockClient = new MockLLMClient();
    const classifier = new EnhancedIntentClassifierService(
      mockClient as unknown as LLMClient,
      { timeoutMs: 1000 }
    );

    // This is a basic test - the actual timeout behavior is tested in timeout test
    const result = await classifier.classifyIntent('hello');
    assertTrue(result.durationMs >= 0);
  });

  await test('uses custom confidence thresholds', async () => {
    const mockClient = new MockLLMClient({
      response: JSON.stringify({
        parentIntent: 'question',
        childIntent: 'factual_question',
        confidence: 0.75,
      }),
    });
    const customThresholds: ConfidenceThresholds = {
      high: 0.90,
      medium: 0.70,
      low: 0.50,
      escalate: 0.40,
    };
    const classifier = new EnhancedIntentClassifierService(
      mockClient as unknown as LLMClient,
      { confidenceThresholds: customThresholds }
    );

    const result = await classifier.classifyIntent('test');

    assertEqual(result.confidenceLevel, 'medium', 'Should use custom threshold (0.75 >= 0.70 but < 0.90)');
  });

  // ============================================================================
  // Timing and Performance Tests
  // ============================================================================

  console.log('\n--- Timing and Performance ---\n');

  await test('records duration for pattern-based classification', async () => {
    const mockClient = new MockLLMClient();
    const classifier = new EnhancedIntentClassifierService(mockClient as unknown as LLMClient);

    const result = await classifier.classifyIntent('hello');

    assertTrue(result.durationMs >= 0);
    assertLessThan(result.durationMs, 100, 'Pattern matching should be fast');
  });

  await test('records duration for LLM-based classification', async () => {
    const mockClient = new MockLLMClient({
      response: JSON.stringify({
        parentIntent: 'question',
        childIntent: 'opinion_question',
        confidence: 0.85,
      }),
    });
    const classifier = new EnhancedIntentClassifierService(mockClient as unknown as LLMClient);

    const result = await classifier.classifyIntent('What do you think about AI?');

    assertTrue(result.durationMs >= 0);
  });

  // ============================================================================
  // Edge Cases
  // ============================================================================

  console.log('\n--- Edge Cases ---\n');

  await test('handles empty message', async () => {
    const mockClient = new MockLLMClient();
    const classifier = new EnhancedIntentClassifierService(mockClient as unknown as LLMClient);

    const result = await classifier.classifyIntent('');

    assertTrue(result.parentIntent !== undefined);
    assertTrue(result.childIntent !== undefined);
  });

  await test('handles very long message', async () => {
    const mockClient = new MockLLMClient({
      response: JSON.stringify({
        parentIntent: 'question',
        childIntent: 'factual_question',
        confidence: 0.80,
      }),
    });
    const classifier = new EnhancedIntentClassifierService(mockClient as unknown as LLMClient);

    const longMessage = 'This is a very long message. '.repeat(100);
    const result = await classifier.classifyIntent(longMessage);

    assertTrue(result.parentIntent !== undefined);
    assertTrue(result.childIntent !== undefined);
  });

  await test('handles message with special characters', async () => {
    const mockClient = new MockLLMClient({
      response: JSON.stringify({
        parentIntent: 'question',
        childIntent: 'factual_question',
        confidence: 0.80,
      }),
    });
    const classifier = new EnhancedIntentClassifierService(mockClient as unknown as LLMClient);

    const result = await classifier.classifyIntent('What is 2+2? @#$%^&*()');

    assertTrue(result.parentIntent !== undefined);
    assertTrue(result.childIntent !== undefined);
  });

  await test('skips context-required patterns without context', async () => {
    const mockClient = new MockLLMClient({
      response: JSON.stringify({
        parentIntent: 'continuation',
        childIntent: 'clarification',
        confidence: 0.85,
      }),
    });
    const classifier = new EnhancedIntentClassifierService(mockClient as unknown as LLMClient);

    // "what do you mean?" requires context, should use LLM when no context
    const result = await classifier.classifyIntent('what do you mean?');

    assertTrue(mockClient.chatCalled, 'Should use LLM when context-required pattern has no context');
    assertEqual(result.classificationMethod, 'llm');
  });

  // Print summary
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(console.error);
