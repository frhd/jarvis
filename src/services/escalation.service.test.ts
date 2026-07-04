#!/usr/bin/env npx tsx
/**
 * EscalationService Tests
 *
 * Run: npx tsx src/services/escalation.service.test.ts
 */

import { EscalationService } from './escalation.service';
import { ClaudeClient, ClaudeResponse } from '../clients/claude.client';
import { EnhancedIntentResult } from '../types/intent.types';

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

// Mock ClaudeClient for testing
class MockClaudeClient {
  private response: ClaudeResponse;
  public chatCalled = false;
  public lastMessage = '';
  public lastContext?: string;

  constructor(options: {
    success?: boolean;
    content?: string;
    error?: string;
    durationMs?: number;
  } = {}) {
    this.response = {
      success: options.success ?? true,
      content: options.content || JSON.stringify({
        parentIntent: 'question',
        childIntent: 'factual_question',
        confidence: 0.85,
        isFollowUp: false,
        referencesContext: false,
        requiresWebSearch: false,
        requiresComplexReasoning: false,
        reasoning: 'This is a straightforward factual question.',
      }),
      error: options.error,
      durationMs: options.durationMs ?? 100,
    };
  }

  async chat(message: string, context?: string): Promise<ClaudeResponse> {
    this.chatCalled = true;
    this.lastMessage = message;
    this.lastContext = context;
    return this.response;
  }

  async healthCheck() {
    return { healthy: true };
  }
}

// Helper to create a test EnhancedIntentResult
function createTestResult(overrides?: Partial<EnhancedIntentResult>): EnhancedIntentResult {
  return {
    parentIntent: 'question',
    childIntent: 'factual_question',
    confidence: 0.30,
    confidenceLevel: 'uncertain',
    shouldEscalate: true,
    isFollowUp: false,
    referencesContext: false,
    suggestedContextDepth: 0,
    requiresWebSearch: false,
    requiresComplexReasoning: false,
    canUseCache: true,
    durationMs: 100,
    classificationMethod: 'llm',
    ...overrides,
  };
}

