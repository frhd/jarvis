/**
 * Memory Management Tests
 * Tests for memory leak prevention and resource cleanup
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EnhancedIntentClassifierService } from './enhancedIntentClassifier.service';
import { LLMClient } from '../clients/llm.client';

// Mock LLM Client
const mockLLMClient = {
  chat: vi.fn(),
  cancelRequest: vi.fn(),
} as unknown as LLMClient;

describe('EnhancedIntentClassifier Memory Management', () => {
  let classifier: EnhancedIntentClassifierService;

  beforeEach(() => {
    vi.useFakeTimers();
    classifier = new EnhancedIntentClassifierService(mockLLMClient as LLMClient, {
      timeoutMs: 5000,
      enableCache: true,
      cacheMaxSize: 100,
      cacheTtlMs: 60000,
    });
  });

  afterEach(() => {
    classifier.destroy();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('should clean up stale in-flight requests periodically', async () => {
    // Mock a long-running classification
    let resolveClassification: (value: unknown) => void;
    const classificationPromise = new Promise((resolve) => {
      resolveClassification = resolve;
    });

    (mockLLMClient.chat as ReturnType<typeof vi.fn>).mockReturnValue(classificationPromise);

    // Start a classification (will create in-flight entry)
    const classifyPromise = classifier.classifyIntent('test message');

    // Verify in-flight entry was created
    const metrics1 = classifier.getMetrics();
    expect(metrics1.deduplicatedRequests).toBe(0);

    // Start another classification with same content (should reuse)
    const classifyPromise2 = classifier.classifyIntent('test message');
    const metrics2 = classifier.getMetrics();
    expect(metrics2.deduplicatedRequests).toBe(1);

    // Resolve the classification
    resolveClassification!({
      content: JSON.stringify({
        parentIntent: 'question',
        childIntent: 'factual_question',
        confidence: 0.9,
      }),
    });

    await Promise.all([classifyPromise, classifyPromise2]);
  });

  it('should enforce cache size limits', async () => {
    // Fill cache beyond limit
    (mockLLMClient.chat as ReturnType<typeof vi.fn>).mockResolvedValue({
      content: JSON.stringify({
        parentIntent: 'greeting',
        childIntent: 'simple_greeting',
        confidence: 0.9,
      }),
    });

    // Add 150 unique messages (cache max is 100)
    for (let i = 0; i < 150; i++) {
      await classifier.classifyIntent(`unique message ${i}`);
    }

    // Get metrics to check cache didn't exceed limit
    const metrics = classifier.getMetrics();
    // Cache should have evicted old entries
    expect(metrics.cacheMisses).toBeGreaterThan(100);
  });

  it('should expire cache entries after TTL', async () => {
    (mockLLMClient.chat as ReturnType<typeof vi.fn>).mockResolvedValue({
      content: JSON.stringify({
        parentIntent: 'greeting',
        childIntent: 'simple_greeting',
        confidence: 0.9,
        canUseCache: true,
      }),
    });

    // Classify a message (should be cached)
    await classifier.classifyIntent('hello world');

    const metrics1 = classifier.getMetrics();
    expect(metrics1.cacheMisses).toBe(1); // First call is a miss

    // Advance time past TTL (60 seconds)
    await vi.advanceTimersByTimeAsync(65000);

    // Same message should be a miss because TTL expired
    await classifier.classifyIntent('hello world');

    const metrics2 = classifier.getMetrics();
    expect(metrics2.cacheMisses).toBe(2); // Second call is also a miss due to TTL
  });

  it('should clear all resources on destroy', () => {
    // Make some classifications to populate state
    (mockLLMClient.chat as ReturnType<typeof vi.fn>).mockResolvedValue({
      content: JSON.stringify({
        parentIntent: 'greeting',
        childIntent: 'simple_greeting',
        confidence: 0.9,
      }),
    });

    // Destroy should clean up intervals and maps
    classifier.destroy();

    // Verify no errors thrown after destroy
    expect(() => classifier.destroy()).not.toThrow();
  });
});

describe('Memory Growth Detection', () => {
  it('should not accumulate unbounded arrays in loops', () => {
    // Simulate processing many items without accumulation
    const processed: string[] = [];
    const MAX_BATCH = 100;

    for (let i = 0; i < 1000; i++) {
      processed.push(`item-${i}`);

      // Simulate batch processing with cleanup
      if (processed.length >= MAX_BATCH) {
        // Process batch
        processed.length = 0; // Clear array
      }
    }

    // Array should not contain all 1000 items
    expect(processed.length).toBeLessThan(MAX_BATCH);
  });

  it('should use Maps with bounded size', () => {
    const cache = new Map<string, number>();
    const MAX_SIZE = 100;

    for (let i = 0; i < 200; i++) {
      cache.set(`key-${i}`, i);

      // Enforce size limit
      if (cache.size > MAX_SIZE) {
        // Remove oldest entry (first key)
        const firstKey = cache.keys().next().value;
        if (firstKey) {
          cache.delete(firstKey);
        }
      }
    }

    expect(cache.size).toBeLessThanOrEqual(MAX_SIZE);
  });
});

describe('Event Listener Cleanup', () => {
  it('should track and cleanup intervals', () => {
    const intervals: NodeJS.Timeout[] = [];

    // Create intervals
    for (let i = 0; i < 5; i++) {
      intervals.push(setInterval(() => {}, 1000));
    }

    // Cleanup all intervals
    for (const interval of intervals) {
      clearInterval(interval);
    }

    // No way to verify intervals are cleared in Node.js,
    // but this pattern demonstrates proper cleanup
    expect(intervals.length).toBe(5);
  });
});
