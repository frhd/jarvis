/**
 * Backoff delay utilities.
 *
 * A single shared implementation for retry/backoff delay math, consolidating
 * the several hand-rolled exponential-backoff-with-jitter variants that used to
 * live in individual services.
 *
 * The core function is pure and deterministic given an injected RNG, so it is
 * fully unit-testable. Each call site passes explicit options that reproduce its
 * original tuning exactly (base/cap/multiplier/jitter), rather than relying on
 * hidden defaults, so consolidation does not silently change behavior.
 */

/** Default exponential growth multiplier (each attempt multiplies the delay by this). */
export const DEFAULT_BACKOFF_MULTIPLIER = 2;

/**
 * Default attempt offset. The growth factor uses `(attempt - attemptOffset)`, so
 * with the default offset of 1 a 1-based `attempt` of 1 yields `base * multiplier^0`.
 */
export const DEFAULT_BACKOFF_ATTEMPT_OFFSET = 1;

/** Growth curve applied to the base delay as the attempt number increases. */
export type BackoffGrowth = 'exponential' | 'linear';

/**
 * How jitter is applied to the grown delay:
 * - `'none'`: no jitter (fully deterministic).
 * - `'symmetric'`: delay ± (jitterFactor * basis); random offset in [-1, +1] range.
 * - `'upward'`: delay + [0, jitterFactor * basis); one-sided positive jitter only.
 */
export type JitterMode = 'none' | 'symmetric' | 'upward';

/** What the jitter magnitude is scaled by: the grown delay or the raw base delay. */
export type JitterBasis = 'delay' | 'base';

export interface BackoffOptions {
  /** Base delay in milliseconds before growth and jitter are applied. */
  baseDelayMs: number;
  /** Upper bound (cap) on the returned delay in milliseconds. */
  maxDelayMs: number;
  /** Growth curve. Default `'exponential'`. */
  growth?: BackoffGrowth;
  /** Exponential multiplier (ignored when `growth === 'linear'`). Default {@link DEFAULT_BACKOFF_MULTIPLIER}. */
  multiplier?: number;
  /** Offset applied to `attempt` when computing the growth factor. Default {@link DEFAULT_BACKOFF_ATTEMPT_OFFSET}. */
  attemptOffset?: number;
  /** Jitter magnitude as a fraction of the jitter basis. `0` disables jitter. Default `0`. */
  jitterFactor?: number;
  /** How jitter is applied. Default `'symmetric'`. */
  jitterMode?: JitterMode;
  /** Whether jitter scales with the grown delay or the raw base delay. Default `'delay'`. */
  jitterBasis?: JitterBasis;
  /** Round the result to the nearest integer millisecond. Default `false`. */
  round?: boolean;
  /** Random source returning a value in [0, 1); injectable for deterministic tests. Default `Math.random`. */
  rng?: () => number;
}

/**
 * Compute a single backoff delay in milliseconds for a given attempt.
 *
 * The computation is:
 *   1. Grow the base delay by the attempt number (exponential or linear).
 *   2. Optionally add jitter (symmetric or one-sided upward).
 *   3. Cap at `maxDelayMs` and clamp to be non-negative.
 *   4. Optionally round to an integer.
 *
 * @param attempt - The attempt number. Its interpretation depends on `attemptOffset`.
 * @param options - Backoff configuration (see {@link BackoffOptions}).
 * @returns The delay in milliseconds.
 */
export function computeBackoffDelayMs(attempt: number, options: BackoffOptions): number {
  const {
    baseDelayMs,
    maxDelayMs,
    growth = 'exponential',
    multiplier = DEFAULT_BACKOFF_MULTIPLIER,
    attemptOffset = DEFAULT_BACKOFF_ATTEMPT_OFFSET,
    jitterFactor = 0,
    jitterMode = 'symmetric',
    jitterBasis = 'delay',
    round = false,
    rng = Math.random,
  } = options;

  const growthFactor = attempt - attemptOffset;
  const grownDelay =
    growth === 'linear'
      ? baseDelayMs * growthFactor
      : baseDelayMs * Math.pow(multiplier, growthFactor);

  let delay = grownDelay;

  if (jitterFactor > 0 && jitterMode !== 'none') {
    const basis = jitterBasis === 'base' ? baseDelayMs : grownDelay;
    if (jitterMode === 'symmetric') {
      // Symmetric jitter: ± (jitterFactor * basis)
      delay = grownDelay + (rng() * 2 - 1) * jitterFactor * basis;
    } else {
      // One-sided upward jitter: + [0, jitterFactor * basis)
      delay = grownDelay + rng() * jitterFactor * basis;
    }
  }

  const capped = Math.min(delay, maxDelayMs);
  const nonNegative = Math.max(capped, 0);
  return round ? Math.round(nonNegative) : nonNegative;
}

/** Default sleep implementation used by {@link withRetries}. */
const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export interface WithRetriesOptions extends BackoffOptions {
  /** Maximum number of attempts (inclusive). Must be >= 1. */
  maxAttempts: number;
  /** Decide whether a thrown error is retryable. Defaults to always retrying. */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  /** Invoked immediately before sleeping between attempts. */
  onRetry?: (info: { error: unknown; attempt: number; delayMs: number }) => void;
  /** Sleep implementation; injectable for deterministic tests. Default `setTimeout`-based. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Run an async operation with retries and shared backoff delays.
 *
 * Calls `fn(attempt)` for `attempt` = 1..maxAttempts. On a thrown error, if more
 * attempts remain and `shouldRetry` allows it, sleeps for a computed backoff delay
 * and retries. Otherwise the last error is re-thrown.
 *
 * @param fn - The operation to run; receives the 1-based attempt number.
 * @param options - Retry and backoff configuration (see {@link WithRetriesOptions}).
 * @returns The resolved value of the first successful attempt.
 */
export async function withRetries<T>(
  fn: (attempt: number) => Promise<T>,
  options: WithRetriesOptions
): Promise<T> {
  const { maxAttempts, shouldRetry, onRetry, sleep = defaultSleep, ...backoffOptions } = options;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      const canRetry = attempt < maxAttempts && (shouldRetry?.(error, attempt) ?? true);
      if (!canRetry) break;

      const delayMs = computeBackoffDelayMs(attempt, backoffOptions);
      onRetry?.({ error, attempt, delayMs });
      await sleep(delayMs);
    }
  }
  throw lastError;
}