async function runTests() {
  console.log('\n=== EscalationService Tests ===\n');

  // ============================================================================
  // Basic Escalation Tests
  // ============================================================================

  console.log('--- Basic Escalation ---\n');

  await test('successfully escalates uncertain classification', async () => {
    const mockClient = new MockClaudeClient();
    const service = new EscalationService(mockClient as unknown as ClaudeClient);

    const originalResult = createTestResult({
      confidence: 0.25,
      confidenceLevel: 'uncertain',
      shouldEscalate: true,
    });

    const result = await service.escalateIntent('ambiguous message', originalResult);

    assertTrue(mockClient.chatCalled, 'Should call Claude');
    assertEqual(result.classificationMethod, 'escalated');
    assertGreaterThan(result.confidence, originalResult.confidence);
    assertFalse(result.shouldEscalate, 'Should not require further escalation');
  });

  await test('includes original classification in escalation prompt', async () => {
    const mockClient = new MockClaudeClient();
    const service = new EscalationService(mockClient as unknown as ClaudeClient);

    const originalResult = createTestResult({
      parentIntent: 'question',
      childIntent: 'factual_question',
      confidence: 0.30,
    });

    await service.escalateIntent('test message', originalResult);

    assertTrue(mockClient.lastMessage.includes('factual_question'));
    assertTrue(mockClient.lastMessage.includes('0.30'));
    assertTrue(mockClient.lastMessage.includes('Original Classification'));
  });

  await test('includes conversation context in escalation', async () => {
    const mockClient = new MockClaudeClient();
    const service = new EscalationService(mockClient as unknown as ClaudeClient);

    const originalResult = createTestResult();
    const context = 'User: Tell me about Python\nAssistant: Python is a programming language';

    await service.escalateIntent('What about its libraries?', originalResult, context);

    assertTrue(mockClient.lastMessage.includes('Conversation Context'));
    assertTrue(mockClient.lastMessage.includes('Python'));
  });

  await test('returns higher confidence after escalation', async () => {
    const mockClient = new MockClaudeClient({
      content: JSON.stringify({
        parentIntent: 'question',
        childIntent: 'how_to_question',
        confidence: 0.90,
        isFollowUp: false,
        referencesContext: false,
        requiresWebSearch: false,
        requiresComplexReasoning: true,
        reasoning: 'Claude has high confidence this is a how-to question.',
      }),
    });
    const service = new EscalationService(mockClient as unknown as ClaudeClient);

    const originalResult = createTestResult({ confidence: 0.30 });
    const result = await service.escalateIntent('How do I deploy?', originalResult);

    assertEqual(result.confidence, 0.90);
    assertEqual(result.confidenceLevel, 'high');
    assertEqual(result.childIntent, 'how_to_question');
  });

  // ============================================================================
  // JSON Parsing Tests
  // ============================================================================

  console.log('\n--- JSON Parsing ---\n');

  await test('parses clean JSON response', async () => {
    const mockClient = new MockClaudeClient({
      content: JSON.stringify({
        parentIntent: 'command',
        childIntent: 'task_request',
        confidence: 0.88,
        isFollowUp: false,
        referencesContext: false,
        requiresWebSearch: false,
        requiresComplexReasoning: true,
      }),
    });
    const service = new EscalationService(mockClient as unknown as ClaudeClient);

    const originalResult = createTestResult();
    const result = await service.escalateIntent('Write code for me', originalResult);

    assertEqual(result.parentIntent, 'command');
    assertEqual(result.childIntent, 'task_request');
    assertEqual(result.confidence, 0.88);
    assertTrue(result.requiresComplexReasoning);
  });

  await test('extracts JSON from markdown code block', async () => {
    const mockClient = new MockClaudeClient({
      content: '```json\n{"parentIntent": "greeting", "childIntent": "simple_greeting", "confidence": 0.95}\n```',
    });
    const service = new EscalationService(mockClient as unknown as ClaudeClient);

    const originalResult = createTestResult();
    const result = await service.escalateIntent('hello', originalResult);

    assertEqual(result.parentIntent, 'greeting');
    assertEqual(result.childIntent, 'simple_greeting');
    assertEqual(result.confidence, 0.95);
  });

  await test('extracts JSON from response with extra text', async () => {
    const mockClient = new MockClaudeClient({
      content: 'Here is my analysis:\n{"parentIntent": "question", "childIntent": "opinion_question", "confidence": 0.82}\nI hope this helps!',
    });
    const service = new EscalationService(mockClient as unknown as ClaudeClient);

    const originalResult = createTestResult();
    const result = await service.escalateIntent('What do you think?', originalResult);

    assertEqual(result.parentIntent, 'question');
    assertEqual(result.childIntent, 'opinion_question');
    assertEqual(result.confidence, 0.82);
  });

  // ============================================================================
  // Validation Tests
  // ============================================================================

  console.log('\n--- Validation and Correction ---\n');

  await test('corrects invalid parent intent', async () => {
    const mockClient = new MockClaudeClient({
      content: JSON.stringify({
        parentIntent: 'invalid_parent',
        childIntent: 'factual_question',
        confidence: 0.80,
      }),
    });
    const service = new EscalationService(mockClient as unknown as ClaudeClient);

    const originalResult = createTestResult();
    const result = await service.escalateIntent('test', originalResult);

    assertEqual(result.parentIntent, 'question', 'Should default to question for invalid parent');
  });

  await test('corrects invalid child intent', async () => {
    const mockClient = new MockClaudeClient({
      content: JSON.stringify({
        parentIntent: 'question',
        childIntent: 'invalid_child',
        confidence: 0.80,
      }),
    });
    const service = new EscalationService(mockClient as unknown as ClaudeClient);

    const originalResult = createTestResult();
    const result = await service.escalateIntent('test', originalResult);

    assertEqual(result.childIntent, 'factual_question', 'Should default to factual_question');
  });

  await test('ensures parent-child consistency', async () => {
    const mockClient = new MockClaudeClient({
      content: JSON.stringify({
        parentIntent: 'greeting', // Wrong parent for task_request
        childIntent: 'task_request',
        confidence: 0.85,
      }),
    });
    const service = new EscalationService(mockClient as unknown as ClaudeClient);

    const originalResult = createTestResult();
    const result = await service.escalateIntent('test', originalResult);

    assertEqual(result.parentIntent, 'command', 'Should correct parent to match child');
    assertEqual(result.childIntent, 'task_request');
  });

  await test('validates and corrects invalid confidence', async () => {
    const mockClient = new MockClaudeClient({
      content: JSON.stringify({
        parentIntent: 'question',
        childIntent: 'factual_question',
        confidence: 'very high', // Invalid
      }),
    });
    const service = new EscalationService(mockClient as unknown as ClaudeClient);

    const originalResult = createTestResult();
    const result = await service.escalateIntent('test', originalResult);

    assertEqual(result.confidence, 0.75, 'Should use default confidence');
  });

  await test('clamps confidence to valid range', async () => {
    const mockClient = new MockClaudeClient({
      content: JSON.stringify({
        parentIntent: 'question',
        childIntent: 'factual_question',
        confidence: 1.5, // Out of range
      }),
    });
    const service = new EscalationService(mockClient as unknown as ClaudeClient);

    const originalResult = createTestResult();
    const result = await service.escalateIntent('test', originalResult);

    assertEqual(result.confidence, 0.75, 'Should use default confidence for invalid range');
  });

  // ============================================================================
  // Confidence Level Tests
  // ============================================================================

  console.log('\n--- Confidence Levels ---\n');

  await test('assigns high confidence level', async () => {
    const mockClient = new MockClaudeClient({
      content: JSON.stringify({
        parentIntent: 'greeting',
        childIntent: 'simple_greeting',
        confidence: 0.92,
      }),
    });
    const service = new EscalationService(mockClient as unknown as ClaudeClient);

    const originalResult = createTestResult();
    const result = await service.escalateIntent('hello', originalResult);

    assertEqual(result.confidenceLevel, 'high');
    assertGreaterThanOrEqual(result.confidence, 0.85);
  });

  await test('assigns medium confidence level', async () => {
    const mockClient = new MockClaudeClient({
      content: JSON.stringify({
        parentIntent: 'question',
        childIntent: 'factual_question',
        confidence: 0.72,
      }),
    });
    const service = new EscalationService(mockClient as unknown as ClaudeClient);

    const originalResult = createTestResult();
    const result = await service.escalateIntent('test', originalResult);

    assertEqual(result.confidenceLevel, 'medium');
  });

  await test('assigns low confidence level', async () => {
    const mockClient = new MockClaudeClient({
      content: JSON.stringify({
        parentIntent: 'question',
        childIntent: 'factual_question',
        confidence: 0.52,
      }),
    });
    const service = new EscalationService(mockClient as unknown as ClaudeClient);

    const originalResult = createTestResult();
    const result = await service.escalateIntent('test', originalResult);

    assertEqual(result.confidenceLevel, 'low');
  });

  await test('assigns uncertain confidence level', async () => {
    const mockClient = new MockClaudeClient({
      content: JSON.stringify({
        parentIntent: 'question',
        childIntent: 'factual_question',
        confidence: 0.40,
      }),
    });
    const service = new EscalationService(mockClient as unknown as ClaudeClient);

    const originalResult = createTestResult();
    const result = await service.escalateIntent('test', originalResult);

    assertEqual(result.confidenceLevel, 'uncertain');
  });

  // ============================================================================
  // Multi-turn Context Tests
  // ============================================================================

  console.log('\n--- Multi-turn Context ---\n');

  await test('detects follow-up messages', async () => {
    const mockClient = new MockClaudeClient({
      content: JSON.stringify({
        parentIntent: 'continuation',
        childIntent: 'follow_up',
        confidence: 0.88,
        isFollowUp: true,
        referencesContext: true,
      }),
    });
    const service = new EscalationService(mockClient as unknown as ClaudeClient);

    const originalResult = createTestResult();
    const result = await service.escalateIntent('What about that?', originalResult, 'Previous context');

    assertTrue(result.isFollowUp);
    assertTrue(result.referencesContext);
    assertGreaterThan(result.suggestedContextDepth, 0);
  });

  await test('sets context depth for follow-ups', async () => {
    const mockClient = new MockClaudeClient({
      content: JSON.stringify({
        parentIntent: 'continuation',
        childIntent: 'elaboration_request',
        confidence: 0.85,
        isFollowUp: true,
        referencesContext: true,
      }),
    });
    const service = new EscalationService(mockClient as unknown as ClaudeClient);

    const originalResult = createTestResult();
    const result = await service.escalateIntent('Tell me more', originalResult);

    assertEqual(result.suggestedContextDepth, 5);
  });

  await test('disables cache for context-dependent messages', async () => {
    const mockClient = new MockClaudeClient({
      content: JSON.stringify({
        parentIntent: 'continuation',
        childIntent: 'reference_previous',
        confidence: 0.86,
        isFollowUp: true,
        referencesContext: true,
      }),
    });
    const service = new EscalationService(mockClient as unknown as ClaudeClient);

    const originalResult = createTestResult();
    const result = await service.escalateIntent('As you mentioned', originalResult);

    assertFalse(result.canUseCache);
    assertTrue(result.referencesContext);
  });

  await test('enables cache for standalone messages', async () => {
    const mockClient = new MockClaudeClient({
      content: JSON.stringify({
        parentIntent: 'greeting',
        childIntent: 'simple_greeting',
        confidence: 0.95,
        isFollowUp: false,
        referencesContext: false,
      }),
    });
    const service = new EscalationService(mockClient as unknown as ClaudeClient);

    const originalResult = createTestResult();
    const result = await service.escalateIntent('hello', originalResult);

    assertTrue(result.canUseCache);
    assertFalse(result.referencesContext);
  });

  // ============================================================================
  // Routing Hints Tests
  // ============================================================================

  console.log('\n--- Routing Hints ---\n');

  await test('sets requiresWebSearch flag', async () => {
    const mockClient = new MockClaudeClient({
      content: JSON.stringify({
        parentIntent: 'question',
        childIntent: 'web_search_question',
        confidence: 0.90,
        requiresWebSearch: true,
      }),
    });
    const service = new EscalationService(mockClient as unknown as ClaudeClient);

    const originalResult = createTestResult();
    const result = await service.escalateIntent('weather in Tokyo', originalResult);

    assertTrue(result.requiresWebSearch);
  });

  await test('sets requiresComplexReasoning flag', async () => {
    const mockClient = new MockClaudeClient({
      content: JSON.stringify({
        parentIntent: 'command',
        childIntent: 'task_request',
        confidence: 0.87,
        requiresComplexReasoning: true,
      }),
    });
    const service = new EscalationService(mockClient as unknown as ClaudeClient);

    const originalResult = createTestResult();
    const result = await service.escalateIntent('write a function', originalResult);

    assertTrue(result.requiresComplexReasoning);
  });

  // ============================================================================
  // Fallback Tests
  // ============================================================================

  console.log('\n--- Fallback Behavior ---\n');

  await test('falls back to original result on error', async () => {
    const mockClient = new MockClaudeClient({
      success: false,
      error: 'Claude CLI error',
    });
    const service = new EscalationService(mockClient as unknown as ClaudeClient);

    const originalResult = createTestResult({
      childIntent: 'opinion_question',
      confidence: 0.32,
    });

    const result = await service.escalateIntent('test', originalResult);

    assertEqual(result.childIntent, 'opinion_question', 'Should keep original classification');
    assertEqual(result.confidence, 0.32, 'Should keep original confidence');
    assertEqual(result.classificationMethod, 'escalated', 'Should mark as attempted escalation');
  });

  await test('throws error when fallback disabled', async () => {
    const mockClient = new MockClaudeClient({
      success: false,
      error: 'Claude CLI error',
    });
    const service = new EscalationService(
      mockClient as unknown as ClaudeClient,
      { enableFallback: false }
    );

    const originalResult = createTestResult();

    try {
      await service.escalateIntent('test', originalResult);
      throw new Error('Should have thrown error');
    } catch (error) {
      assertTrue(error instanceof Error);
      assertTrue((error as Error).message.includes('Claude CLI error'));
    }
  });

  await test('handles malformed JSON response', async () => {
    const mockClient = new MockClaudeClient({
      content: 'This is not valid JSON at all!',
    });
    const service = new EscalationService(mockClient as unknown as ClaudeClient);

    const originalResult = createTestResult({
      childIntent: 'clarification',
      confidence: 0.28,
    });

    const result = await service.escalateIntent('test', originalResult);

    // Should fallback to original
    assertEqual(result.childIntent, 'clarification');
    assertEqual(result.confidence, 0.28);
    assertEqual(result.classificationMethod, 'escalated');
  });

  // ============================================================================
  // Integration Tests
  // ============================================================================

  console.log('\n--- Integration Scenarios ---\n');

  await test('escalation improves classification accuracy', async () => {
    const mockClient = new MockClaudeClient({
      content: JSON.stringify({
        parentIntent: 'question',
        childIntent: 'how_to_question',
        confidence: 0.92,
        isFollowUp: false,
        referencesContext: false,
        requiresWebSearch: false,
        requiresComplexReasoning: true,
        reasoning: 'This is clearly a how-to question requiring step-by-step explanation.',
      }),
    });
    const service = new EscalationService(mockClient as unknown as ClaudeClient);

    const originalResult = createTestResult({
      childIntent: 'factual_question', // Incorrectly classified
      confidence: 0.33,
      shouldEscalate: true,
    });

    const result = await service.escalateIntent('How do I set up Docker?', originalResult);

    assertEqual(result.childIntent, 'how_to_question', 'Should correct classification');
    assertGreaterThan(result.confidence, 0.85, 'Should have high confidence');
    assertTrue(result.requiresComplexReasoning);
  });

  await test('handles web search questions correctly', async () => {
    const mockClient = new MockClaudeClient({
      content: JSON.stringify({
        parentIntent: 'question',
        childIntent: 'web_search_question',
        confidence: 0.93,
        requiresWebSearch: true,
        reasoning: 'Requires real-time weather data.',
      }),
    });
    const service = new EscalationService(mockClient as unknown as ClaudeClient);

    const originalResult = createTestResult({ confidence: 0.31 });
    const result = await service.escalateIntent('What is the weather in Paris?', originalResult);

    assertEqual(result.childIntent, 'web_search_question');
    assertTrue(result.requiresWebSearch);
    assertEqual(result.confidenceLevel, 'high');
  });

  await test('preserves timing information', async () => {
    const mockClient = new MockClaudeClient({ durationMs: 2500 });
    const service = new EscalationService(mockClient as unknown as ClaudeClient);

    const originalResult = createTestResult();
    const result = await service.escalateIntent('test', originalResult);

    assertTrue(result.durationMs >= 0, 'Should have duration');
  });

  // Print summary
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(console.error);
