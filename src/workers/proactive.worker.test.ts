import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the logger module before importing the worker
vi.mock('../utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { ProactiveWorker } from './proactive.worker.js';

describe('ProactiveWorker', () => {
  let jobRepo: {
    deleteCompletedOneShots: ReturnType<typeof vi.fn>;
  };
  let runRepo: {
    findStuckRuns: ReturnType<typeof vi.fn>;
    completeRun: ReturnType<typeof vi.fn>;
    deleteOldRuns: ReturnType<typeof vi.fn>;
  };
  let config: { stuckJobThresholdMs: number; runHistoryRetentionDays: number };
  let worker: ProactiveWorker;

  beforeEach(() => {
    jobRepo = {
      deleteCompletedOneShots: vi.fn().mockResolvedValue(0),
    };

    runRepo = {
      findStuckRuns: vi.fn().mockResolvedValue([]),
      completeRun: vi.fn().mockResolvedValue(undefined),
      deleteOldRuns: vi.fn().mockResolvedValue(0),
    };

    config = {
      stuckJobThresholdMs: 300000, // 5 minutes
      runHistoryRetentionDays: 30,
    };

    worker = new ProactiveWorker(jobRepo, runRepo, config);
  });

  afterEach(() => {
    worker.stop();
    vi.clearAllMocks();
  });

  describe('start/stop lifecycle', () => {
    it('should start and return a timer', () => {
      vi.useFakeTimers();
      const timer = worker.start(60000);
      expect(timer).toBeDefined();
      vi.useRealTimers();
    });

    it('should stop and clear the timer', () => {
      vi.useFakeTimers();
      worker.start(60000);
      worker.stop();
      // Advancing should not trigger tick
      vi.advanceTimersByTime(120000);
      expect(runRepo.findStuckRuns).not.toHaveBeenCalled();
      vi.useRealTimers();
    });

    it('should not throw when stop is called without start', () => {
      expect(() => worker.stop()).not.toThrow();
    });
  });

  describe('stuck run cleanup', () => {
    it('should find stuck runs and complete them as errors', async () => {
      const stuckRuns = [
        { id: 'run-1', jobId: 'job-1', startedAt: new Date('2024-01-01T00:00:00Z') },
        { id: 'run-2', jobId: 'job-2', startedAt: new Date('2024-01-01T00:05:00Z') },
      ];
      runRepo.findStuckRuns.mockResolvedValue(stuckRuns);

      await worker.tick();

      expect(runRepo.findStuckRuns).toHaveBeenCalledWith(config.stuckJobThresholdMs);
      expect(runRepo.completeRun).toHaveBeenCalledTimes(2);
      expect(runRepo.completeRun).toHaveBeenCalledWith('run-1', expect.objectContaining({
        status: 'error',
        error: expect.stringContaining('Stuck run exceeded threshold'),
      }));
      expect(runRepo.completeRun).toHaveBeenCalledWith('run-2', expect.objectContaining({
        status: 'error',
        error: expect.stringContaining('Stuck run exceeded threshold'),
      }));
    });

    it('should not call completeRun when no stuck runs', async () => {
      runRepo.findStuckRuns.mockResolvedValue([]);

      await worker.tick();

      expect(runRepo.findStuckRuns).toHaveBeenCalledTimes(1);
      expect(runRepo.completeRun).not.toHaveBeenCalled();
    });
  });

  describe('old run cleanup', () => {
    it('should delete old runs using retention days config', async () => {
      runRepo.deleteOldRuns.mockResolvedValue(15);

      await worker.tick();

      expect(runRepo.deleteOldRuns).toHaveBeenCalledWith(config.runHistoryRetentionDays);
    });
  });

  describe('one-shot cleanup', () => {
    it('should delete completed one-shot jobs', async () => {
      jobRepo.deleteCompletedOneShots.mockResolvedValue(5);

      await worker.tick();

      expect(jobRepo.deleteCompletedOneShots).toHaveBeenCalledTimes(1);
    });
  });

  describe('error handling', () => {
    it('should continue cleanup when stuck run detection fails', async () => {
      runRepo.findStuckRuns.mockRejectedValue(new Error('DB error'));

      await worker.tick();

      expect(runRepo.deleteOldRuns).toHaveBeenCalled();
      expect(jobRepo.deleteCompletedOneShots).toHaveBeenCalled();
    });

    it('should continue cleanup when old run deletion fails', async () => {
      runRepo.deleteOldRuns.mockRejectedValue(new Error('DB error'));

      await worker.tick();

      expect(runRepo.findStuckRuns).toHaveBeenCalled();
      expect(jobRepo.deleteCompletedOneShots).toHaveBeenCalled();
    });

    it('should continue cleanup when one-shot deletion fails', async () => {
      jobRepo.deleteCompletedOneShots.mockRejectedValue(new Error('DB error'));

      await worker.tick();

      expect(runRepo.findStuckRuns).toHaveBeenCalled();
      expect(runRepo.deleteOldRuns).toHaveBeenCalled();
    });

    it('should survive all operations failing', async () => {
      runRepo.findStuckRuns.mockRejectedValue(new Error('Error 1'));
      runRepo.deleteOldRuns.mockRejectedValue(new Error('Error 2'));
      jobRepo.deleteCompletedOneShots.mockRejectedValue(new Error('Error 3'));

      await worker.tick();

      // All were attempted
      expect(runRepo.findStuckRuns).toHaveBeenCalled();
      expect(runRepo.deleteOldRuns).toHaveBeenCalled();
      expect(jobRepo.deleteCompletedOneShots).toHaveBeenCalled();
    });
  });

  describe('full cycle via tick()', () => {
    it('should run all operations in a single tick', async () => {
      runRepo.findStuckRuns.mockResolvedValue([
        { id: 'run-1', jobId: 'job-1', startedAt: new Date('2024-01-01') },
      ]);
      runRepo.deleteOldRuns.mockResolvedValue(3);
      jobRepo.deleteCompletedOneShots.mockResolvedValue(1);

      await worker.tick();

      expect(runRepo.completeRun).toHaveBeenCalledWith('run-1', expect.objectContaining({
        status: 'error',
      }));
      expect(runRepo.deleteOldRuns).toHaveBeenCalledWith(30);
      expect(jobRepo.deleteCompletedOneShots).toHaveBeenCalledTimes(1);
    });
  });
});
