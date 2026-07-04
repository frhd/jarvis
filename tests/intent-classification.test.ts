#!/usr/bin/env npx tsx
/**
 * Intent Classification Comprehensive Test Suite
 * Phase 2.4: Testing & Validation
 *
 * Tests pattern-based classification accuracy, confidence thresholds,
 * and overall classification performance across all 27 child intents.
 *
 * Run: npx tsx tests/intent-classification.test.ts
 */

import { EnhancedIntentClassifierService } from '../src/services/enhancedIntentClassifier.service';
import { LLMClient, ChatMessage, LLMResponse } from '../src/clients/llm.client';
import {
  ParentIntent,
  ChildIntent,
  EnhancedIntentResult,
  ConfidenceThresholds,
  DEFAULT_CONFIDENCE_THRESHOLDS,
} from '../src/types/intent.types';
import {
  intentTestDataset,
  testCasesByParentIntent,
  testCasesByChildIntent,
  datasetStats,
  IntentTestCase,
} from './fixtures/intent-test-dataset';

// ============================================================================
// Test Helpers
// ============================================================================

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

// ============================================================================
// Mock LLM Client
// ============================================================================

class MockLLMClient {
  private defaultResponse: any;
  public chatCalled = false;
  public callCount = 0;
  public lastMessages: ChatMessage[] = [];

  constructor(options: { defaultResponse?: any } = {}) {
    this.defaultResponse = options.defaultResponse || {
      parentIntent: 'question',
      childIntent: 'factual_question',
      confidence: 0.8,
      isFollowUp: false,
      referencesContext: false,
      requiresWebSearch: false,
      requiresComplexReasoning: false,
    };
  }

  async chat(messages: ChatMessage[], _requestId?: string): Promise<LLMResponse> {
    this.chatCalled = true;
    this.callCount++;
    this.lastMessages = messages;

    return {
      content: JSON.stringify(this.defaultResponse),
      model: 'test-model',
    };
  }

  cancelRequest(_requestId: string): void {
    // No-op for tests
  }

  reset() {
    this.chatCalled = false;
    this.callCount = 0;
    this.lastMessages = [];
  }
}

// ============================================================================
// Accuracy Tracking
// ============================================================================

interface AccuracyResults {
  total: number;
  correct: number;
  incorrect: number;
  accuracy: number;
  byParentIntent: Record<ParentIntent, { correct: number; total: number; accuracy: number }>;
  byChildIntent: Record<string, { correct: number; total: number; accuracy: number }>;
  patternMatchedCount: number;
  llmUsedCount: number;
  failures: Array<{
    input: string;
    expected: { parent: ParentIntent; child: ChildIntent };
    actual: { parent: ParentIntent; child: ChildIntent };
    confidence: number;
  }>;
}

function calculateAccuracy(
  results: Array<{ testCase: IntentTestCase; result: EnhancedIntentResult }>
): AccuracyResults {
  const accuracy: AccuracyResults = {
    total: results.length,
    correct: 0,
    incorrect: 0,
    accuracy: 0,
    byParentIntent: {
      greeting: { correct: 0, total: 0, accuracy: 0 },
      question: { correct: 0, total: 0, accuracy: 0 },
      command: { correct: 0, total: 0, accuracy: 0 },
      feedback: { correct: 0, total: 0, accuracy: 0 },
      continuation: { correct: 0, total: 0, accuracy: 0 },
    },
    byChildIntent: {},
    patternMatchedCount: 0,
    llmUsedCount: 0,
    failures: [],
  };

  for (const { testCase, result } of results) {
    const isParentCorrect = result.parentIntent === testCase.expectedParentIntent;
    const isChildCorrect = result.childIntent === testCase.expectedChildIntent;
    const isCorrect = isParentCorrect && isChildCorrect;

    if (isCorrect) {
      accuracy.correct++;
    } else {
      accuracy.incorrect++;
      accuracy.failures.push({
        input: testCase.input,
        expected: {
          parent: testCase.expectedParentIntent,
          child: testCase.expectedChildIntent,
        },
        actual: {
          parent: result.parentIntent,
          child: result.childIntent,
        },
        confidence: result.confidence,
      });
    }

    // Track by parent intent
    accuracy.byParentIntent[testCase.expectedParentIntent].total++;
    if (isParentCorrect) {
      accuracy.byParentIntent[testCase.expectedParentIntent].correct++;
    }

    // Track by child intent
    if (!accuracy.byChildIntent[testCase.expectedChildIntent]) {
      accuracy.byChildIntent[testCase.expectedChildIntent] = { correct: 0, total: 0, accuracy: 0 };
    }
    accuracy.byChildIntent[testCase.expectedChildIntent].total++;
    if (isChildCorrect) {
      accuracy.byChildIntent[testCase.expectedChildIntent].correct++;
    }

    // Track classification method
    if (result.classificationMethod === 'pattern') {
      accuracy.patternMatchedCount++;
    } else if (result.classificationMethod === 'llm') {
      accuracy.llmUsedCount++;
    }
  }

  // Calculate percentages
  accuracy.accuracy = (accuracy.correct / accuracy.total) * 100;

  for (const parent in accuracy.byParentIntent) {
    const stats = accuracy.byParentIntent[parent as ParentIntent];
    stats.accuracy = stats.total > 0 ? (stats.correct / stats.total) * 100 : 0;
  }

  for (const child in accuracy.byChildIntent) {
    const stats = accuracy.byChildIntent[child];
    stats.accuracy = stats.total > 0 ? (stats.correct / stats.total) * 100 : 0;
  }

  return accuracy;
}

