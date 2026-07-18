import { logger } from '../../utils/logger';

/**
 * Manages a recurring interval task with start/stop semantics.
 * Reduces duplication of interval management boilerplate.
 */
export class IntervalTask {
  private handle: ReturnType<typeof setInterval> | null = null;
  private readonly intervalMs: number;
  private readonly task: () => Promise<void>;
  private readonly name: string;

  constructor(name: string, intervalMs: number, task: () => Promise<void>) {
    this.name = name;
    this.intervalMs = intervalMs;
    this.task = task;
  }

  start(): void {
    this.stop();
    this.handle = setInterval(async () => {
      await this.task();
    }, this.intervalMs);
    logger.info(`[Telegram] ${this.name} started (every ${this.intervalMs / 1000} seconds)`);
  }

  stop(): void {
    if (this.handle) {
      clearInterval(this.handle);
      this.handle = null;
      logger.debug(`[Telegram] ${this.name} stopped`);
    }
  }

  isRunning(): boolean {
    return this.handle !== null;
  }
}
