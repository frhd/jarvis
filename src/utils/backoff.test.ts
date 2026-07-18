import {
  computeBackoffDelayMs,
  withRetries,
  DEFAULT_BACKOFF_MULTIPLIER,
  DEFAULT_BACKOFF_ATTEMPT_OFFSET,
} from './backoff';

/**
 * Deterministic RNG helper. Returns each provided value in sequence, then repeats
 * the last one. Lets tests assert exact jittered delays.
 */
function seededRng(...values: number[]): () => number {
  let i = 0;
  return () => {
    const v = values[Math.min(i, values.length - 1)];
    i += 1;
    return v;
  };
}

describe('computeBackoffDelayMs', () => {
  describe('exponential growth (no jitter)', () => {
    it('doubles by default with attemptOffset 1', () => {
      const opts = { baseDelayMs: 1000, maxDelayMs: 60000 };
      expect(computeBackoffDelayMs(1, opts)).toBe(1000); // 1000 * 2^0
      expect(computeBackoffDelayMs(2, opts)).toBe(2000); // 1000 * 2^1
      expect(computeBackoffDelayMs(3, opts)).toBe(4000); // 1000 * 2^2
      expect(computeBackoffDelayMs(4, opts)).toBe(8000); // 1000 * 2^3
    });

    it('uses attemptOffset 0 (exponent = attempt)', () => {
      const opts = { baseDelayMs: 1000, maxDelayMs: 300000, attemptOffset: 0 };
      expect(computeBackoffDelayMs(1, opts)).toBe(2000); // 1000 * 2^1
      expect(computeBackoffDelayMs(2, opts)).toBe(4000); // 1000 * 2^2
      expect(computeBackoffDelayMs(0, opts)).toBe(1000); // 1000 * 2^0
    });

    it('respects a custom multiplier', () => {
      const opts = { baseDelayMs: 1000, maxDelayMs: 300000, attemptOffset: 0, multiplier: 3 };
      expect(computeBackoffDelayMs(1, opts)).toBe(3000); // 1000 * 3^1
      expect(computeBackoffDelayMs(2, opts)).toBe(9000); // 1000 * 3^2
    });

    it('caps at maxDelayMs', () => {
      const opts = { baseDelayMs: 1000, maxDelayMs: 10000, attemptOffset: 0 };
      expect(computeBackoffDelayMs(4, opts)).toBe(10000); // 16000 capped
      expect(computeBackoffDelayMs(10, opts)).toBe(10000);
    });

    it('does not round unless requested', () => {
      const opts = { baseDelayMs: 1500, maxDelayMs: 60000, multiplier: 1.5, attemptOffset: 0 };
      expect(computeBackoffDelayMs(1, opts)).toBe(1500 * 1.5); // 2250, unrounded
    });

    it('rounds when round is true', () => {
      const opts = { baseDelayMs: 1500, maxDelayMs: 60000, multiplier: 1.5, attemptOffset: 0, round: true };
      expect(computeBackoffDelayMs(1, opts)).toBe(Math.round(1500 * 1.5));
    });
  });

  describe('linear growth', () => {
    it('scales the base delay linearly by attempt (attemptOffset 0)', () => {
      const opts = {
        baseDelayMs: 100,
        maxDelayMs: Number.POSITIVE_INFINITY,
        growth: 'linear' as const,
        attemptOffset: 0,
      };
      expect(computeBackoffDelayMs(1, opts)).toBe(100); // 100 * 1
      expect(computeBackoffDelayMs(2, opts)).toBe(200); // 100 * 2
      expect(computeBackoffDelayMs(3, opts)).toBe(300); // 100 * 3
    });
  });

  describe('symmetric jitter', () => {
    it('applies delay + (rng*2-1) * jitterFactor * grownDelay', () => {
      // rng=0.5 -> (0.5*2-1)=0 -> no offset
      expect(
        computeBackoffDelayMs(1, {
          baseDelayMs: 1000,
          maxDelayMs: 300000,
          attemptOffset: 0,
          jitterFactor: 0.25,
          rng: seededRng(0.5),
        })
      ).toBe(2000);

      // rng=1 -> (+1)*0.25*2000 = +500
      expect(
        computeBackoffDelayMs(1, {
          baseDelayMs: 1000,
          maxDelayMs: 300000,
          attemptOffset: 0,
          jitterFactor: 0.25,
          rng: seededRng(1),
        })
      ).toBe(2500);

      // rng=0 -> (-1)*0.25*2000 = -500
      expect(
        computeBackoffDelayMs(1, {
          baseDelayMs: 1000,
          maxDelayMs: 300000,
          attemptOffset: 0,
          jitterFactor: 0.25,
          rng: seededRng(0),
        })
      ).toBe(1500);
    });

    it('clamps negative jittered delays to 0', () => {
      // Extreme downward jitter (rng=0, factor=1) -> 2000 - 2000 = 0
      expect(
        computeBackoffDelayMs(1, {
          baseDelayMs: 1000,
          maxDelayMs: 300000,
          attemptOffset: 0,
          jitterFactor: 1,
          rng: seededRng(0),
        })
      ).toBe(0);
    });

    it('matches the RetryStrategy formula (round + symmetric, offset 0)', () => {
      // Reproduces RetryStrategyService.calculateNextRetryDelay for attempt 1
      const delay = computeBackoffDelayMs(1, {
        baseDelayMs: 1000,
        maxDelayMs: 60000,
        multiplier: 2,
        attemptOffset: 0,
        jitterFactor: 0.1,
        jitterMode: 'symmetric',
        jitterBasis: 'delay',
        round: true,
        rng: seededRng(0.75),
      });
      // exp=2000; jitter=(0.75*2-1)*0.1*2000 = 0.5*200 = 100 -> 2100
      expect(delay).toBe(2100);
    });
  });

  describe('upward jitter', () => {
    it('basis "base": delay + rng * jitterFactor * baseDelay (web-search formula)', () => {
      // web-search: base 5000, attempt 2 -> exp = 5000*2^1 = 10000; jitter = rng*0.25*5000
      const delay = computeBackoffDelayMs(2, {
        baseDelayMs: 5000,
        maxDelayMs: 120000,
        multiplier: 2,
        attemptOffset: 1,
        jitterFactor: 0.25,
        jitterMode: 'upward',
        jitterBasis: 'base',
        rng: seededRng(0.4),
      });
      // exp=10000; jitter=0.4*0.25*5000=500 -> 10500
      expect(delay).toBe(10500);
    });

    it('basis "delay": delay + rng * jitterFactor * grownDelay (extraction formula)', () => {
      // extraction: base 1000, attempt 2 (0-based) -> exp = 1000*2^2 = 4000; jitter = rng*0.2*4000
      const delay = computeBackoffDelayMs(2, {
        baseDelayMs: 1000,
        maxDelayMs: 30000,
        multiplier: 2,
        attemptOffset: 0,
        jitterFactor: 0.2,
        jitterMode: 'upward',
        jitterBasis: 'delay',
        rng: seededRng(0.5),
      });
      // exp=4000; jitter=0.5*0.2*4000=400 -> 4400
      expect(delay).toBe(4400);
    });

    it('caps upward-jittered delay at maxDelayMs', () => {
      const delay = computeBackoffDelayMs(5, {
        baseDelayMs: 1000,
        maxDelayMs: 5000,
        attemptOffset: 0,
        jitterFactor: 0.5,
        jitterMode: 'upward',
        jitterBasis: 'delay',
        rng: seededRng(1),
      });
      expect(delay).toBe(5000);
    });
  });

  describe('jitter disabled', () => {
    it('does not call rng when jitterFactor is 0', () => {
      const rng = vi.fn(() => 0.5);
      const delay = computeBackoffDelayMs(1, {
        baseDelayMs: 1000,
        maxDelayMs: 60000,
        attemptOffset: 0,
        jitterFactor: 0,
        rng,
      });
      expect(delay).toBe(2000);
      expect(rng).not.toHaveBeenCalled();
    });

    it('does not call rng when jitterMode is none', () => {
      const rng = vi.fn(() => 0.5);
      computeBackoffDelayMs(1, {
        baseDelayMs: 1000,
        maxDelayMs: 60000,
        attemptOffset: 0,
        jitterFactor: 0.5,
        jitterMode: 'none',
        rng,
      });
      expect(rng).not.toHaveBeenCalled();
    });
  });

  describe('exported defaults', () => {
    it('exposes documented default constants', () => {
      expect(DEFAULT_BACKOFF_MULTIPLIER).toBe(2);
      expect(DEFAULT_BACKOFF_ATTEMPT_OFFSET).toBe(1);
    });
  });
});

