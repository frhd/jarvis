/**
 * ProactiveSchedulerService Tests
 *
 * Tests the scheduler's lifecycle, timer management, quiet hours gate,
 * CRUD operations, and state inspection. All dependencies (repository,
 * executor, schedule-utils) are mocked for isolation. Uses vi.useFakeTimers()
 * throughout to make timer behaviour deterministic.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ProactiveJob } from '../../types/index.js';

// ---------------------------------------------------------------------------
// Mocks — must be declared before imports that use them
// ---------------------------------------------------------------------------

vi.mock('../../utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('./schedule-utils.js', () => ({
  calculateNextRunTime: vi.fn(),
  isInQuietHours: vi.fn(() => false),
  getNextNonQuietTime: vi.fn(),
}));

import { calculateNextRunTime, isInQuietHours, getNextNonQuietTime } from './schedule-utils.js';

import {
  ProactiveSchedulerService,
  type IJobRepository,
  type IProactiveExecutor,
  type SchedulerConfig,
} from './scheduler.service.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Flush the microtask queue so async callbacks triggered by timers resolve. */
async function flushPromises(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

function createMockRepository(): IJobRepository {
  return {
    findNextToRun: vi.fn().mockResolvedValue(null),
    findDue: vi.fn().mockResolvedValue([]),
    findById: vi.fn().mockResolvedValue(null),
    findAll: vi.fn().mockResolvedValue([]),
    findEnabled: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockImplementation(async (input) => ({
      id: 'job-1',
      ...input,
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    update: vi.fn().mockImplementation(async (id, updates) => ({
      id,
      ...updates,
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    updateNextRunAt: vi.fn().mockResolvedValue(undefined),
    markExecuted: vi.fn().mockResolvedValue(undefined),
    claimForExecution: vi.fn().mockResolvedValue(true),
    resetStaleRunningJobs: vi.fn().mockResolvedValue(0),
    delete: vi.fn().mockResolvedValue(true),
  };
}

function createMockExecutor(): IProactiveExecutor {
  return {
    executeJob: vi.fn().mockResolvedValue({ status: 'ok' }),
  };
}

const testConfig: SchedulerConfig = {
  enabled: true,
  defaultTimezone: 'Europe/Berlin',
  maxConcurrentJobs: 1,
  stuckJobThresholdMs: 7200000,
  defaultContextMessages: 5,
  quietHoursStart: 22,
  quietHoursEnd: 8,
  respectQuietHours: true,
  targetChatId: 'test-chat-id',
  workerIntervalMs: 60000,
  runHistoryRetentionDays: 30,
};

function createMockJob(overrides: Partial<ProactiveJob> = {}): ProactiveJob {
  return {
    id: 'job-1',
    name: 'Test Job',
    description: null,
    enabled: true,
    scheduleType: 'cron',
    scheduleValue: '0 8 * * *',
    timezone: 'Europe/Berlin',
    targetChatId: null,
    targetSenderId: null,
    messageType: 'greeting',
    messageTemplate: null,
    contextConfig: null,
    deleteAfterRun: false,
    nextRunAt: new Date(Date.now() + 60000), // 1 min from now
    lastRunAt: null,
    lastStatus: null,
    lastError: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('ProactiveSchedulerService', () => {
  let scheduler: ProactiveSchedulerService;
  let repo: IJobRepository;
  let executor: IProactiveExecutor;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    // Reset mocked schedule-utils to sensible defaults
    vi.mocked(calculateNextRunTime).mockReturnValue(new Date(Date.now() + 3600000));
    vi.mocked(isInQuietHours).mockReturnValue(false);
    vi.mocked(getNextNonQuietTime).mockReturnValue(new Date(Date.now() + 36000000));

    repo = createMockRepository();
    executor = createMockExecutor();
    scheduler = new ProactiveSchedulerService(repo, testConfig);
    scheduler.setExecutor(executor);
  });

  afterEach(() => {
    scheduler.stop();
    vi.useRealTimers();
  });

  // =========================================================================
  // Lifecycle
  // =========================================================================

  describe('Lifecycle', () => {
    it('start() sets isRunning=true and calls armTimer (findNextToRun is called)', async () => {
      await scheduler.start();

      expect(scheduler.getState().isRunning).toBe(true);
      expect(repo.findNextToRun).toHaveBeenCalledTimes(1);
    });

    it('start() when already running is a no-op', async () => {
      await scheduler.start();
      expect(repo.findNextToRun).toHaveBeenCalledTimes(1);

      // Call start again
      await scheduler.start();

      // Should NOT have called findNextToRun again
      expect(repo.findNextToRun).toHaveBeenCalledTimes(1);
    });

    it('stop() clears timer and sets isRunning=false', async () => {
      const job = createMockJob({ nextRunAt: new Date(Date.now() + 60000) });
      vi.mocked(repo.findNextToRun).mockResolvedValue(job);

      await scheduler.start();
      expect(scheduler.getState().isRunning).toBe(true);

      scheduler.stop();

      expect(scheduler.getState().isRunning).toBe(false);
      expect(scheduler.getState().nextWakeTime).toBeNull();
    });
  });

  // =========================================================================
  // armTimer
  // =========================================================================

  describe('armTimer (via start)', () => {
    it('arms timer for the next job\'s nextRunAt', async () => {
      const futureDate = new Date(Date.now() + 120000); // 2 min from now
      const job = createMockJob({ nextRunAt: futureDate });
      vi.mocked(repo.findNextToRun).mockResolvedValue(job);

      await scheduler.start();

      const state = scheduler.getState();
      expect(state.nextWakeTime).not.toBeNull();
      // The nextWakeTime should be close to the job's nextRunAt (within timer cap)
      expect(state.nextWakeTime!.getTime()).toBeLessThanOrEqual(futureDate.getTime());
    });

    it('when no jobs exist, timer stays idle (nextWakeTime = null)', async () => {
      vi.mocked(repo.findNextToRun).mockResolvedValue(null);

      await scheduler.start();

      expect(scheduler.getState().nextWakeTime).toBeNull();
    });

    it('when job is already past due, fires immediately (setTimeout with 0)', async () => {
      const pastDueJob = createMockJob({ nextRunAt: new Date(Date.now() - 5000) });
      vi.mocked(repo.findNextToRun).mockResolvedValue(pastDueJob);
      vi.mocked(repo.findDue).mockResolvedValue([pastDueJob]);

      await scheduler.start();

      // The timer was armed with 0 delay. Advance to trigger it.
      await vi.advanceTimersByTimeAsync(0);

      expect(repo.findDue).toHaveBeenCalled();
    });

    it('caps delay at 24h when job is far in the future', async () => {
      const farFuture = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48h from now
      const job = createMockJob({ nextRunAt: farFuture });
      vi.mocked(repo.findNextToRun).mockResolvedValue(job);

      await scheduler.start();

      const state = scheduler.getState();
      // nextWakeTime should be at most ~24h from now, not 48h
      const maxExpected = Date.now() + 24 * 60 * 60 * 1000 + 100; // small tolerance
      expect(state.nextWakeTime).not.toBeNull();
      expect(state.nextWakeTime!.getTime()).toBeLessThanOrEqual(maxExpected);
    });
  });

  // =========================================================================
  // Timer execution
  // =========================================================================

  describe('Timer execution', () => {
    it('timer fires and calls executor.executeJob for due jobs', async () => {
      const dueJob = createMockJob({ nextRunAt: new Date(Date.now() + 10000) });
      vi.mocked(repo.findNextToRun).mockResolvedValue(dueJob);
      vi.mocked(repo.findDue).mockResolvedValue([dueJob]);

      await scheduler.start();

      // Advance timer to fire
      await vi.advanceTimersByTimeAsync(10000);

      expect(executor.executeJob).toHaveBeenCalledWith(dueJob);
    });

    it('after execution, calculates next run and calls markExecuted', async () => {
      const dueJob = createMockJob({ nextRunAt: new Date(Date.now() + 10000) });
      const nextRunDate = new Date(Date.now() + 3600000);
      vi.mocked(repo.findNextToRun).mockResolvedValue(dueJob);
      vi.mocked(repo.findDue).mockResolvedValue([dueJob]);
      vi.mocked(calculateNextRunTime).mockReturnValue(nextRunDate);

      await scheduler.start();
      await vi.advanceTimersByTimeAsync(10000);

      expect(repo.claimForExecution).toHaveBeenCalledWith(dueJob.id);
      expect(calculateNextRunTime).toHaveBeenCalledWith(
        dueJob.scheduleType,
        dueJob.scheduleValue,
        dueJob.timezone,
      );
      expect(repo.markExecuted).toHaveBeenCalledWith(
        dueJob.id,
        'ok',
        nextRunDate,
        undefined,
      );
    });

    it('re-arms timer after execution', async () => {
      const dueJob = createMockJob({ nextRunAt: new Date(Date.now() + 10000) });
      vi.mocked(repo.findNextToRun).mockResolvedValue(dueJob);
      vi.mocked(repo.findDue).mockResolvedValue([dueJob]);

      await scheduler.start();
      // First findNextToRun call during start
      expect(repo.findNextToRun).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(10000);

      // After execution, armTimer is called again, which calls findNextToRun again
      expect(repo.findNextToRun).toHaveBeenCalledTimes(2);
    });

    it('when executor throws, catches error and marks as error status', async () => {
      const dueJob = createMockJob({ nextRunAt: new Date(Date.now() + 10000) });
      vi.mocked(repo.findNextToRun).mockResolvedValue(dueJob);
      vi.mocked(repo.findDue).mockResolvedValue([dueJob]);
      vi.mocked(executor.executeJob).mockRejectedValue(new Error('Execution failed'));

      await scheduler.start();
      await vi.advanceTimersByTimeAsync(10000);

      expect(repo.markExecuted).toHaveBeenCalledWith(
        dueJob.id,
        'error',
        expect.any(Date),
        'Execution failed',
      );
    });
  });

  // =========================================================================
  // Quiet hours
  // =========================================================================

  describe('Quiet hours', () => {
    it('due job during quiet hours is skipped and nextRunAt updated to after quiet ends', async () => {
      const dueJob = createMockJob({ nextRunAt: new Date(Date.now() + 10000) });
      const quietEndTime = new Date(Date.now() + 36000000); // 10h from now

      vi.mocked(repo.findNextToRun).mockResolvedValue(dueJob);
      vi.mocked(repo.findDue).mockResolvedValue([dueJob]);
      vi.mocked(isInQuietHours).mockReturnValue(true);
      vi.mocked(getNextNonQuietTime).mockReturnValue(quietEndTime);

      await scheduler.start();
      await vi.advanceTimersByTimeAsync(10000);

      // Job should NOT have been executed
      expect(executor.executeJob).not.toHaveBeenCalled();

      // nextRunAt should be updated to after quiet hours end
      expect(repo.updateNextRunAt).toHaveBeenCalledWith(dueJob.id, quietEndTime);
    });

    it('due job outside quiet hours executes normally', async () => {
      const dueJob = createMockJob({ nextRunAt: new Date(Date.now() + 10000) });
      vi.mocked(repo.findNextToRun).mockResolvedValue(dueJob);
      vi.mocked(repo.findDue).mockResolvedValue([dueJob]);
      vi.mocked(isInQuietHours).mockReturnValue(false);

      await scheduler.start();
      await vi.advanceTimersByTimeAsync(10000);

      expect(executor.executeJob).toHaveBeenCalledWith(dueJob);
      // updateNextRunAt is called before execution (not for quiet hours reasons)
      expect(repo.updateNextRunAt).toHaveBeenCalledWith(dueJob.id, expect.any(Date));
    });

    it('when respectQuietHours=false, executes even during quiet hours', async () => {
      const noQuietConfig: SchedulerConfig = { ...testConfig, respectQuietHours: false };
      const noQuietScheduler = new ProactiveSchedulerService(repo, noQuietConfig);
      noQuietScheduler.setExecutor(executor);

      const dueJob = createMockJob({ nextRunAt: new Date(Date.now() + 10000) });
      vi.mocked(repo.findNextToRun).mockResolvedValue(dueJob);
      vi.mocked(repo.findDue).mockResolvedValue([dueJob]);
      // Even if isInQuietHours would return true, it should not be checked
      vi.mocked(isInQuietHours).mockReturnValue(true);

      await noQuietScheduler.start();
      await vi.advanceTimersByTimeAsync(10000);

      // Should execute regardless because respectQuietHours is false
      expect(executor.executeJob).toHaveBeenCalledWith(dueJob);

      noQuietScheduler.stop();
    });
  });

  // =========================================================================
  // CRUD operations
  // =========================================================================

  describe('CRUD', () => {
    it('addJob() creates job with calculated nextRunAt and re-arms timer', async () => {
      const nextRun = new Date(Date.now() + 3600000);
      vi.mocked(calculateNextRunTime).mockReturnValue(nextRun);

      await scheduler.start();
      vi.mocked(repo.findNextToRun).mockClear();

      const result = await scheduler.addJob({
        name: 'New Job',
        scheduleType: 'cron',
        scheduleValue: '0 9 * * *',
        messageType: 'greeting',
      });

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'New Job',
          scheduleType: 'cron',
          scheduleValue: '0 9 * * *',
          messageType: 'greeting',
          nextRunAt: nextRun,
        }),
      );
      expect(result).toBeDefined();
      expect(result.id).toBe('job-1');

      // Re-arms timer after adding
      expect(repo.findNextToRun).toHaveBeenCalled();
    });

    it('updateJob() with changed schedule recalculates nextRunAt', async () => {
      const existingJob = createMockJob();
      vi.mocked(repo.findById).mockResolvedValue(existingJob);

      const newNextRun = new Date(Date.now() + 7200000);
      vi.mocked(calculateNextRunTime).mockReturnValue(newNextRun);

      await scheduler.start();
      vi.mocked(repo.findNextToRun).mockClear();

      const result = await scheduler.updateJob('job-1', {
        scheduleValue: '0 10 * * *',
      });

      expect(calculateNextRunTime).toHaveBeenCalledWith(
        existingJob.scheduleType, // unchanged
        '0 10 * * *', // new value
        existingJob.timezone,
      );
      expect(repo.update).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({
          scheduleValue: '0 10 * * *',
          nextRunAt: newNextRun,
        }),
      );

      // Re-arms timer after updating
      expect(repo.findNextToRun).toHaveBeenCalled();
    });

    it('removeJob() deletes and re-arms', async () => {
      await scheduler.start();
      vi.mocked(repo.findNextToRun).mockClear();

      const result = await scheduler.removeJob('job-1');

      expect(repo.delete).toHaveBeenCalledWith('job-1');
      expect(result).toBe(true);

      // Re-arms timer after removing
      expect(repo.findNextToRun).toHaveBeenCalled();
    });

    it('runNow() executes immediately bypassing quiet hours', async () => {
      const job = createMockJob();
      vi.mocked(repo.findById).mockResolvedValue(job);
      // Even in quiet hours, runNow should execute
      vi.mocked(isInQuietHours).mockReturnValue(true);

      await scheduler.runNow('job-1');

      expect(executor.executeJob).toHaveBeenCalledWith(job);
      // markExecuted should be called with the result
      expect(repo.markExecuted).toHaveBeenCalledWith(
        job.id,
        'ok',
        expect.any(Date),
        undefined,
      );
    });

    it('runNow() throws when job not found', async () => {
      vi.mocked(repo.findById).mockResolvedValue(null);

      await expect(scheduler.runNow('nonexistent')).rejects.toThrow('Job not found: nonexistent');
    });

    it('runNow() throws when no executor', async () => {
      const noExecScheduler = new ProactiveSchedulerService(repo, testConfig);
      // Do NOT call setExecutor

      const job = createMockJob();
      vi.mocked(repo.findById).mockResolvedValue(job);

      await expect(noExecScheduler.runNow('job-1')).rejects.toThrow(
        'No executor attached',
      );
    });
  });

  // =========================================================================
  // State
  // =========================================================================

  describe('State', () => {
    it('getState() returns correct running state', async () => {
      // Before start
      expect(scheduler.getState()).toEqual({
        isRunning: false,
        nextWakeTime: null,
        activeJobCount: 0,
        lastTickAt: null,
      });

      const job = createMockJob({ nextRunAt: new Date(Date.now() + 60000) });
      vi.mocked(repo.findNextToRun).mockResolvedValue(job);

      await scheduler.start();

      const state = scheduler.getState();
      expect(state.isRunning).toBe(true);
      expect(state.nextWakeTime).not.toBeNull();

      scheduler.stop();

      expect(scheduler.getState().isRunning).toBe(false);
      expect(scheduler.getState().nextWakeTime).toBeNull();
    });

    it('listJobs() delegates to repository', async () => {
      const jobs = [createMockJob(), createMockJob({ id: 'job-2', name: 'Job 2' })];
      vi.mocked(repo.findAll).mockResolvedValue(jobs);

      const result = await scheduler.listJobs({ enabled: true });

      expect(repo.findAll).toHaveBeenCalledWith({ enabled: true });
      expect(result).toEqual(jobs);
    });
  });

  // =========================================================================
  // Edge cases
  // =========================================================================

  describe('Edge cases', () => {
    it('timer handles no due jobs gracefully and re-arms', async () => {
      // Job exists so timer is armed, but when it fires findDue returns empty
      const job = createMockJob({ nextRunAt: new Date(Date.now() + 10000) });
      vi.mocked(repo.findNextToRun).mockResolvedValue(job);
      vi.mocked(repo.findDue).mockResolvedValue([]);

      await scheduler.start();
      expect(repo.findNextToRun).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(10000);

      // Should NOT have attempted to execute any job
      expect(executor.executeJob).not.toHaveBeenCalled();
      // Should have re-armed (findNextToRun called again)
      expect(repo.findNextToRun).toHaveBeenCalledTimes(2);
    });

    it('executeOrSkip without executor logs error and does not throw', async () => {
      const noExecScheduler = new ProactiveSchedulerService(repo, testConfig);
      // Do NOT set executor

      const dueJob = createMockJob({ nextRunAt: new Date(Date.now() + 10000) });
      vi.mocked(repo.findNextToRun).mockResolvedValue(dueJob);
      vi.mocked(repo.findDue).mockResolvedValue([dueJob]);

      await noExecScheduler.start();
      // Should not throw
      await vi.advanceTimersByTimeAsync(10000);

      // No execution, no markExecuted
      expect(repo.markExecuted).not.toHaveBeenCalled();

      noExecScheduler.stop();
    });

    it('deleteAfterRun=true causes job deletion after successful execution', async () => {
      const dueJob = createMockJob({
        nextRunAt: new Date(Date.now() + 10000),
        deleteAfterRun: true,
      });
      vi.mocked(repo.findNextToRun).mockResolvedValue(dueJob);
      vi.mocked(repo.findDue).mockResolvedValue([dueJob]);
      vi.mocked(executor.executeJob).mockResolvedValue({ status: 'ok' });

      await scheduler.start();
      await vi.advanceTimersByTimeAsync(10000);

      expect(repo.delete).toHaveBeenCalledWith(dueJob.id);
      // markExecuted should NOT be called since we deleted instead
      expect(repo.markExecuted).not.toHaveBeenCalled();
    });

    it('updateJob() returns null for nonexistent job', async () => {
      vi.mocked(repo.findById).mockResolvedValue(null);

      const result = await scheduler.updateJob('nonexistent', { name: 'Updated' });

      expect(result).toBeNull();
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('multiple due jobs are executed sequentially', async () => {
      const job1 = createMockJob({ id: 'job-1', name: 'Job 1', nextRunAt: new Date(Date.now() + 10000) });
      const job2 = createMockJob({ id: 'job-2', name: 'Job 2', nextRunAt: new Date(Date.now() + 10000) });
      vi.mocked(repo.findNextToRun).mockResolvedValue(job1);
      vi.mocked(repo.findDue).mockResolvedValue([job1, job2]);

      const executionOrder: string[] = [];
      vi.mocked(executor.executeJob).mockImplementation(async (job) => {
        executionOrder.push(job.id);
        return { status: 'ok' };
      });

      await scheduler.start();
      await vi.advanceTimersByTimeAsync(10000);

      expect(executionOrder).toEqual(['job-1', 'job-2']);
      expect(repo.markExecuted).toHaveBeenCalledTimes(2);
    });

    it('addJob() does not re-arm when scheduler is not running', async () => {
      // Do NOT start the scheduler
      vi.mocked(calculateNextRunTime).mockReturnValue(new Date(Date.now() + 3600000));

      await scheduler.addJob({
        name: 'Offline Job',
        scheduleType: 'cron',
        scheduleValue: '0 9 * * *',
        messageType: 'greeting',
      });

      expect(repo.create).toHaveBeenCalled();
      // findNextToRun should NOT be called because scheduler is not running
      expect(repo.findNextToRun).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Duplicate execution guards
  // =========================================================================

  describe('Duplicate execution guards', () => {
    it('re-entrancy guard prevents duplicate onTimer() execution', async () => {
      const dueJob = createMockJob({ nextRunAt: new Date(Date.now() + 10000) });
      vi.mocked(repo.findNextToRun).mockResolvedValue(dueJob);
      vi.mocked(repo.findDue).mockResolvedValue([dueJob]);

      // Make executor hang to simulate slow execution
      let resolveExecution: () => void;
      vi.mocked(executor.executeJob).mockImplementation(
        () => new Promise<{ status: 'ok' | 'error' | 'skipped' }>((resolve) => {
          resolveExecution = () => resolve({ status: 'ok' });
        }),
      );

      await scheduler.start();

      // Trigger the timer — execution will hang
      const timerPromise = vi.advanceTimersByTimeAsync(10000);

      // Try to trigger onTimer again while first is still executing
      // Access onTimer via the timer callback — arm another setTimeout(0)
      await vi.advanceTimersByTimeAsync(0);

      // The executor should only have been called once (guard prevents re-entry)
      expect(executor.executeJob).toHaveBeenCalledTimes(1);

      // Resolve the hanging execution
      resolveExecution!();
      await timerPromise;
    });

    it('nextRunAt is updated before executeJob is called', async () => {
      const dueJob = createMockJob({ nextRunAt: new Date(Date.now() + 10000) });
      const nextRunDate = new Date(Date.now() + 3600000);
      vi.mocked(repo.findNextToRun).mockResolvedValue(dueJob);
      vi.mocked(repo.findDue).mockResolvedValue([dueJob]);
      vi.mocked(calculateNextRunTime).mockReturnValue(nextRunDate);

      // Track call order
      const callOrder: string[] = [];
      vi.mocked(repo.updateNextRunAt).mockImplementation(async () => {
        callOrder.push('updateNextRunAt');
      });
      vi.mocked(executor.executeJob).mockImplementation(async () => {
        callOrder.push('executeJob');
        return { status: 'ok' };
      });

      await scheduler.start();
      await vi.advanceTimersByTimeAsync(10000);

      expect(callOrder).toEqual(['updateNextRunAt', 'executeJob']);
    });

    it('claimForExecution prevents concurrent execution of same job', async () => {
      const dueJob = createMockJob({ nextRunAt: new Date(Date.now() + 10000) });
      vi.mocked(repo.findNextToRun).mockResolvedValue(dueJob);
      vi.mocked(repo.findDue).mockResolvedValue([dueJob]);

      // Simulate claim failure (another process already claimed it)
      vi.mocked(repo.claimForExecution).mockResolvedValue(false);

      await scheduler.start();
      await vi.advanceTimersByTimeAsync(10000);

      // Job should NOT be executed because claim failed
      expect(executor.executeJob).not.toHaveBeenCalled();
      expect(repo.markExecuted).not.toHaveBeenCalled();
      expect(repo.updateNextRunAt).not.toHaveBeenCalled();
    });
  });
});
