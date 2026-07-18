import { describe, it, expect, vi } from 'vitest';
import { Semaphore } from './semaphore.js';

/** Utility: a promise plus its resolve handle, to control task timing in tests. */
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('Semaphore', () => {
  it('rejects invalid concurrency', () => {
    expect(() => new Semaphore(0)).toThrow();
    expect(() => new Semaphore(-1)).toThrow();
    expect(() => new Semaphore(1.5)).toThrow();
  });

  it('limits the number of concurrently running operations', async () => {
    const maxConcurrency = 2;
    const semaphore = new Semaphore(maxConcurrency);

    let running = 0;
    let maxObserved = 0;
    const gates = [deferred(), deferred(), deferred(), deferred(), deferred()];

    const tasks = gates.map((gate) =>
      semaphore.runExclusive(async () => {
        running++;
        maxObserved = Math.max(maxObserved, running);
        await gate.promise;
        running--;
      })
    );

    // Let the scheduler start as many tasks as permitted.
    await Promise.resolve();
    await Promise.resolve();

    // Only `maxConcurrency` should be running; the rest wait on the semaphore.
    expect(running).toBe(maxConcurrency);
    expect(semaphore.pendingCount).toBe(gates.length - maxConcurrency);

    // Release tasks one at a time; concurrency must never exceed the limit.
    for (const gate of gates) {
      gate.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(running).toBeLessThanOrEqual(maxConcurrency);
    }

    await Promise.all(tasks);
    expect(maxObserved).toBe(maxConcurrency);
    expect(semaphore.availablePermits).toBe(maxConcurrency);
  });

  it('releases the permit even when the operation throws', async () => {
    const semaphore = new Semaphore(1);

    await expect(
      semaphore.runExclusive(async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');

    // Permit must be returned so subsequent work is not starved.
    expect(semaphore.availablePermits).toBe(1);

    const result = await semaphore.runExclusive(async () => 'ok');
    expect(result).toBe('ok');
  });

  it('does not drop waiting work — every queued task eventually runs (FIFO)', async () => {
    const semaphore = new Semaphore(1);
    const order: number[] = [];
    const gate = deferred();

    // First task holds the only permit until we release the gate.
    const first = semaphore.runExclusive(async () => {
      order.push(0);
      await gate.promise;
    });

    // These three must queue behind the first and run in FIFO order.
    const rest = [1, 2, 3].map((n) =>
      semaphore.runExclusive(async () => {
        order.push(n);
      })
    );

    await Promise.resolve();
    expect(order).toEqual([0]);
    expect(semaphore.pendingCount).toBe(3);

    gate.resolve();
    await Promise.all([first, ...rest]);

    expect(order).toEqual([0, 1, 2, 3]);
    expect(semaphore.availablePermits).toBe(1);
  });

  it('acquire/release can be used directly', async () => {
    const semaphore = new Semaphore(1);
    await semaphore.acquire();
    expect(semaphore.availablePermits).toBe(0);

    let secondAcquired = false;
    const second = semaphore.acquire().then(() => {
      secondAcquired = true;
    });

    await Promise.resolve();
    expect(secondAcquired).toBe(false);

    semaphore.release();
    await second;
    expect(secondAcquired).toBe(true);
  });

  it('release without waiters never exceeds max permits', () => {
    const semaphore = new Semaphore(2);
    semaphore.release();
    semaphore.release();
    semaphore.release();
    expect(semaphore.availablePermits).toBe(2);
  });
});
