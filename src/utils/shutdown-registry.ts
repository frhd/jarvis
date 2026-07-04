/**
 * ShutdownRegistry - Centralized management of graceful shutdown handlers.
 *
 * Provides a clean way to register and execute shutdown handlers in a consistent order
 * with proper error handling for each handler.
 */

import { logger } from './logger.js';

/**
 * Represents a shutdown handler function.
 * Can be synchronous or asynchronous.
 */
export type ShutdownHandler = () => void | Promise<void>;

/**
 * Registered shutdown handler with metadata.
 */
interface RegisteredHandler {
  name: string;
  handler: ShutdownHandler;
  priority: number;
}

/**
 * ShutdownRegistry manages the registration and execution of shutdown handlers.
 * Handlers are executed in priority order (lower number = higher priority).
 */
export class ShutdownRegistry {
  private handlers: RegisteredHandler[] = [];
  private timeoutMs: number;
  private perHandlerTimeoutMs: number;
  private isShuttingDown = false;

  /**
   * Creates a new ShutdownRegistry.
   * @param timeoutMs - Maximum time to wait for shutdown completion (default: 15000ms)
   * @param perHandlerTimeoutMs - Maximum time per handler before skipping (default: 3000ms)
   */
  constructor(timeoutMs: number = 15000, perHandlerTimeoutMs: number = 3000) {
    this.timeoutMs = timeoutMs;
    this.perHandlerTimeoutMs = perHandlerTimeoutMs;
  }

  /**
   * Registers a shutdown handler.
   * @param name - Human-readable name for logging
   * @param handler - The shutdown function to execute
   * @param priority - Execution priority (lower = higher priority, default: 100)
   */
  register(name: string, handler: ShutdownHandler, priority: number = 100): void {
    this.handlers.push({ name, handler, priority });
    // Keep sorted by priority
    this.handlers.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Removes a registered handler by name.
   * @param name - The name of the handler to remove
   */
  unregister(name: string): void {
    this.handlers = this.handlers.filter(h => h.name !== name);
  }

  /**
   * Clears all registered handlers.
   */
  clear(): void {
    this.handlers = [];
  }

  /**
   * Executes all registered shutdown handlers in priority order.
   * Each handler is executed with error handling to ensure all handlers run.
   * @param signal - The signal that triggered shutdown (for logging)
   */
  async shutdownAll(signal: string): Promise<void> {
    if (this.isShuttingDown) {
      logger.warn('[Shutdown] Shutdown already in progress, ignoring additional signal');
      return;
    }

    this.isShuttingDown = true;
    logger.info(`Received ${signal}, shutting down gracefully...`);

    // Set a hard timeout to force exit if shutdown hangs
    const forceExitTimer = setTimeout(() => {
      logger.error(`Shutdown timeout exceeded (${this.timeoutMs}ms), forcing exit`);
      process.exit(1);
    }, this.timeoutMs);

    // Don't let the timer keep the process alive
    forceExitTimer.unref();

    try {
      for (const { name, handler } of this.handlers) {
        try {
          await Promise.race([
            handler(),
            new Promise<never>((_, reject) =>
              setTimeout(
                () => reject(new Error(`Handler '${name}' timed out after ${this.perHandlerTimeoutMs}ms`)),
                this.perHandlerTimeoutMs
              )
            ),
          ]);
          logger.info(`${name} stopped`);
        } catch (error) {
          logger.error(`Error stopping ${name}:`, error instanceof Error ? error.message : error);
          // Continue with other handlers even if one fails or times out
        }
      }

      logger.info('Shutdown complete');
      process.exit(0);
    } catch (error) {
      logger.error('Error during shutdown:', error);
      process.exit(1);
    }
  }

  /**
   * Returns the number of registered handlers.
   */
  get size(): number {
    return this.handlers.length;
  }

  /**
   * Returns the names of all registered handlers in execution order.
   */
  get handlerNames(): string[] {
    return this.handlers.map(h => h.name);
  }
}

/**
 * Default shutdown registry instance.
 * Use this for application-wide shutdown management.
 */
export const shutdownRegistry = new ShutdownRegistry();
