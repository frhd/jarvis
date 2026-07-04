import { describe, it, expect } from 'vitest';
import {
  isRecord,
  hasProperty,
  isString,
  isNumber,
  isBoolean,
  isArrayOf,
  isConfidenceScore,
  safeJsonParse,
  safeJsonParseWithResult,
  extractJsonFromContent,
  parseJsonFromContent,
  isOneOf,
  createStringLiteralGuard,
} from './type-guards.js';

describe('type-guards', () => {
  describe('isRecord', () => {
    it('returns true for plain objects', () => {
      expect(isRecord({})).toBe(true);
      expect(isRecord({ key: 'value' })).toBe(true);
    });

    it('returns false for arrays', () => {
      expect(isRecord([])).toBe(false);
      expect(isRecord([1, 2, 3])).toBe(false);
    });

    it('returns false for null and undefined', () => {
      expect(isRecord(null)).toBe(false);
      expect(isRecord(undefined)).toBe(false);
    });

    it('returns false for primitives', () => {
      expect(isRecord('string')).toBe(false);
      expect(isRecord(123)).toBe(false);
      expect(isRecord(true)).toBe(false);
    });
  });

  describe('hasProperty', () => {
    it('returns true when property exists', () => {
      expect(hasProperty({ name: 'test' }, 'name')).toBe(true);
      expect(hasProperty({ a: 1, b: 2 }, 'a')).toBe(true);
    });

    it('returns false when property does not exist', () => {
      expect(hasProperty({}, 'name')).toBe(false);
      expect(hasProperty({ a: 1 }, 'b')).toBe(false);
    });

    it('returns false for non-objects', () => {
      expect(hasProperty(null, 'name')).toBe(false);
      expect(hasProperty('string', 'length')).toBe(false);
      expect(hasProperty([], 'length')).toBe(false);
    });
  });

  describe('isString', () => {
    it('returns true for strings', () => {
      expect(isString('')).toBe(true);
      expect(isString('hello')).toBe(true);
      expect(isString(String('test'))).toBe(true);
    });

    it('returns false for non-strings', () => {
      expect(isString(123)).toBe(false);
      expect(isString(null)).toBe(false);
      expect(isString(undefined)).toBe(false);
      expect(isString({})).toBe(false);
      expect(isString([])).toBe(false);
    });
  });

  describe('isNumber', () => {
    it('returns true for valid numbers', () => {
      expect(isNumber(0)).toBe(true);
      expect(isNumber(123)).toBe(true);
      expect(isNumber(-456)).toBe(true);
      expect(isNumber(3.14)).toBe(true);
    });

    it('returns false for NaN', () => {
      expect(isNumber(NaN)).toBe(false);
    });

    it('returns false for non-numbers', () => {
      expect(isNumber('123')).toBe(false);
      expect(isNumber(null)).toBe(false);
      expect(isNumber(undefined)).toBe(false);
    });
  });

  describe('isBoolean', () => {
    it('returns true for booleans', () => {
      expect(isBoolean(true)).toBe(true);
      expect(isBoolean(false)).toBe(true);
    });

    it('returns false for non-booleans', () => {
      expect(isBoolean(0)).toBe(false);
      expect(isBoolean(1)).toBe(false);
      expect(isBoolean('true')).toBe(false);
      expect(isBoolean(null)).toBe(false);
    });
  });

  describe('isArrayOf', () => {
    it('returns true for arrays matching the guard', () => {
      expect(isArrayOf(['a', 'b', 'c'], isString)).toBe(true);
      expect(isArrayOf([1, 2, 3], isNumber)).toBe(true);
      expect(isArrayOf([], isString)).toBe(true);
    });

    it('returns false when some elements do not match', () => {
      expect(isArrayOf(['a', 1, 'c'], isString)).toBe(false);
      expect(isArrayOf([1, 'b', 3], isNumber)).toBe(false);
    });

    it('returns false for non-arrays', () => {
      expect(isArrayOf('string', isString)).toBe(false);
      expect(isArrayOf({ 0: 'a', length: 1 }, isString)).toBe(false);
    });
  });

  describe('isConfidenceScore', () => {
    it('returns true for valid confidence scores', () => {
      expect(isConfidenceScore(0)).toBe(true);
      expect(isConfidenceScore(0.5)).toBe(true);
      expect(isConfidenceScore(1)).toBe(true);
      expect(isConfidenceScore(0.85)).toBe(true);
    });

    it('returns false for out-of-range values', () => {
      expect(isConfidenceScore(-0.1)).toBe(false);
      expect(isConfidenceScore(1.1)).toBe(false);
      expect(isConfidenceScore(2)).toBe(false);
    });

    it('returns false for non-numbers', () => {
      expect(isConfidenceScore('0.5')).toBe(false);
      expect(isConfidenceScore(NaN)).toBe(false);
    });
  });

  describe('safeJsonParse', () => {
    it('parses valid JSON', () => {
      expect(safeJsonParse('{"key": "value"}')).toEqual({ key: 'value' });
      expect(safeJsonParse('[1, 2, 3]')).toEqual([1, 2, 3]);
      expect(safeJsonParse('"string"')).toBe('string');
    });

    it('returns null for invalid JSON', () => {
      expect(safeJsonParse('not json')).toBeNull();
      expect(safeJsonParse('{invalid}')).toBeNull();
      expect(safeJsonParse('')).toBeNull();
    });

    it('validates with type guard when provided', () => {
      const isStringArray = (v: unknown): v is string[] => isArrayOf(v, isString);

      expect(safeJsonParse('["a", "b"]', isStringArray)).toEqual(['a', 'b']);
      expect(safeJsonParse('[1, 2]', isStringArray)).toBeNull();
    });
  });

  describe('safeJsonParseWithResult', () => {
    it('returns success with data for valid JSON', () => {
      const result = safeJsonParseWithResult('{"key": "value"}');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ key: 'value' });
      }
    });

    it('returns failure with error for invalid JSON', () => {
      const result = safeJsonParseWithResult('not json');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBeDefined();
        expect(result.raw).toBe('not json');
      }
    });

    it('truncates long raw content in error', () => {
      const longContent = 'x'.repeat(150);
      const result = safeJsonParseWithResult(longContent);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.raw.length).toBeLessThanOrEqual(103); // 100 chars + '...'
      }
    });

    it('returns failure when type guard fails', () => {
      const isStringArray = (v: unknown): v is string[] => isArrayOf(v, isString);
      const result = safeJsonParseWithResult('[1, 2, 3]', isStringArray);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('Type guard validation failed');
      }
    });

    it('returns success when type guard passes', () => {
      const isStringArray = (v: unknown): v is string[] => isArrayOf(v, isString);
      const result = safeJsonParseWithResult('["a", "b"]', isStringArray);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(['a', 'b']);
      }
    });
  });

  describe('extractJsonFromContent', () => {
    it('extracts JSON from markdown code blocks', () => {
      const content = '```json\n{"key": "value"}\n```';
      expect(extractJsonFromContent(content)).toBe('{"key": "value"}');
    });

    it('extracts JSON from code blocks without language', () => {
      const content = '```\n{"key": "value"}\n```';
      expect(extractJsonFromContent(content)).toBe('{"key": "value"}');
    });

    it('extracts raw JSON objects', () => {
      const content = 'Some text {"key": "value"} more text';
      expect(extractJsonFromContent(content)).toBe('{"key": "value"}');
    });

    it('returns original content if no JSON found', () => {
      const content = 'just plain text';
      expect(extractJsonFromContent(content)).toBe('just plain text');
    });

    it('handles nested objects', () => {
      const content = '```json\n{"outer": {"inner": "value"}}\n```';
      expect(extractJsonFromContent(content)).toBe('{"outer": {"inner": "value"}}');
    });
  });

  describe('parseJsonFromContent', () => {
    it('parses JSON from code blocks', () => {
      const content = '```json\n{"key": "value"}\n```';
      expect(parseJsonFromContent(content)).toEqual({ key: 'value' });
    });

    it('parses raw JSON from content', () => {
      const content = 'Here is the result: {"status": "ok"}';
      expect(parseJsonFromContent(content)).toEqual({ status: 'ok' });
    });

    it('returns null for invalid JSON', () => {
      expect(parseJsonFromContent('no json here')).toBeNull();
    });

    it('validates with type guard when provided', () => {
      const content = '{"count": 5}';
      const hasCount = (v: unknown): v is { count: number } =>
        isRecord(v) && hasProperty(v, 'count') && isNumber(v.count);

      expect(parseJsonFromContent(content, hasCount)).toEqual({ count: 5 });
      expect(parseJsonFromContent('{"count": "five"}', hasCount)).toBeNull();
    });
  });

  describe('isOneOf', () => {
    const colors = ['red', 'green', 'blue'] as const;

    it('returns true for valid values', () => {
      expect(isOneOf('red', colors)).toBe(true);
      expect(isOneOf('green', colors)).toBe(true);
      expect(isOneOf('blue', colors)).toBe(true);
    });

    it('returns false for invalid values', () => {
      expect(isOneOf('yellow', colors)).toBe(false);
      expect(isOneOf('', colors)).toBe(false);
    });

    it('returns false for non-strings', () => {
      expect(isOneOf(123, colors)).toBe(false);
      expect(isOneOf(null, colors)).toBe(false);
    });
  });

  describe('createStringLiteralGuard', () => {
    const isStatus = createStringLiteralGuard(['pending', 'active', 'completed'] as const);

    it('creates a working type guard', () => {
      expect(isStatus('pending')).toBe(true);
      expect(isStatus('active')).toBe(true);
      expect(isStatus('completed')).toBe(true);
    });

    it('rejects invalid values', () => {
      expect(isStatus('unknown')).toBe(false);
      expect(isStatus('')).toBe(false);
      expect(isStatus(123)).toBe(false);
    });
  });
});
