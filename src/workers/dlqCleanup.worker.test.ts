import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mocks MUST be declared before importing the worker.
vi.mock('../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { DLQCleanupWorker } from './dlqCleanup.worker.js';

describe('DLQCleanupWorker', () => {
  let dlqService: {
    purgeOld: ReturnType<typeof vi.fn>;
    trimToMaxSize: ReturnType<typeof vi.fn>;
  };
  let worker: DLQCleanupWorker;

  beforeEach(() => {
    dlqService = {
      purgeOld: vi.fn().mockResolvedValue(0),
      trimToMaxSize: vi.fn().mockResolvedValue(0),
    };
    worker = new DLQCleanupWorker(dlqService as never, 7);
  });

  afterEach(() => {
    worker.stop();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('enforces both age-based purge and size cap on each cleanup pass', async () => {
    vi.useFakeTimers();
    dlqService.purgeOld.mockResolvedValue(2);
    dlqService.trimToMaxSize.mockResolvedValue(5);

    worker.start(1000);
    await vi.advanceTimersByTimeAsync(1000);

    expect(dlqService.purgeOld).toHaveBeenCalledTimes(1);
    expect(dlqService.trimToMaxSize).toHaveBeenCalledTimes(1);
  });

  it('still trims the size cap even when the age-based purge throws', async () => {
    vi.useFakeTimers();
    dlqService.purgeOld.mockRejectedValue(new Error('purge failed'));

    worker.start(1000);
    await vi.advanceTimersByTimeAsync(1000);

    expect(dlqService.trimToMaxSize).toHaveBeenCalledTimes(1);
  });

  it('runManualCleanup returns the combined purged + trimmed count', async () => {
    dlqService.purgeOld.mockResolvedValue(3);
    dlqService.trimToMaxSize.mockResolvedValue(4);

    const total = await worker.runManualCleanup();

    expect(total).toBe(7);
    expect(dlqService.purgeOld).toHaveBeenCalledTimes(1);
    expect(dlqService.trimToMaxSize).toHaveBeenCalledTimes(1);
  });

  it('does not run cleanup after stop', () => {
    vi.useFakeTimers();
    worker.start(1000);
    worker.stop();
    vi.advanceTimersByTime(5000);
    expect(dlqService.purgeOld).not.toHaveBeenCalled();
  });
});
