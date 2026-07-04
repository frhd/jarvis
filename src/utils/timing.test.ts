import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Timing, withTiming, withTimingSync } from './timing.js';

describe('timing', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Timing class', () => {
    it('should measure elapsed time', () => {
      const timing = new Timing();
      vi.advanceTimersByTime(100);
      expect(timing.elapsed()).toBe(100);
    });

    it('should reset the start time', () => {
      const timing = new Timing();
      vi.advanceTimersByTime(100);
      expect(timing.elapsed()).toBe(100);

      timing.reset();
      expect(timing.elapsed()).toBe(0);

      vi.advanceTimersByTime(50);
      expect(timing.elapsed()).toBe(50);
    });

    it('should start from zero', () => {
      const timing = new Timing();
      expect(timing.elapsed()).toBe(0);
    });
  });

  describe('withTiming', () => {
    it('should return result and duration for async function', async () => {
      const fn = async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return 'result';
      };

      const promise = withTiming(fn);
      vi.advanceTimersByTime(100);
      const { result, durationMs } = await promise;

      expect(result).toBe('result');
      expect(durationMs).toBe(100);
    });

    it('should handle rejected promises', async () => {
      const fn = async () => {
        throw new Error('test error');
      };

      await expect(withTiming(fn)).rejects.toThrow('test error');
    });
  });

  describe('withTimingSync', () => {
    it('should return result and duration for sync function', () => {
      const fn = () => {
        // Simulate sync work
        return 'sync result';
      };

      const { result, durationMs } = withTimingSync(fn);

      expect(result).toBe('sync result');
      expect(durationMs).toBe(0); // Sync execution is instant in fake timers
    });

    it('should handle thrown errors', () => {
      const fn = () => {
        throw new Error('sync error');
      };

      expect(() => withTimingSync(fn)).toThrow('sync error');
    });
  });
});
