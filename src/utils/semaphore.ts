/**
 * A simple counting semaphore that bounds the number of concurrently running
 * operations.
 *
 * When the concurrency limit is reached, additional callers WAIT (in FIFO
 * order) for a permit to become available rather than being rejected. Work is
 * therefore queued, never dropped — which is essential for message pipelines
 * where losing an inbound message is unacceptable.
 */
export class Semaphore {
  private available: number;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly maxConcurrency: number) {
    if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1) {
      throw new Error(
        `Semaphore requires a positive integer concurrency, got: ${maxConcurrency}`
      );
    }
    this.available = maxConcurrency;
  }

  /**
   * Acquire a permit. Resolves immediately if one is available, otherwise
   * waits (FIFO) until another holder releases.
   */
  async acquire(): Promise<void> {
    if (this.available > 0) {
      this.available--;
      return;
    }

    await new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  /**
   * Release a permit. If callers are waiting, the permit is handed directly to
   * the next one (FIFO); otherwise it is returned to the available pool.
   */
  release(): void {
    const nextWaiter = this.waiters.shift();
    if (nextWaiter) {
      // Transfer the permit straight to the waiter without touching the
      // available count — it was never returned to the pool.
      nextWaiter();
      return;
    }

    if (this.available < this.maxConcurrency) {
      this.available++;
    }
  }

  /**
   * Run `fn` while holding a permit, guaranteeing the permit is released even
   * if `fn` throws. This is the safe way to use the semaphore: a thrown error
   * can never leak a permit and starve the pipeline.
   */
  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  /** Permits currently available (for observability/testing). */
  get availablePermits(): number {
    return this.available;
  }

  /** Number of callers currently waiting for a permit (for observability/testing). */
  get pendingCount(): number {
    return this.waiters.length;
  }
}
