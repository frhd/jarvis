/**
 * MessageLengthService Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  MessageLengthService,
  TELEGRAM_MAX_LENGTH,
  TARGET_LENGTH,
  SUMMARIZATION_THRESHOLD,
} from './messageLength.service.js';

describe('MessageLengthService', () => {
  let service: MessageLengthService;

  beforeEach(() => {
    // Create service with summarization disabled for most tests
    service = new MessageLengthService({ summarizationEnabled: false });
  });

  describe('constants', () => {
    it('are correctly defined', () => {
      expect(TELEGRAM_MAX_LENGTH).toBe(4096);
      expect(TARGET_LENGTH).toBe(3500);
      expect(SUMMARIZATION_THRESHOLD).toBe(3800);
    });
  });

  describe('getLength', () => {
    it('returns correct character count', () => {
      expect(service.getLength('hello')).toBe(5);
      expect(service.getLength('')).toBe(0);
      expect(service.getLength('a'.repeat(100))).toBe(100);
    });

    it('handles unicode characters', () => {
      expect(service.getLength('🙂')).toBe(2);
      expect(service.getLength('日本語')).toBe(3);
    });
  });

  describe('isOverLimit', () => {
    it('returns false for short text', () => {
      expect(service.isOverLimit('short text')).toBe(false);
    });

    it('returns false for text at limit', () => {
      const textAtLimit = 'a'.repeat(4096);
      expect(service.isOverLimit(textAtLimit)).toBe(false);
    });

    it('returns true for text over limit', () => {
      const textOverLimit = 'a'.repeat(4097);
      expect(service.isOverLimit(textOverLimit)).toBe(true);
    });
  });

  describe('shouldSummarize', () => {
    it('returns false for short text', () => {
      const serviceWithSummarization = new MessageLengthService({ summarizationEnabled: true });
      expect(serviceWithSummarization.shouldSummarize('short text')).toBe(false);
    });

    it('returns false when disabled', () => {
      const longText = 'a'.repeat(4000);
      expect(service.shouldSummarize(longText)).toBe(false);
    });

    it('returns true for long text when enabled', () => {
      const serviceWithSummarization = new MessageLengthService({ summarizationEnabled: true });
      const longText = 'a'.repeat(4000);
      expect(serviceWithSummarization.shouldSummarize(longText)).toBe(true);
    });
  });

  describe('truncateAtSentence', () => {
    it('leaves short text unchanged', () => {
      const text = 'Short text that is under limit.';
      expect(service.truncateAtSentence(text, 100)).toBe(text);
    });

    it('finds sentence boundary', () => {
      const text = 'First sentence. Second sentence. Third sentence that is much longer.';
      const result = service.truncateAtSentence(text, 35);
      expect(result).toContain('First sentence.');
      expect(result.endsWith('...')).toBe(true);
      expect(result.length).toBeLessThanOrEqual(35);
    });

    it('handles question marks', () => {
      const text = 'Is this a question? Yes it is! And more text here.';
      const result = service.truncateAtSentence(text, 30);
      expect(result.includes('?') || result.includes('!')).toBe(true);
      expect(result.endsWith('...')).toBe(true);
    });

    it('falls back to word boundary', () => {
      const text = 'This is a long sentence without any punctuation that goes on and on';
      const result = service.truncateAtSentence(text, 30);
      expect(result.endsWith('...')).toBe(true);
      expect(result).not.toContain('and on');
    });

    it('handles newlines', () => {
      const text = 'First paragraph\nSecond paragraph that is much longer';
      const result = service.truncateAtSentence(text, 25);
      expect(result.endsWith('...')).toBe(true);
      expect(result.length).toBeLessThanOrEqual(25);
    });

    it('preserves markdown code blocks when possible', () => {
      const text = 'Here is code:\n```\nconst x = 1;\n```\nMore text after the code block.';
      const result = service.truncateAtSentence(text, text.length); // No truncation needed
      expect(result).toBe(text);
    });
  });

  describe('ensureFitsLimit', () => {
    it('passes through short messages', async () => {
      const text = 'Short message';
      const result = await service.ensureFitsLimit(text);
      expect(result.text).toBe(text);
      expect(result.originalLength).toBe(text.length);
      expect(result.finalLength).toBe(text.length);
      expect(result.wasSummarized).toBe(false);
      expect(result.wasTruncated).toBe(false);
    });

    it('truncates long messages', async () => {
      const longText = 'a'.repeat(5000);
      const result = await service.ensureFitsLimit(longText);
      expect(result.wasTruncated).toBe(true);
      expect(result.wasSummarized).toBe(false);
      expect(result.finalLength).toBeLessThanOrEqual(TELEGRAM_MAX_LENGTH);
      expect(result.text.endsWith('...')).toBe(true);
    });

    it('tracks processing time', async () => {
      const text = 'Test message';
      const result = await service.ensureFitsLimit(text);
      expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('metrics', () => {
    it('getMetrics returns correct counts', async () => {
      const testService = new MessageLengthService({ summarizationEnabled: false });

      // Initially zero
      let metrics = testService.getMetrics();
      expect(metrics.summarizationCount).toBe(0);
      expect(metrics.truncationCount).toBe(0);

      // After truncation
      await testService.ensureFitsLimit('a'.repeat(5000));
      metrics = testService.getMetrics();
      expect(metrics.truncationCount).toBe(1);
    });

    it('resetMetrics clears counters', async () => {
      const testService = new MessageLengthService({ summarizationEnabled: false });
      await testService.ensureFitsLimit('a'.repeat(5000));

      testService.resetMetrics();
      const metrics = testService.getMetrics();
      expect(metrics.summarizationCount).toBe(0);
      expect(metrics.truncationCount).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('handles empty string', async () => {
      const result = await service.ensureFitsLimit('');
      expect(result.text).toBe('');
      expect(result.originalLength).toBe(0);
      expect(result.wasTruncated).toBe(false);
    });

    it('handles text exactly at target length', async () => {
      const text = 'a'.repeat(TARGET_LENGTH);
      const result = await service.ensureFitsLimit(text);
      expect(result.text).toBe(text);
      expect(result.wasTruncated).toBe(false);
    });

    it('handles text with only punctuation', () => {
      const text = '...!!!???';
      const result = service.truncateAtSentence(text.repeat(500), 50);
      expect(result.endsWith('...')).toBe(true);
      expect(result.length).toBeLessThanOrEqual(50);
    });

    it('handles text with unicode at truncation point', async () => {
      const text = 'Hello 🙂 ' + 'a'.repeat(5000);
      const result = await service.ensureFitsLimit(text);
      expect(result.wasTruncated).toBe(true);
      // Should not break in the middle of the emoji
    });
  });
});
