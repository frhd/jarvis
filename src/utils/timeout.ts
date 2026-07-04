/**
 * Timeout utility for wrapping promises with a timeout.
 * Provides a reusable pattern for non-blocking timeout handling.
 */

/**
 * Wraps a promise with a timeout, rejecting if the timeout fires first.
 * Uses non-blocking pattern - immediately rejects on timeout without waiting for cleanup.
 *
 * @param promise - The promise to wrap
 * @param timeoutMs - Timeout duration in milliseconds
 * @param onTimeout - Optional callback to run when timeout fires (e.g., for cleanup)
 * @returns A promise that resolves with T or rejects with timeout error
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout?: () => void | Promise<void>
): Promise<T> {
  let resolved = false;

  return new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        // Run cleanup callback but don't wait for it
        if (onTimeout) {
          Promise.resolve(onTimeout()).catch(() => {
            // Suppress cleanup errors
          });
        }
        reject(new Error(`Operation timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs);

    promise
      .then((result) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeoutId);
          resolve(result);
        }
      })
      .catch((error) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeoutId);
          reject(error);
        }
      });
  });
}

/**
 * Options for timeout with warning callback.
 */
export interface TimeoutWithWarningOptions {
  /** Total timeout duration in milliseconds */
  timeoutMs: number;
  /** Warning threshold as a fraction of timeout (0-1), or absolute ms if > 1 */
  warningThreshold: number;
  /** Callback when warning threshold is reached */
  onWarning: (elapsedMs: number) => void;
  /** Callback when timeout fires (for cleanup) */
  onTimeout?: () => void | Promise<void>;
}

/**
 * Wraps a promise with timeout and pre-timeout warning.
 * Useful for logging when operations are taking longer than expected.
 *
 * @param promise - The promise to wrap
 * @param options - Timeout configuration options
 * @returns A promise that resolves with T or rejects with timeout error
 */
export async function withTimeoutAndWarning<T>(
  promise: Promise<T>,
  options: TimeoutWithWarningOptions
): Promise<T> {
  const { timeoutMs, warningThreshold, onWarning, onTimeout } = options;
  const startTime = Date.now();

  // Calculate warning threshold in ms
  const warningMs = warningThreshold > 1
    ? warningThreshold
    : timeoutMs * warningThreshold;

  let resolved = false;

  return new Promise<T>((resolve, reject) => {
    const warningId = setTimeout(() => {
      if (!resolved) {
        const elapsed = Date.now() - startTime;
        onWarning(elapsed);
      }
    }, warningMs);

    const timeoutId = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        clearTimeout(warningId);
        // Run cleanup callback but don't wait for it
        if (onTimeout) {
          Promise.resolve(onTimeout()).catch(() => {
            // Suppress cleanup errors
          });
        }
        reject(new Error(`Operation timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs);

    promise
      .then((result) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeoutId);
          clearTimeout(warningId);
          resolve(result);
        }
      })
      .catch((error) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeoutId);
          clearTimeout(warningId);
          reject(error);
        }
      });
  });
}
