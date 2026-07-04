/**
 * Safe callback execution utilities with error handling
 */
import { createLogger } from './logger.js';
import { getErrorMessage } from './error-utils.js';

/**
 * Executes an array of callbacks synchronously, catching and logging any errors
 */
export function executeCallbacks<T>(
  callbacks: Array<(arg: T) => void | Promise<void>>,
  argument: T,
  errorContext: string
): void {
  const logger = createLogger('CallbackExecutor');
  for (const callback of callbacks) {
    try {
      callback(argument);
    } catch (error) {
      logger.error(`Error in ${errorContext}`, {
        error: getErrorMessage(error),
      });
    }
  }
}

/**
 * Executes an array of callbacks asynchronously, catching and logging any errors
 */
export async function executeCallbacksAsync<T>(
  callbacks: Array<(arg: T) => void | Promise<void>>,
  argument: T,
  errorContext: string
): Promise<void> {
  const logger = createLogger('CallbackExecutor');
  for (const callback of callbacks) {
    try {
      await callback(argument);
    } catch (error) {
      logger.error(`Error in ${errorContext}`, {
        error: getErrorMessage(error),
      });
    }
  }
}