// ============================================================================
// Main Test Suite
// ============================================================================

async function runTests() {
  console.log('\n=== Intent Classification Test Suite ===\n');
  console.log(`Dataset: ${datasetStats.total} test cases`);
  console.log(`Parent intents: ${Object.keys(datasetStats.byParentIntent).length}`);
  console.log(`Child intents: ${Object.keys(datasetStats.byChildIntent).length}`);
  console.log('');

  // ============================================================================
  // Dataset Validation
  // ============================================================================

  console.log('--- Dataset Validation ---\n');

  await test('dataset covers all 25 child intents', () => {
    const expectedChildIntents = 25;
    const actualChildIntents = Object.keys(testCasesByChildIntent).length;
    assertEqual(
      actualChildIntents,
      expectedChildIntents,
      `Expected ${expectedChildIntents} child intents, found ${actualChildIntents}`
    );
  });

  await test('dataset has at least 100 test cases', () => {
    assertTrue(intentTestDataset.length >= 100, `Expected at least 100 test cases, found ${intentTestDataset.length}`);
  });

  await test('all parent intents are covered', () => {
    const parentIntents: ParentIntent[] = ['greeting', 'question', 'command', 'feedback', 'continuation'];
    for (const parent of parentIntents) {
      assertTrue(
        testCasesByParentIntent[parent].length > 0,
        `Parent intent "${parent}" has no test cases`
      );
    }
  });

  await test('each child intent has at least 3 test cases', () => {
    for (const [childIntent, cases] of Object.entries(testCasesByChildIntent)) {
      assertTrue(
        cases.length >= 3,
        `Child intent "${childIntent}" has only ${cases.length} test cases (minimum 3)`
      );
    }
  });

  // ============================================================================
  // Pattern-Based Classification Tests
  // ============================================================================

  console.log('\n--- Pattern-Based Classification ---\n');

  await test('classifies simple greetings with pattern matching', async () => {
    const mockClient = new MockLLMClient();
    const classifier = new EnhancedIntentClassifierService(mockClient as unknown as LLMClient);

    const greetingCases = ['hi', 'hello', 'hey', 'yo', 'sup'];
    let allPassed = true;

    for (const input of greetingCases) {
      const result = await classifier.classifyIntent(input);
      if (
        result.parentIntent !== 'greeting' ||
        result.childIntent !== 'simple_greeting' ||
        result.classificationMethod !== 'pattern'
      ) {
        allPassed = false;
        break;
      }
    }

    assertTrue(allPassed, 'All simple greetings should use pattern matching');
    assertFalse(mockClient.chatCalled, 'Should not call LLM for pattern-matched greetings');
  });

  await test('classifies time greetings with pattern matching', async () => {
    const mockClient = new MockLLMClient();
    const classifier = new EnhancedIntentClassifierService(mockClient as unknown as LLMClient);

    const timeGreetings = ['good morning', 'good afternoon', 'good evening', 'good night'];
    let allCorrect = true;

    for (const input of timeGreetings) {
      const result = await classifier.classifyIntent(input);
      if (result.childIntent !== 'time_greeting' || result.classificationMethod !== 'pattern') {
        allCorrect = false;
        break;
      }
    }

    assertTrue(allCorrect, 'All time greetings should be pattern-matched');
  });

  await test('classifies farewell with pattern matching', async () => {
    const mockClient = new MockLLMClient();
    const classifier = new EnhancedIntentClassifierService(mockClient as unknown as LLMClient);

    const farewells = ['bye', 'goodbye', 'see ya', 'later'];
    let allCorrect = true;

    for (const input of farewells) {
      const result = await classifier.classifyIntent(input);
      if (result.childIntent !== 'farewell' || result.classificationMethod !== 'pattern') {
        allCorrect = false;
        break;
      }
    }

    assertTrue(allCorrect, 'All farewells should be pattern-matched');
  });

  await test('classifies gratitude with pattern matching', async () => {
    const mockClient = new MockLLMClient();
    const classifier = new EnhancedIntentClassifierService(mockClient as unknown as LLMClient);

    const gratitudes = ['thanks', 'thank you', 'thx', 'ty'];
    let allCorrect = true;

    for (const input of gratitudes) {
      const result = await classifier.classifyIntent(input);
      if (result.childIntent !== 'gratitude' || result.classificationMethod !== 'pattern') {
        allCorrect = false;
        break;
      }
    }

    assertTrue(allCorrect, 'All gratitude expressions should be pattern-matched');
  });

  await test('classifies web search questions with pattern matching', async () => {
    const mockClient = new MockLLMClient();
    const classifier = new EnhancedIntentClassifierService(mockClient as unknown as LLMClient);

    const result = await classifier.classifyIntent('what is the weather in Tokyo?');

    assertEqual(result.childIntent, 'web_search_question');
    assertEqual(result.classificationMethod, 'pattern');
    assertTrue(result.requiresWebSearch);
  });

  await test('classifies calculations with pattern matching', async () => {
    const mockClient = new MockLLMClient();
    const classifier = new EnhancedIntentClassifierService(mockClient as unknown as LLMClient);

    const calculations = ['what is 5 + 5', '15 - 7', 'calculate 125 * 8'];
    let allCorrect = true;

    for (const input of calculations) {
      const result = await classifier.classifyIntent(input);
      if (result.childIntent !== 'calculation' || result.classificationMethod !== 'pattern') {
        allCorrect = false;
        break;
      }
    }

    assertTrue(allCorrect, 'All calculations should be pattern-matched');
  });

  await test('classifies acknowledgments with pattern matching', async () => {
    const mockClient = new MockLLMClient();
    const classifier = new EnhancedIntentClassifierService(mockClient as unknown as LLMClient);

    const acknowledgments = ['ok', 'okay', 'got it', 'understood'];
    let allCorrect = true;

    for (const input of acknowledgments) {
      const result = await classifier.classifyIntent(input);
      if (result.childIntent !== 'acknowledgment' || result.classificationMethod !== 'pattern') {
        allCorrect = false;
        break;
      }
    }

    assertTrue(allCorrect, 'All acknowledgments should be pattern-matched');
  });

  // ============================================================================
  // Confidence Threshold Behavior Tests
  // ============================================================================

  console.log('\n--- Confidence Threshold Behavior ---\n');

  await test('assigns high confidence level for pattern matches', async () => {
    const mockClient = new MockLLMClient();
    const classifier = new EnhancedIntentClassifierService(mockClient as unknown as LLMClient);

    const result = await classifier.classifyIntent('hello');

    assertEqual(result.confidenceLevel, 'high');
    assertGreaterThanOrEqual(result.confidence, DEFAULT_CONFIDENCE_THRESHOLDS.high);
  });

  await test('assigns medium confidence level for medium scores', async () => {
    const mockClient = new MockLLMClient({
      defaultResponse: {
        parentIntent: 'question',
        childIntent: 'factual_question',
        confidence: 0.70,
      },
    });
    const classifier = new EnhancedIntentClassifierService(mockClient as unknown as LLMClient);

    const result = await classifier.classifyIntent('ambiguous question');

    assertEqual(result.confidenceLevel, 'medium');
    assertGreaterThanOrEqual(result.confidence, DEFAULT_CONFIDENCE_THRESHOLDS.medium);
    assertLessThan(result.confidence, DEFAULT_CONFIDENCE_THRESHOLDS.high);
  });

  await test('assigns low confidence level for low scores', async () => {
    const mockClient = new MockLLMClient({
      defaultResponse: {
        parentIntent: 'question',
        childIntent: 'factual_question',
        confidence: 0.50,
      },
    });
    const classifier = new EnhancedIntentClassifierService(mockClient as unknown as LLMClient);

    const result = await classifier.classifyIntent('very ambiguous');

    assertEqual(result.confidenceLevel, 'low');
    assertGreaterThanOrEqual(result.confidence, DEFAULT_CONFIDENCE_THRESHOLDS.low);
    assertLessThan(result.confidence, DEFAULT_CONFIDENCE_THRESHOLDS.medium);
  });

  await test('assigns uncertain confidence level for very low scores', async () => {
    const mockClient = new MockLLMClient({
      defaultResponse: {
        parentIntent: 'question',
        childIntent: 'factual_question',
        confidence: 0.30,
      },
    });
    const classifier = new EnhancedIntentClassifierService(mockClient as unknown as LLMClient);

    const result = await classifier.classifyIntent('???');

    assertEqual(result.confidenceLevel, 'uncertain');
    assertLessThan(result.confidence, DEFAULT_CONFIDENCE_THRESHOLDS.low);
  });

  await test('marks for escalation when confidence is below threshold', async () => {
    const mockClient = new MockLLMClient({
      defaultResponse: {
        parentIntent: 'question',
        childIntent: 'factual_question',
        confidence: 0.30,
      },
    });
    const classifier = new EnhancedIntentClassifierService(mockClient as unknown as LLMClient);

    const result = await classifier.classifyIntent('unclear message');

    assertTrue(result.shouldEscalate);
    assertLessThan(result.confidence, DEFAULT_CONFIDENCE_THRESHOLDS.escalate);
  });

  await test('respects custom confidence thresholds', async () => {
    const customThresholds: ConfidenceThresholds = {
      high: 0.90,
      medium: 0.70,
      low: 0.50,
      escalate: 0.40,
    };
    const mockClient = new MockLLMClient({
      defaultResponse: {
        parentIntent: 'question',
        childIntent: 'factual_question',
        confidence: 0.75,
      },
    });
    const classifier = new EnhancedIntentClassifierService(mockClient as unknown as LLMClient, {
      confidenceThresholds: customThresholds,
    });

    const result = await classifier.classifyIntent('test');

    assertEqual(result.confidenceLevel, 'medium');
    assertGreaterThanOrEqual(result.confidence, customThresholds.medium);
    assertLessThan(result.confidence, customThresholds.high);
  });

  // ============================================================================
  // Overall Classification Accuracy Tests
  // ============================================================================

  console.log('\n--- Overall Classification Accuracy ---\n');

  await test('achieves >85% accuracy on pattern-matched intents', async () => {
    const mockClient = new MockLLMClient();
    const classifier = new EnhancedIntentClassifierService(mockClient as unknown as LLMClient);

    // Test only intents that should be pattern-matched
    const patternIntents: ChildIntent[] = [
      'simple_greeting',
      'time_greeting',
      'farewell',
      'gratitude',
      'acknowledgment',
      'positive_feedback',
      'negative_feedback',
      'calculation',
      'web_search_question',
      'search_request',
    ];

    const patternTestCases = intentTestDataset.filter((tc) =>
      patternIntents.includes(tc.expectedChildIntent)
    );

    const results: Array<{ testCase: IntentTestCase; result: EnhancedIntentResult }> = [];

    for (const testCase of patternTestCases) {
      const result = await classifier.classifyIntent(testCase.input);
      results.push({ testCase, result });
    }

    const accuracy = calculateAccuracy(results);

    console.log(`  Pattern-matched accuracy: ${accuracy.accuracy.toFixed(2)}%`);
    console.log(`  Correct: ${accuracy.correct}/${accuracy.total}`);

    assertGreaterThanOrEqual(
      accuracy.accuracy,
      85,
      `Expected >85% accuracy, got ${accuracy.accuracy.toFixed(2)}%`
    );
  });

  await test('measures full dataset accuracy (note: limited by mock LLM)', async () => {
    const mockClient = new MockLLMClient();
    const classifier = new EnhancedIntentClassifierService(mockClient as unknown as LLMClient);

    const results: Array<{ testCase: IntentTestCase; result: EnhancedIntentResult }> = [];

    console.log(`  Testing ${intentTestDataset.length} cases...`);

    for (const testCase of intentTestDataset) {
      // Provide context for intents that require it
      const context = testCase.notes?.includes('context') ? 'Previous conversation context' : undefined;
      const result = await classifier.classifyIntent(testCase.input, context);
      results.push({ testCase, result });
    }

    const accuracy = calculateAccuracy(results);

    console.log(`\n  Overall Accuracy: ${accuracy.accuracy.toFixed(2)}%`);
    console.log(`  Correct: ${accuracy.correct}/${accuracy.total}`);
    console.log(`  Pattern-matched: ${accuracy.patternMatchedCount}`);
    console.log(`  LLM-used: ${accuracy.llmUsedCount}`);
    console.log(`  Note: Mock LLM always returns factual_question, limiting non-pattern accuracy`);

    // With a mock LLM, we expect pattern-matched intents to work well
    // Real LLM would achieve much higher accuracy (70-90%)
    assertGreaterThanOrEqual(
      accuracy.accuracy,
      50,
      `Expected at least 50% accuracy with mock LLM, got ${accuracy.accuracy.toFixed(2)}%`
    );
  });

  // ============================================================================
  // Per-Intent Accuracy Tests
  // ============================================================================

  console.log('\n--- Per-Intent Accuracy Report ---\n');

  await test('generates per-parent-intent accuracy report', async () => {
    const mockClient = new MockLLMClient();
    const classifier = new EnhancedIntentClassifierService(mockClient as unknown as LLMClient);

    const results: Array<{ testCase: IntentTestCase; result: EnhancedIntentResult }> = [];

    for (const testCase of intentTestDataset) {
      const context = testCase.notes?.includes('context') ? 'Previous conversation' : undefined;
      const result = await classifier.classifyIntent(testCase.input, context);
      results.push({ testCase, result });
    }

    const accuracy = calculateAccuracy(results);

    console.log('  Parent Intent Accuracy:');
    for (const [parent, stats] of Object.entries(accuracy.byParentIntent)) {
      console.log(`    ${parent}: ${stats.accuracy.toFixed(1)}% (${stats.correct}/${stats.total})`);
    }

    // All parent intents should have some accuracy
    for (const stats of Object.values(accuracy.byParentIntent)) {
      assertTrue(stats.total > 0, 'Each parent intent should have test cases');
    }
  });

  await test('generates per-child-intent accuracy report', async () => {
    const mockClient = new MockLLMClient();
    const classifier = new EnhancedIntentClassifierService(mockClient as unknown as LLMClient);

    const results: Array<{ testCase: IntentTestCase; result: EnhancedIntentResult }> = [];

    for (const testCase of intentTestDataset) {
      const context = testCase.notes?.includes('context') ? 'Previous context' : undefined;
      const result = await classifier.classifyIntent(testCase.input, context);
      results.push({ testCase, result });
    }

    const accuracy = calculateAccuracy(results);

    console.log('\n  Child Intent Accuracy:');
    const sortedIntents = Object.entries(accuracy.byChildIntent).sort((a, b) => {
      return b[1].accuracy - a[1].accuracy; // Sort by accuracy descending
    });

    for (const [child, stats] of sortedIntents) {
      const percentage = stats.accuracy.toFixed(1).padStart(5);
      const counts = `${stats.correct}/${stats.total}`.padEnd(6);
      console.log(`    ${child.padEnd(22)}: ${percentage}% (${counts})`);
    }

    // With mock LLM, pattern-matched intents should have high accuracy
    // At least 10 child intents should have >50% accuracy
    const highAccuracyIntents = Object.values(accuracy.byChildIntent).filter(
      (stats) => stats.accuracy >= 50
    );
    assertGreaterThanOrEqual(
      highAccuracyIntents.length,
      10,
      `Expected at least 10 intents with >50% accuracy, got ${highAccuracyIntents.length}`
    );
  });

  await test('identifies low-accuracy intents for improvement', async () => {
    const mockClient = new MockLLMClient();
    const classifier = new EnhancedIntentClassifierService(mockClient as unknown as LLMClient);

    const results: Array<{ testCase: IntentTestCase; result: EnhancedIntentResult }> = [];

    for (const testCase of intentTestDataset) {
      const context = testCase.notes?.includes('context') ? 'Previous conversation' : undefined;
      const result = await classifier.classifyIntent(testCase.input, context);
      results.push({ testCase, result });
    }

    const accuracy = calculateAccuracy(results);

    const lowAccuracyIntents = Object.entries(accuracy.byChildIntent)
      .filter(([_, stats]) => stats.accuracy < 50)
      .sort((a, b) => a[1].accuracy - b[1].accuracy);

    if (lowAccuracyIntents.length > 0) {
      console.log('\n  Low Accuracy Intents (needs improvement):');
      for (const [child, stats] of lowAccuracyIntents) {
        console.log(`    ${child}: ${stats.accuracy.toFixed(1)}% (${stats.correct}/${stats.total})`);
      }
    }

    // This is informational, not a failure
    assertTrue(true);
  });

  await test('shows sample classification failures', async () => {
    const mockClient = new MockLLMClient();
    const classifier = new EnhancedIntentClassifierService(mockClient as unknown as LLMClient);

    const results: Array<{ testCase: IntentTestCase; result: EnhancedIntentResult }> = [];

    for (const testCase of intentTestDataset) {
      const context = testCase.notes?.includes('context') ? 'Previous message' : undefined;
      const result = await classifier.classifyIntent(testCase.input, context);
      results.push({ testCase, result });
    }

    const accuracy = calculateAccuracy(results);

    if (accuracy.failures.length > 0) {
      console.log(`\n  Sample Failures (showing first 10 of ${accuracy.failures.length}):`);
      const sampleFailures = accuracy.failures.slice(0, 10);

      for (const failure of sampleFailures) {
        console.log(`\n    Input: "${failure.input}"`);
        console.log(`    Expected: ${failure.expected.parent} → ${failure.expected.child}`);
        console.log(`    Got: ${failure.actual.parent} → ${failure.actual.child}`);
        console.log(`    Confidence: ${(failure.confidence * 100).toFixed(1)}%`);
      }
    }

    // This is informational
    assertTrue(true);
  });

  // ============================================================================
  // Edge Cases
  // ============================================================================

  console.log('\n--- Edge Cases ---\n');

  await test('handles empty message gracefully', async () => {
    const mockClient = new MockLLMClient();
    const classifier = new EnhancedIntentClassifierService(mockClient as unknown as LLMClient);

    const result = await classifier.classifyIntent('');

    assertTrue(result.parentIntent !== undefined);
    assertTrue(result.childIntent !== undefined);
    assertTrue(result.durationMs >= 0);
  });

  await test('handles very long messages', async () => {
    const mockClient = new MockLLMClient();
    const classifier = new EnhancedIntentClassifierService(mockClient as unknown as LLMClient);

    const longMessage = 'This is a very long message. '.repeat(100);
    const result = await classifier.classifyIntent(longMessage);

    assertTrue(result.parentIntent !== undefined);
    assertTrue(result.childIntent !== undefined);
  });

  await test('handles messages with only punctuation', async () => {
    const mockClient = new MockLLMClient();
    const classifier = new EnhancedIntentClassifierService(mockClient as unknown as LLMClient);

    const result = await classifier.classifyIntent('???');

    assertTrue(result.parentIntent !== undefined);
    assertTrue(result.childIntent !== undefined);
  });

  await test('handles mixed case variations', async () => {
    const mockClient = new MockLLMClient();
    const classifier = new EnhancedIntentClassifierService(mockClient as unknown as LLMClient);

    const variations = ['HELLO', 'HeLLo', 'hello', 'HELLO!!!'];
    let allCorrect = true;

    for (const input of variations) {
      const result = await classifier.classifyIntent(input);
      if (result.childIntent !== 'simple_greeting') {
        allCorrect = false;
        break;
      }
    }

    assertTrue(allCorrect, 'All case variations should be recognized');
  });

  // ============================================================================
  // Performance Tests
  // ============================================================================

  console.log('\n--- Performance ---\n');

  await test('pattern matching is fast (<10ms average)', async () => {
    const mockClient = new MockLLMClient();
    const classifier = new EnhancedIntentClassifierService(mockClient as unknown as LLMClient);

    const patternCases = ['hi', 'hello', 'thanks', 'bye', 'ok'];
    const durations: number[] = [];

    for (const input of patternCases) {
      const result = await classifier.classifyIntent(input);
      durations.push(result.durationMs);
    }

    const avgDuration = durations.reduce((sum, d) => sum + d, 0) / durations.length;

    console.log(`  Average pattern matching duration: ${avgDuration.toFixed(2)}ms`);

    assertLessThan(avgDuration, 10, `Expected <10ms average, got ${avgDuration.toFixed(2)}ms`);
  });

  // Print summary
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

// Run tests
runTests().catch((error) => {
  console.error('Test suite failed:', error);
  process.exit(1);
});
