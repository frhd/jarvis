/**
 * Helper utilities for handling Promise.allSettled results
 */

/**
 * Processed results from Promise.allSettled
 */
export interface SettledResults<T> {
  fulfilled: T[];
  rejected: PromiseRejectedResult[];
}

/**
 * Process Promise.allSettled results into fulfilled/rejected arrays
 */
export function processSettledResults<T>(
  results: PromiseSettledResult<T>[]
): SettledResults<T> {
  const fulfilled: T[] = [];
  const rejected: PromiseRejectedResult[] = [];

  for (const result of results) {
    if (result.status === 'fulfilled') {
      fulfilled.push(result.value);
    } else {
      rejected.push(result);
    }
  }

  return { fulfilled, rejected };
}
