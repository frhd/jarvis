/**
 * Timing utilities for measuring durations and latencies
 */

/**
 * Simple timing class for measuring elapsed time
 */
export class Timing {
  private startTime: number;

  constructor() {
    this.startTime = Date.now();
  }

  /**
   * Returns elapsed time in milliseconds since construction or last reset
   */
  elapsed(): number {
    return Date.now() - this.startTime;
  }

  /**
   * Resets the start time to now
   */
  reset(): void {
    this.startTime = Date.now();
  }
}

/**
 * Executes an async function and returns the result with timing info
 */
export async function withTiming<T>(
  fn: () => Promise<T>
): Promise<{ result: T; durationMs: number }> {
  const timing = new Timing();
  const result = await fn();
  return { result, durationMs: timing.elapsed() };
}

/**
 * Executes a sync function and returns the result with timing info
 */
export function withTimingSync<T>(
  fn: () => T
): { result: T; durationMs: number } {
  const timing = new Timing();
  const result = fn();
  return { result, durationMs: timing.elapsed() };
}
