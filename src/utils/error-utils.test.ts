import { describe, it, expect } from 'vitest';
import { getErrorMessage, getErrorStack } from './error-utils.js';

describe('error-utils', () => {
  describe('getErrorMessage', () => {
    it('should extract message from Error instance', () => {
      const error = new Error('test error message');
      expect(getErrorMessage(error)).toBe('test error message');
    });

    it('should return string errors directly', () => {
      expect(getErrorMessage('string error')).toBe('string error');
    });

    it('should return "Unknown error" for null', () => {
      expect(getErrorMessage(null)).toBe('Unknown error');
    });

    it('should return "Unknown error" for undefined', () => {
      expect(getErrorMessage(undefined)).toBe('Unknown error');
    });

    it('should return "Unknown error" for numbers', () => {
      expect(getErrorMessage(42)).toBe('Unknown error');
    });

    it('should return "Unknown error" for objects', () => {
      expect(getErrorMessage({ message: 'not an error' })).toBe('Unknown error');
    });

    it('should handle custom Error subclasses', () => {
      class CustomError extends Error {
        constructor(message: string) {
          super(message);
          this.name = 'CustomError';
        }
      }
      const error = new CustomError('custom error message');
      expect(getErrorMessage(error)).toBe('custom error message');
    });
  });

  describe('getErrorStack', () => {
    it('should extract stack from Error instance', () => {
      const error = new Error('test error');
      const stack = getErrorStack(error);
      expect(stack).toBeDefined();
      expect(stack).toContain('Error: test error');
    });

    it('should return undefined for string errors', () => {
      expect(getErrorStack('string error')).toBeUndefined();
    });

    it('should return undefined for null', () => {
      expect(getErrorStack(null)).toBeUndefined();
    });

    it('should return undefined for undefined', () => {
      expect(getErrorStack(undefined)).toBeUndefined();
    });

    it('should return undefined for objects', () => {
      expect(getErrorStack({ stack: 'fake stack' })).toBeUndefined();
    });
  });
});
