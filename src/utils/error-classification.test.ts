import { describe, it, expect } from 'vitest';
import {
  isTelegramConnectionError,
  isNonCriticalError,
  formatErrorForLog,
} from './error-classification.js';

describe('error-classification', () => {
  describe('isTelegramConnectionError', () => {
    it('should return false for null/undefined', () => {
      expect(isTelegramConnectionError(null)).toBe(false);
      expect(isTelegramConnectionError(undefined)).toBe(false);
    });

    it('should detect TIMEOUT errors', () => {
      const error = new Error('Connection TIMEOUT');
      expect(isTelegramConnectionError(error)).toBe(true);
    });

    it('should detect "Not connected" errors', () => {
      const error = new Error('Not connected to server');
      expect(isTelegramConnectionError(error)).toBe(true);
    });

    it('should detect CONNECTION_NOT_INITED errors', () => {
      const error = new Error('CONNECTION_NOT_INITED');
      expect(isTelegramConnectionError(error)).toBe(true);
    });

    it('should detect NETWORK_MIGRATE errors', () => {
      const error = new Error('NETWORK_MIGRATE to new DC');
      expect(isTelegramConnectionError(error)).toBe(true);
    });

    it('should detect ECONNRESET errors', () => {
      const error = new Error('ECONNRESET');
      expect(isTelegramConnectionError(error)).toBe(true);
    });

    it('should detect ETIMEDOUT errors', () => {
      const error = new Error('ETIMEDOUT');
      expect(isTelegramConnectionError(error)).toBe(true);
    });

    it('should detect errors from Telegram library stack', () => {
      const error = new Error('Something went wrong');
      error.stack = 'Error: Something went wrong\n    at telegram/client.js:100:20';
      expect(isTelegramConnectionError(error)).toBe(true);
    });

    it('should detect MTProtoSender errors', () => {
      const error = new Error('Network issue');
      error.stack = 'Error: Network issue\n    at MTProtoSender.send';
      expect(isTelegramConnectionError(error)).toBe(true);
    });

    it('should return false for unrelated errors', () => {
      const error = new Error('Database query failed');
      error.stack = 'Error: Database query failed\n    at sqlite/query.js:50';
      expect(isTelegramConnectionError(error)).toBe(false);
    });

    it('should handle string errors', () => {
      expect(isTelegramConnectionError('Connection TIMEOUT')).toBe(true);
      expect(isTelegramConnectionError('Random error')).toBe(false);
    });
  });

  describe('isNonCriticalError', () => {
    it('should return false for null/undefined', () => {
      expect(isNonCriticalError(null)).toBe(false);
      expect(isNonCriticalError(undefined)).toBe(false);
    });

    it('should detect intent classification timeouts', () => {
      const error = new Error('intent classification timed out');
      expect(isNonCriticalError(error)).toBe(true);
    });

    it('should detect enhanced intent classification timeouts', () => {
      const error = new Error('Enhanced intent classification timed out');
      expect(isNonCriticalError(error)).toBe(true);
    });

    it('should detect LLM timeouts', () => {
      const error = new Error('LLM request timeout after 30s');
      expect(isNonCriticalError(error)).toBe(true);
    });

    it('should detect Claude CLI timeouts', () => {
      const error = new Error('Claude CLI timed out');
      expect(isNonCriticalError(error)).toBe(true);
    });

    it('should detect SQLITE_ERROR', () => {
      const error = new Error('SQLITE_ERROR: database is locked');
      expect(isNonCriticalError(error)).toBe(true);
    });

    it('should detect AntiLoop errors from stack', () => {
      const error = new Error('Loop detected');
      error.stack = 'Error: Loop detected\n    at antiLoop/service.js:100';
      expect(isNonCriticalError(error)).toBe(true);
    });

    it('should detect AntiLoop errors from message', () => {
      const error = new Error('AntiLoop triggered');
      expect(isNonCriticalError(error)).toBe(true);
    });

    it('should detect frustration detector errors', () => {
      const error = new Error('Analysis failed');
      error.stack = 'Error: Analysis failed\n    at frustrationDetector.js:50';
      expect(isNonCriticalError(error)).toBe(true);
    });

    it('should detect Frustration analysis errors from message', () => {
      const error = new Error('Frustration analysis failed');
      expect(isNonCriticalError(error)).toBe(true);
    });

    it('should detect imperative detection errors', () => {
      const error = new Error('Detection failed');
      error.stack = 'Error: Detection failed\n    at imperativeDetection.js:50';
      expect(isNonCriticalError(error)).toBe(true);
    });

    it('should detect loop detection errors', () => {
      const error = new Error('Loop check failed');
      error.stack = 'Error: Loop check failed\n    at loopDetection.js:50';
      expect(isNonCriticalError(error)).toBe(true);
    });

    it('should detect intent classifier errors', () => {
      const error = new Error('Classification failed');
      error.stack = 'Error: Classification failed\n    at enhancedIntentClassifier.js:50';
      expect(isNonCriticalError(error)).toBe(true);
    });

    it('should detect ProgressReporter network errors', () => {
      const error = new Error('ProgressReporter Network error');
      expect(isNonCriticalError(error)).toBe(true);
    });

    it('should return false for critical errors', () => {
      const error = new Error('Out of memory');
      expect(isNonCriticalError(error)).toBe(false);
    });

    it('should return false for generic errors', () => {
      const error = new Error('Something went wrong');
      expect(isNonCriticalError(error)).toBe(false);
    });

    it('should handle string errors', () => {
      expect(isNonCriticalError('intent classification timed out')).toBe(true);
      expect(isNonCriticalError('Random error')).toBe(false);
    });
  });

  describe('formatErrorForLog', () => {
    it('should handle null', () => {
      expect(formatErrorForLog(null)).toBe('Unknown error');
    });

    it('should handle undefined', () => {
      expect(formatErrorForLog(undefined)).toBe('Unknown error');
    });

    it('should handle string errors', () => {
      expect(formatErrorForLog('Simple error')).toBe('Simple error');
    });

    it('should format Error objects with message only', () => {
      const error = new Error('Test error');
      error.stack = undefined as unknown as string;
      expect(formatErrorForLog(error)).toBe('Test error');
    });

    it('should format Error objects with stack trace', () => {
      const error = new Error('Test error');
      error.stack = 'Error: Test error\n    at test.js:10';
      expect(formatErrorForLog(error)).toBe('Test error\nError: Test error\n    at test.js:10');
    });

    it('should handle number errors', () => {
      expect(formatErrorForLog(42)).toBe('42');
    });

    it('should handle object errors', () => {
      expect(formatErrorForLog({ code: 'ERR001' })).toBe('[object Object]');
    });
  });
});
