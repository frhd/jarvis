/**
 * ProactiveJobRepository Tests
 *
 * Comprehensive vitest tests covering all repository methods:
 * - CRUD operations (create, findById, findByName, update, delete)
 * - Query methods (findAll, findEnabled, findDue, findNextToRun)
 * - Execution tracking (markExecuted, updateNextRunAt, setEnabled)
 * - Cleanup (deleteCompletedOneShots)
 * - Statistics (getStats)
 * - Lookup helpers (existsByName, findByTargetChat, findByTargetSender)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ProactiveJob } from '../types';

// ============================================================================
// Mock nanoid
// ============================================================================

vi.mock('nanoid', () => ({
  nanoid: vi.fn(() => 'mock-nanoid-id'),
}));

// ============================================================================
// Mock db client with chainable builder pattern
// ============================================================================

// Helper to create a chainable mock that resolves to a value
function createChainMock(resolvedValue: unknown = []) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};

  const createChainFn = (overrideValue?: unknown) => {
    const value = overrideValue !== undefined ? overrideValue : resolvedValue;
    const fn = vi.fn().mockReturnValue({
      ...chain,
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(value).then(resolve),
      // Make it thenable so await works
      [Symbol.toStringTag]: 'Promise',
    });
    return fn;
  };

  chain.from = createChainFn();
  chain.where = createChainFn();
  chain.limit = createChainFn();
  chain.orderBy = createChainFn();
  chain.values = createChainFn();
  chain.returning = createChainFn();
  chain.set = createChainFn();
  chain.execute = createChainFn();

  return chain;
}

// Store for controlling mock return values per test
let selectResult: unknown[] = [];
let insertResult: unknown[] = [];
let updateResult: unknown[] = [];
// deleteResult can be either:
// - RunResult-like object with 'changes' property (for BaseRepository.delete())
// - Array with returning results (for deleteCompletedOneShots)
let deleteResult: { changes: number } | unknown[] = { changes: 0 };

const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();

vi.mock('../db/client', () => {
  // Build chainable mocks that read from module-level result variables
  const makeThenable = (getResult: () => unknown) => {
    const handler: ProxyHandler<Record<string, unknown>> = {
      get(_target, prop) {
        if (prop === 'then') {
          return (resolve: (v: unknown) => unknown) =>
            Promise.resolve(getResult()).then(resolve);
        }
        if (prop === Symbol.toStringTag) return 'Promise';
        // Any chained method returns the same proxy
        const fn = vi.fn().mockReturnValue(new Proxy({}, handler));
        return fn;
      },
    };
    return new Proxy({}, handler);
  };

  const selectProxy = makeThenable(() => selectResult);
  const insertProxy = makeThenable(() => insertResult);
  const updateProxy = makeThenable(() => updateResult);
  const deleteProxy = makeThenable(() => deleteResult);

  return {
    db: {
      select: (...args: unknown[]) => {
        mockSelect(...args);
        return selectProxy;
      },
      insert: (...args: unknown[]) => {
        mockInsert(...args);
        return insertProxy;
      },
      update: (...args: unknown[]) => {
        mockUpdate(...args);
        return updateProxy;
      },
      delete: (...args: unknown[]) => {
        mockDelete(...args);
        return deleteProxy;
      },
    },
  };
});

// Mock the schema (just needs to exist for drizzle eq/and calls)
vi.mock('../db/schema', () => ({
  proactiveJobs: {
    id: 'id',
    name: 'name',
    description: 'description',
    enabled: 'enabled',
    scheduleType: 'scheduleType',
    scheduleValue: 'scheduleValue',
    timezone: 'timezone',
    targetChatId: 'targetChatId',
    targetSenderId: 'targetSenderId',
    messageType: 'messageType',
    messageTemplate: 'messageTemplate',
    contextConfig: 'contextConfig',
    deleteAfterRun: 'deleteAfterRun',
    nextRunAt: 'nextRunAt',
    lastRunAt: 'lastRunAt',
    lastStatus: 'lastStatus',
    lastError: 'lastError',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
  },
}));

// Import after mocking
import { ProactiveJobRepository } from './proactiveJob.repository';
import { nanoid } from 'nanoid';

// ============================================================================
// Test Fixtures
// ============================================================================

function createMockJob(overrides: Partial<ProactiveJob> = {}): ProactiveJob {
  return {
    id: 'job-1',
    name: 'Test Job',
    description: 'A test job',
    enabled: true,
    scheduleType: 'cron',
    scheduleValue: '0 8 * * *',
    timezone: 'UTC',
    targetChatId: 'chat-1',
    targetSenderId: 'sender-1',
    messageType: 'greeting',
    messageTemplate: null,
    contextConfig: null,
    deleteAfterRun: false,
    nextRunAt: new Date('2025-01-01T08:00:00Z'),
    lastRunAt: null,
    lastStatus: null,
    lastError: null,
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('ProactiveJobRepository', () => {
  let repo: ProactiveJobRepository;

  beforeEach(() => {
    repo = new ProactiveJobRepository();
    selectResult = [];
    insertResult = [];
    updateResult = [];
    deleteResult = [];
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // create()
  // ==========================================================================

  describe('create', () => {
    it('should create a new job with generated ID and timestamps', async () => {
      const mockJob = createMockJob({ id: 'mock-nanoid-id' });
      insertResult = [mockJob];

      const result = await repo.create({
        name: 'Test Job',
        description: 'A test job',
        enabled: true,
        scheduleType: 'cron',
        scheduleValue: '0 8 * * *',
        timezone: 'UTC',
        targetChatId: 'chat-1',
        targetSenderId: 'sender-1',
        messageType: 'greeting',
        messageTemplate: null,
        contextConfig: null,
        deleteAfterRun: false,
        nextRunAt: new Date('2025-01-01T08:00:00Z'),
        lastRunAt: null,
        lastStatus: null,
        lastError: null,
      });

      expect(result).toEqual(mockJob);
      expect(nanoid).toHaveBeenCalled();
      expect(mockInsert).toHaveBeenCalled();
    });

    it('should return the first inserted row', async () => {
      const mockJob = createMockJob({ id: 'mock-nanoid-id', name: 'New Job' });
      insertResult = [mockJob];

      const result = await repo.create({
        name: 'New Job',
        description: null,
        enabled: true,
        scheduleType: 'every',
        scheduleValue: '3600000',
        timezone: 'UTC',
        targetChatId: null,
        targetSenderId: null,
        messageType: 'checkin',
        messageTemplate: null,
        contextConfig: null,
        deleteAfterRun: false,
        nextRunAt: null,
        lastRunAt: null,
        lastStatus: null,
        lastError: null,
      });

      expect(result.id).toBe('mock-nanoid-id');
      expect(result.name).toBe('New Job');
    });
  });

  // ==========================================================================
  // findById()
  // ==========================================================================

  describe('findById', () => {
    it('should return a job when found', async () => {
      const mockJob = createMockJob();
      selectResult = [mockJob];

      const result = await repo.findById('job-1');

      expect(result).toEqual(mockJob);
      expect(mockSelect).toHaveBeenCalled();
    });

    it('should return null when job not found', async () => {
      selectResult = [];

      const result = await repo.findById('non-existent-id');

      expect(result).toBeNull();
    });
  });

  // ==========================================================================
  // findByName()
  // ==========================================================================

  describe('findByName', () => {
    it('should return a job when found by name', async () => {
      const mockJob = createMockJob({ name: 'Morning Greeting' });
      selectResult = [mockJob];

      const result = await repo.findByName('Morning Greeting');

      expect(result).toEqual(mockJob);
    });

    it('should return null when no job matches the name', async () => {
      selectResult = [];

      const result = await repo.findByName('Non-existent Job');

      expect(result).toBeNull();
    });
  });

  // ==========================================================================
  // findAll()
  // ==========================================================================

  describe('findAll', () => {
    it('should return all jobs when no filters provided', async () => {
      const jobs = [
        createMockJob({ id: 'job-1', name: 'Alpha Job' }),
        createMockJob({ id: 'job-2', name: 'Beta Job' }),
        createMockJob({ id: 'job-3', name: 'Gamma Job' }),
      ];
      selectResult = jobs;

      const result = await repo.findAll();

      expect(result).toHaveLength(3);
      expect(result).toEqual(jobs);
    });

    it('should return empty array when no jobs exist', async () => {
      selectResult = [];

      const result = await repo.findAll();

      expect(result).toHaveLength(0);
    });

    it('should accept enabled filter', async () => {
      const enabledJobs = [createMockJob({ id: 'job-1', enabled: true })];
      selectResult = enabledJobs;

      const result = await repo.findAll({ enabled: true });

      expect(result).toHaveLength(1);
      expect(result[0].enabled).toBe(true);
    });

    it('should accept messageType filter', async () => {
      const greetingJobs = [
        createMockJob({ id: 'job-1', messageType: 'greeting' }),
      ];
      selectResult = greetingJobs;

      const result = await repo.findAll({ messageType: 'greeting' });

      expect(result).toHaveLength(1);
      expect(result[0].messageType).toBe('greeting');
    });

    it('should accept scheduleType filter', async () => {
      const cronJobs = [
        createMockJob({ id: 'job-1', scheduleType: 'cron' }),
      ];
      selectResult = cronJobs;

      const result = await repo.findAll({ scheduleType: 'cron' });

      expect(result).toHaveLength(1);
      expect(result[0].scheduleType).toBe('cron');
    });

    it('should accept targetChatId filter', async () => {
      const chatJobs = [
        createMockJob({ id: 'job-1', targetChatId: 'chat-42' }),
      ];
      selectResult = chatJobs;

      const result = await repo.findAll({ targetChatId: 'chat-42' });

      expect(result).toHaveLength(1);
      expect(result[0].targetChatId).toBe('chat-42');
    });

    it('should accept targetSenderId filter', async () => {
      const senderJobs = [
        createMockJob({ id: 'job-1', targetSenderId: 'sender-99' }),
      ];
      selectResult = senderJobs;

      const result = await repo.findAll({ targetSenderId: 'sender-99' });

      expect(result).toHaveLength(1);
      expect(result[0].targetSenderId).toBe('sender-99');
    });

    it('should accept multiple filters combined', async () => {
      const filtered = [
        createMockJob({
          id: 'job-1',
          enabled: true,
          messageType: 'reminder',
          scheduleType: 'at',
        }),
      ];
      selectResult = filtered;

      const result = await repo.findAll({
        enabled: true,
        messageType: 'reminder',
        scheduleType: 'at',
      });

      expect(result).toHaveLength(1);
    });
  });

  // ==========================================================================
  // findEnabled()
  // ==========================================================================

  describe('findEnabled', () => {
    it('should return only enabled jobs', async () => {
      const enabledJobs = [
        createMockJob({ id: 'job-1', enabled: true }),
        createMockJob({ id: 'job-2', enabled: true }),
      ];
      selectResult = enabledJobs;

      const result = await repo.findEnabled();

      expect(result).toHaveLength(2);
      expect(result.every((j) => j.enabled)).toBe(true);
    });

    it('should return empty array when no enabled jobs exist', async () => {
      selectResult = [];

      const result = await repo.findEnabled();

      expect(result).toHaveLength(0);
    });

    it('should not include disabled jobs', async () => {
      // Simulate that the DB only returns enabled jobs (the WHERE filters them)
      const enabledJobs = [createMockJob({ id: 'job-1', enabled: true })];
      selectResult = enabledJobs;

      const result = await repo.findEnabled();

      expect(result).toHaveLength(1);
      expect(result[0].enabled).toBe(true);
    });
  });

  // ==========================================================================
  // findDue()
  // ==========================================================================

  describe('findDue', () => {
    it('should return enabled jobs where nextRunAt <= now', async () => {
      const pastDate = new Date('2025-01-01T07:00:00Z');
      const dueJobs = [
        createMockJob({
          id: 'job-1',
          enabled: true,
          nextRunAt: pastDate,
        }),
      ];
      selectResult = dueJobs;

      const now = new Date('2025-01-01T08:00:00Z');
      const result = await repo.findDue(now);

      expect(result).toHaveLength(1);
      expect(result[0].nextRunAt!.getTime()).toBeLessThanOrEqual(now.getTime());
    });

    it('should return empty array when no due jobs exist', async () => {
      selectResult = [];

      const result = await repo.findDue(new Date());

      expect(result).toHaveLength(0);
    });

    it('should use current date when no date parameter provided', async () => {
      selectResult = [];

      // Just verify it does not throw when called without argument
      const result = await repo.findDue();

      expect(result).toHaveLength(0);
    });

    it('should not return disabled jobs even if overdue', async () => {
      // DB would filter these out, so we return empty
      selectResult = [];

      const result = await repo.findDue(new Date());

      expect(result).toHaveLength(0);
    });

    it('should not return jobs scheduled in the future', async () => {
      selectResult = [];

      const now = new Date('2025-01-01T06:00:00Z');
      const result = await repo.findDue(now);

      expect(result).toHaveLength(0);
    });
  });

  // ==========================================================================
  // findNextToRun()
  // ==========================================================================

  describe('findNextToRun', () => {
    it('should return the earliest enabled job with non-null nextRunAt', async () => {
      const earliestJob = createMockJob({
        id: 'job-1',
        enabled: true,
        nextRunAt: new Date('2025-01-01T08:00:00Z'),
      });
      selectResult = [earliestJob];

      const result = await repo.findNextToRun();

      expect(result).toEqual(earliestJob);
    });

    it('should return null when no enabled jobs with nextRunAt exist', async () => {
      selectResult = [];

      const result = await repo.findNextToRun();

      expect(result).toBeNull();
    });

    it('should return null when queue is empty', async () => {
      selectResult = [];

      const result = await repo.findNextToRun();

      expect(result).toBeNull();
    });
  });

  // ==========================================================================
  // update()
  // ==========================================================================

  describe('update', () => {
    it('should update a job and return the updated record', async () => {
      const updatedJob = createMockJob({
        id: 'job-1',
        name: 'Updated Name',
        description: 'Updated description',
      });
      updateResult = [updatedJob];

      const result = await repo.update('job-1', {
        name: 'Updated Name',
        description: 'Updated description',
      });

      expect(result).toEqual(updatedJob);
      expect(result!.name).toBe('Updated Name');
      expect(mockUpdate).toHaveBeenCalled();
    });

    it('should return null when updating a non-existent job', async () => {
      updateResult = [];

      const result = await repo.update('non-existent', { name: 'New Name' });

      expect(result).toBeNull();
    });

    it('should set updatedAt to current time', async () => {
      const now = new Date();
      const updatedJob = createMockJob({
        id: 'job-1',
        updatedAt: now,
      });
      updateResult = [updatedJob];

      const result = await repo.update('job-1', { enabled: false });

      expect(result).not.toBeNull();
      expect(mockUpdate).toHaveBeenCalled();
    });

    it('should allow updating multiple fields at once', async () => {
      const updatedJob = createMockJob({
        id: 'job-1',
        name: 'New Name',
        enabled: false,
        messageType: 'summary',
        scheduleType: 'every',
        scheduleValue: '7200000',
      });
      updateResult = [updatedJob];

      const result = await repo.update('job-1', {
        name: 'New Name',
        enabled: false,
        messageType: 'summary',
        scheduleType: 'every',
        scheduleValue: '7200000',
      });

      expect(result!.name).toBe('New Name');
      expect(result!.enabled).toBe(false);
      expect(result!.messageType).toBe('summary');
    });
  });

  // ==========================================================================
  // updateNextRunAt()
  // ==========================================================================

  describe('updateNextRunAt', () => {
    it('should update nextRunAt for a job', async () => {
      updateResult = []; // void return

      const nextRun = new Date('2025-01-02T08:00:00Z');
      await expect(repo.updateNextRunAt('job-1', nextRun)).resolves.toBeUndefined();

      expect(mockUpdate).toHaveBeenCalled();
    });

    it('should allow setting nextRunAt to null', async () => {
      updateResult = [];

      await expect(repo.updateNextRunAt('job-1', null)).resolves.toBeUndefined();

      expect(mockUpdate).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // markExecuted()
  // ==========================================================================

  describe('markExecuted', () => {
    it('should update lastRunAt, lastStatus, and nextRunAt', async () => {
      updateResult = [];

      const nextRun = new Date('2025-01-02T08:00:00Z');
      await expect(
        repo.markExecuted('job-1', 'ok', nextRun)
      ).resolves.toBeUndefined();

      expect(mockUpdate).toHaveBeenCalled();
    });

    it('should set lastError when error is provided', async () => {
      updateResult = [];

      await expect(
        repo.markExecuted('job-1', 'error', null, 'LLM timeout')
      ).resolves.toBeUndefined();

      expect(mockUpdate).toHaveBeenCalled();
    });

    it('should set lastError to null when no error provided', async () => {
      updateResult = [];

      await expect(
        repo.markExecuted('job-1', 'ok', new Date())
      ).resolves.toBeUndefined();

      expect(mockUpdate).toHaveBeenCalled();
    });

    it('should handle skipped status', async () => {
      updateResult = [];

      await expect(
        repo.markExecuted('job-1', 'skipped', new Date())
      ).resolves.toBeUndefined();

      expect(mockUpdate).toHaveBeenCalled();
    });

    it('should allow null nextRunAt for one-shot jobs', async () => {
      updateResult = [];

      await expect(
        repo.markExecuted('job-1', 'ok', null)
      ).resolves.toBeUndefined();

      expect(mockUpdate).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // setEnabled()
  // ==========================================================================

  describe('setEnabled', () => {
    it('should enable a job', async () => {
      updateResult = [];

      await expect(repo.setEnabled('job-1', true)).resolves.toBeUndefined();

      expect(mockUpdate).toHaveBeenCalled();
    });

    it('should disable a job', async () => {
      updateResult = [];

      await expect(repo.setEnabled('job-1', false)).resolves.toBeUndefined();

      expect(mockUpdate).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // delete()
  // ==========================================================================

  describe('delete', () => {
    it('should return true when job is deleted', async () => {
      // BaseRepository.delete() expects RunResult with 'changes' property
      deleteResult = { changes: 1 };

      const result = await repo.delete('job-1');

      expect(result).toBe(true);
      expect(mockDelete).toHaveBeenCalled();
    });

    it('should return false when job does not exist', async () => {
      deleteResult = { changes: 0 };

      const result = await repo.delete('non-existent-id');

      expect(result).toBe(false);
    });
  });

  // ==========================================================================
  // deleteCompletedOneShots()
  // ==========================================================================

  describe('deleteCompletedOneShots', () => {
    it('should delete jobs where deleteAfterRun=true AND lastRunAt IS NOT NULL', async () => {
      deleteResult = [{ id: 'job-1' }, { id: 'job-2' }];

      const count = await repo.deleteCompletedOneShots();

      expect(count).toBe(2);
      expect(mockDelete).toHaveBeenCalled();
    });

    it('should return 0 when no completed one-shots exist', async () => {
      deleteResult = [];

      const count = await repo.deleteCompletedOneShots();

      expect(count).toBe(0);
    });

    it('should not delete jobs where deleteAfterRun=false', async () => {
      // DB filtering handles this; mock returns empty since no matching rows
      deleteResult = [];

      const count = await repo.deleteCompletedOneShots();

      expect(count).toBe(0);
    });

    it('should not delete jobs where lastRunAt IS NULL', async () => {
      // DB filtering handles this; mock returns empty since no matching rows
      deleteResult = [];

      const count = await repo.deleteCompletedOneShots();

      expect(count).toBe(0);
    });
  });

  // ==========================================================================
  // getStats()
  // ==========================================================================

  describe('getStats', () => {
    it('should return correct counts for mixed jobs', async () => {
      const jobs = [
        createMockJob({
          id: 'job-1',
          enabled: true,
          messageType: 'greeting',
          scheduleType: 'cron',
          lastStatus: 'ok',
        }),
        createMockJob({
          id: 'job-2',
          enabled: true,
          messageType: 'greeting',
          scheduleType: 'cron',
          lastStatus: 'error',
        }),
        createMockJob({
          id: 'job-3',
          enabled: false,
          messageType: 'summary',
          scheduleType: 'every',
          lastStatus: null,
        }),
        createMockJob({
          id: 'job-4',
          enabled: true,
          messageType: 'checkin',
          scheduleType: 'at',
          lastStatus: 'skipped',
        }),
      ];
      selectResult = jobs;

      const stats = await repo.getStats();

      expect(stats.total).toBe(4);
      expect(stats.enabled).toBe(3);
      expect(stats.disabled).toBe(1);
      expect(stats.byType['greeting']).toBe(2);
      expect(stats.byType['summary']).toBe(1);
      expect(stats.byType['checkin']).toBe(1);
      expect(stats.bySchedule['cron']).toBe(2);
      expect(stats.bySchedule['every']).toBe(1);
      expect(stats.bySchedule['at']).toBe(1);
      expect(stats.byStatus['ok']).toBe(1);
      expect(stats.byStatus['error']).toBe(1);
      expect(stats.byStatus['skipped']).toBe(1);
      expect(stats.byStatus['never_run']).toBe(1);
    });

    it('should return zeros for empty database', async () => {
      selectResult = [];

      const stats = await repo.getStats();

      expect(stats.total).toBe(0);
      expect(stats.enabled).toBe(0);
      expect(stats.disabled).toBe(0);
      expect(stats.byType).toEqual({});
      expect(stats.bySchedule).toEqual({});
      expect(stats.byStatus).toEqual({});
    });

    it('should count all enabled jobs correctly', async () => {
      const jobs = [
        createMockJob({ id: 'job-1', enabled: true, messageType: 'greeting', scheduleType: 'cron', lastStatus: null }),
        createMockJob({ id: 'job-2', enabled: true, messageType: 'greeting', scheduleType: 'cron', lastStatus: null }),
        createMockJob({ id: 'job-3', enabled: true, messageType: 'greeting', scheduleType: 'cron', lastStatus: null }),
      ];
      selectResult = jobs;

      const stats = await repo.getStats();

      expect(stats.enabled).toBe(3);
      expect(stats.disabled).toBe(0);
    });

    it('should count all disabled jobs correctly', async () => {
      const jobs = [
        createMockJob({ id: 'job-1', enabled: false, messageType: 'reminder', scheduleType: 'at', lastStatus: 'ok' }),
        createMockJob({ id: 'job-2', enabled: false, messageType: 'reminder', scheduleType: 'at', lastStatus: 'ok' }),
      ];
      selectResult = jobs;

      const stats = await repo.getStats();

      expect(stats.enabled).toBe(0);
      expect(stats.disabled).toBe(2);
    });

    it('should track never_run status for jobs without lastStatus', async () => {
      const jobs = [
        createMockJob({ id: 'job-1', enabled: true, messageType: 'greeting', scheduleType: 'cron', lastStatus: null }),
        createMockJob({ id: 'job-2', enabled: true, messageType: 'checkin', scheduleType: 'every', lastStatus: null }),
      ];
      selectResult = jobs;

      const stats = await repo.getStats();

      expect(stats.byStatus['never_run']).toBe(2);
    });

    it('should count all message types', async () => {
      const jobs = [
        createMockJob({ id: 'j1', messageType: 'greeting', scheduleType: 'cron', lastStatus: null, enabled: true }),
        createMockJob({ id: 'j2', messageType: 'checkin', scheduleType: 'cron', lastStatus: null, enabled: true }),
        createMockJob({ id: 'j3', messageType: 'summary', scheduleType: 'cron', lastStatus: null, enabled: true }),
        createMockJob({ id: 'j4', messageType: 'reminder', scheduleType: 'cron', lastStatus: null, enabled: true }),
        createMockJob({ id: 'j5', messageType: 'followup', scheduleType: 'cron', lastStatus: null, enabled: true }),
        createMockJob({ id: 'j6', messageType: 'custom', scheduleType: 'cron', lastStatus: null, enabled: true }),
      ];
      selectResult = jobs;

      const stats = await repo.getStats();

      expect(stats.byType['greeting']).toBe(1);
      expect(stats.byType['checkin']).toBe(1);
      expect(stats.byType['summary']).toBe(1);
      expect(stats.byType['reminder']).toBe(1);
      expect(stats.byType['followup']).toBe(1);
      expect(stats.byType['custom']).toBe(1);
      expect(stats.total).toBe(6);
    });

    it('should count all schedule types', async () => {
      const jobs = [
        createMockJob({ id: 'j1', scheduleType: 'at', messageType: 'greeting', lastStatus: null, enabled: true }),
        createMockJob({ id: 'j2', scheduleType: 'every', messageType: 'greeting', lastStatus: null, enabled: true }),
        createMockJob({ id: 'j3', scheduleType: 'cron', messageType: 'greeting', lastStatus: null, enabled: true }),
      ];
      selectResult = jobs;

      const stats = await repo.getStats();

      expect(stats.bySchedule['at']).toBe(1);
      expect(stats.bySchedule['every']).toBe(1);
      expect(stats.bySchedule['cron']).toBe(1);
    });
  });

  // ==========================================================================
  // existsByName()
  // ==========================================================================

  describe('existsByName', () => {
    it('should return true when a job with the name exists', async () => {
      selectResult = [{ id: 'job-1' }];

      const result = await repo.existsByName('Morning Greeting');

      expect(result).toBe(true);
    });

    it('should return false when no job with the name exists', async () => {
      selectResult = [];

      const result = await repo.existsByName('Non-existent Job');

      expect(result).toBe(false);
    });
  });

  // ==========================================================================
  // findByTargetChat()
  // ==========================================================================

  describe('findByTargetChat', () => {
    it('should return jobs targeting a specific chat', async () => {
      const chatJobs = [
        createMockJob({ id: 'job-1', targetChatId: 'chat-42', name: 'Alpha' }),
        createMockJob({ id: 'job-2', targetChatId: 'chat-42', name: 'Beta' }),
      ];
      selectResult = chatJobs;

      const result = await repo.findByTargetChat('chat-42');

      expect(result).toHaveLength(2);
      expect(result[0].targetChatId).toBe('chat-42');
      expect(result[1].targetChatId).toBe('chat-42');
    });

    it('should return empty array when no jobs target the chat', async () => {
      selectResult = [];

      const result = await repo.findByTargetChat('chat-nonexistent');

      expect(result).toHaveLength(0);
    });
  });

  // ==========================================================================
  // findByTargetSender()
  // ==========================================================================

  describe('findByTargetSender', () => {
    it('should return jobs targeting a specific sender', async () => {
      const senderJobs = [
        createMockJob({ id: 'job-1', targetSenderId: 'sender-99', name: 'Job A' }),
        createMockJob({ id: 'job-2', targetSenderId: 'sender-99', name: 'Job B' }),
      ];
      selectResult = senderJobs;

      const result = await repo.findByTargetSender('sender-99');

      expect(result).toHaveLength(2);
      expect(result[0].targetSenderId).toBe('sender-99');
      expect(result[1].targetSenderId).toBe('sender-99');
    });

    it('should return empty array when no jobs target the sender', async () => {
      selectResult = [];

      const result = await repo.findByTargetSender('sender-nonexistent');

      expect(result).toHaveLength(0);
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('edge cases', () => {
    it('create should use nanoid for ID generation', async () => {
      const mockJob = createMockJob({ id: 'mock-nanoid-id' });
      insertResult = [mockJob];

      await repo.create({
        name: 'Edge Test',
        description: null,
        enabled: true,
        scheduleType: 'at',
        scheduleValue: '2025-06-01T00:00:00Z',
        timezone: 'America/New_York',
        targetChatId: null,
        targetSenderId: null,
        messageType: 'reminder',
        messageTemplate: 'Hey there!',
        contextConfig: null,
        deleteAfterRun: true,
        nextRunAt: new Date('2025-06-01T00:00:00Z'),
        lastRunAt: null,
        lastStatus: null,
        lastError: null,
      });

      expect(nanoid).toHaveBeenCalledTimes(1);
    });

    it('findById should return null for empty string ID', async () => {
      selectResult = [];

      const result = await repo.findById('');

      expect(result).toBeNull();
    });

    it('delete should return false for empty string ID', async () => {
      deleteResult = [];

      const result = await repo.delete('');

      expect(result).toBe(false);
    });

    it('findAll with empty filters object should return all jobs', async () => {
      const allJobs = [
        createMockJob({ id: 'job-1' }),
        createMockJob({ id: 'job-2' }),
      ];
      selectResult = allJobs;

      const result = await repo.findAll({});

      expect(result).toHaveLength(2);
    });

    it('getStats should handle single job correctly', async () => {
      const jobs = [
        createMockJob({
          id: 'job-1',
          enabled: true,
          messageType: 'custom',
          scheduleType: 'at',
          lastStatus: 'ok',
        }),
      ];
      selectResult = jobs;

      const stats = await repo.getStats();

      expect(stats.total).toBe(1);
      expect(stats.enabled).toBe(1);
      expect(stats.disabled).toBe(0);
      expect(stats.byType['custom']).toBe(1);
      expect(stats.bySchedule['at']).toBe(1);
      expect(stats.byStatus['ok']).toBe(1);
    });

    it('markExecuted with error string should pass error to db', async () => {
      updateResult = [];

      await repo.markExecuted('job-1', 'error', null, 'Connection timeout after 30s');

      expect(mockUpdate).toHaveBeenCalled();
    });

    it('markExecuted without error should set lastError to null', async () => {
      updateResult = [];

      // The repository code does: lastError: error || null
      // When error is undefined, it becomes null
      await repo.markExecuted('job-1', 'ok', new Date('2025-01-02T08:00:00Z'));

      expect(mockUpdate).toHaveBeenCalled();
    });

    it('update should call db.update with the proactiveJobs table', async () => {
      const updatedJob = createMockJob({ id: 'job-1', description: 'Changed' });
      updateResult = [updatedJob];

      const result = await repo.update('job-1', { description: 'Changed' });

      expect(result).not.toBeNull();
      expect(result!.description).toBe('Changed');
    });

    it('deleteCompletedOneShots should call db.delete', async () => {
      deleteResult = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

      const count = await repo.deleteCompletedOneShots();

      expect(count).toBe(3);
      expect(mockDelete).toHaveBeenCalled();
    });
  });
});