describe('withRetries', () => {
  const noSleep = () => Promise.resolve();

  it('returns the first successful result without retrying', async () => {
    const fn = vi.fn(async () => 'ok');
    const result = await withRetries(fn, {
      maxAttempts: 3,
      baseDelayMs: 10,
      maxDelayMs: 1000,
      sleep: noSleep,
    });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on failure and eventually succeeds', async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls += 1;
      if (calls < 3) throw new Error(`fail ${calls}`);
      return 'recovered';
    });

    const onRetry = vi.fn();
    const result = await withRetries(fn, {
      maxAttempts: 5,
      baseDelayMs: 10,
      maxDelayMs: 1000,
      attemptOffset: 1,
      sleep: noSleep,
      onRetry,
    });

    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
    // Attempt 1 delay: 10 * 2^0 = 10; attempt 2 delay: 10 * 2^1 = 20
    expect(onRetry.mock.calls[0][0]).toMatchObject({ attempt: 1, delayMs: 10 });
    expect(onRetry.mock.calls[1][0]).toMatchObject({ attempt: 2, delayMs: 20 });
  });

  it('passes the 1-based attempt number to fn', async () => {
    const seen: number[] = [];
    await withRetries(
      async (attempt) => {
        seen.push(attempt);
        if (attempt < 3) throw new Error('retry');
        return 'done';
      },
      { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 10, sleep: noSleep }
    );
    expect(seen).toEqual([1, 2, 3]);
  });

  it('throws the last error after exhausting attempts', async () => {
    const fn = vi.fn(async () => {
      throw new Error('always fails');
    });

    await expect(
      withRetries(fn, { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 10, sleep: noSleep })
    ).rejects.toThrow('always fails');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does not retry when shouldRetry returns false', async () => {
    const fn = vi.fn(async () => {
      throw new Error('non-retryable');
    });
    const shouldRetry = vi.fn(() => false);

    await expect(
      withRetries(fn, {
        maxAttempts: 5,
        baseDelayMs: 1,
        maxDelayMs: 10,
        shouldRetry,
        sleep: noSleep,
      })
    ).rejects.toThrow('non-retryable');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(shouldRetry).toHaveBeenCalledTimes(1);
  });

  it('sleeps for the computed backoff delay between attempts', async () => {
    const slept: number[] = [];
    const sleep = vi.fn(async (ms: number) => {
      slept.push(ms);
    });

    await withRetries(
      async (attempt) => {
        if (attempt < 3) throw new Error('retry');
        return 'ok';
      },
      {
        maxAttempts: 3,
        baseDelayMs: 100,
        maxDelayMs: 100000,
        attemptOffset: 1,
        jitterFactor: 0,
        sleep,
      }
    );

    // 100 * 2^0 = 100, then 100 * 2^1 = 200
    expect(slept).toEqual([100, 200]);
  });
});
