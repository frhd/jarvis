import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeCallbacks, executeCallbacksAsync } from './callback-executor.js';

// Mock the logger
vi.mock('./logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('callback-executor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('executeCallbacks', () => {
    it('should execute all callbacks with the argument', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();
      const callbacks = [callback1, callback2];

      executeCallbacks(callbacks, 'test-arg', 'test-context');

      expect(callback1).toHaveBeenCalledWith('test-arg');
      expect(callback2).toHaveBeenCalledWith('test-arg');
    });

    it('should continue executing after a callback throws', () => {
      const callback1 = vi.fn(() => {
        throw new Error('callback error');
      });
      const callback2 = vi.fn();
      const callbacks = [callback1, callback2];

      executeCallbacks(callbacks, 'test-arg', 'test-context');

      expect(callback1).toHaveBeenCalled();
      expect(callback2).toHaveBeenCalled();
    });

    it('should handle empty callback array', () => {
      expect(() => executeCallbacks([], 'arg', 'context')).not.toThrow();
    });

    it('should pass complex objects as arguments', () => {
      const callback = vi.fn();
      const complexArg = { id: 1, data: { nested: true } };

      executeCallbacks([callback], complexArg, 'context');

      expect(callback).toHaveBeenCalledWith(complexArg);
    });
  });

  describe('executeCallbacksAsync', () => {
    it('should execute all async callbacks with the argument', async () => {
      const callback1 = vi.fn().mockResolvedValue(undefined);
      const callback2 = vi.fn().mockResolvedValue(undefined);
      const callbacks = [callback1, callback2];

      await executeCallbacksAsync(callbacks, 'test-arg', 'test-context');

      expect(callback1).toHaveBeenCalledWith('test-arg');
      expect(callback2).toHaveBeenCalledWith('test-arg');
    });

    it('should continue executing after an async callback rejects', async () => {
      const callback1 = vi.fn().mockRejectedValue(new Error('async error'));
      const callback2 = vi.fn().mockResolvedValue(undefined);
      const callbacks = [callback1, callback2];

      await executeCallbacksAsync(callbacks, 'test-arg', 'test-context');

      expect(callback1).toHaveBeenCalled();
      expect(callback2).toHaveBeenCalled();
    });

    it('should handle mixed sync and async callbacks', async () => {
      const syncCallback = vi.fn();
      const asyncCallback = vi.fn().mockResolvedValue(undefined);
      const callbacks = [syncCallback, asyncCallback];

      await executeCallbacksAsync(callbacks, 'test-arg', 'test-context');

      expect(syncCallback).toHaveBeenCalledWith('test-arg');
      expect(asyncCallback).toHaveBeenCalledWith('test-arg');
    });

    it('should handle empty callback array', async () => {
      await expect(executeCallbacksAsync([], 'arg', 'context')).resolves.toBeUndefined();
    });
  });
});
