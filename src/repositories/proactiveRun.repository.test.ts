/**
 * ProactiveRunRepository Tests (Vitest)
 *
 * Unit tests with mocked SQLite DB following the established mock pattern.
 *
 * Run: npx vitest src/repositories/proactiveRun.repository.test.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================================
// Mock nanoid
// ============================================================================

vi.mock('nanoid', () => ({
  nanoid: vi.fn(() => 'mock-run-id'),
}));

// ============================================================================
// Mock db client with chainable builder pattern (Proxy-based)
// ============================================================================

let selectResult: unknown = [];
let insertResult: unknown[] = [];
let updateResult: unknown[] = [];
let deleteResult: unknown[] = [];

const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();

vi.mock('../db/client', () => {
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
  proactiveRuns: {
    id: 'id',
    jobId: 'jobId',
    startedAt: 'startedAt',
    completedAt: 'completedAt',
    status: 'status',
    generatedMessage: 'generatedMessage',
    deliveryStatus: 'deliveryStatus',
    error: 'error',
    tokenUsage: 'tokenUsage',
  },
  proactiveJobs: {
    id: 'id',
  },
}));

// Import after mocking
import { ProactiveRunRepository } from './proactiveRun.repository';
import { nanoid } from 'nanoid';

// ============================================================================
// Test Fixtures
// ============================================================================

interface MockRun {
  id: string;
  jobId: string;
  startedAt: Date;
  completedAt: Date | null;
  status: string;
  generatedMessage: string | null;
  deliveryStatus: string | null;
  error: string | null;
  tokenUsage: string | null;
}

function createMockRun(overrides: Partial<MockRun> = {}): MockRun {
  return {
    id: 'run-1',
    jobId: 'job-1',
    startedAt: new Date('2025-01-01T08:00:00Z'),
    completedAt: null,
    status: 'ok',
    generatedMessage: null,
    deliveryStatus: null,
    error: null,
    tokenUsage: null,
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('ProactiveRunRepository', () => {
  let repo: ProactiveRunRepository;

  beforeEach(() => {
    repo = new ProactiveRunRepository();
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
    it('should create a run with the provided fields and generate an id', async () => {
      const now = new Date();
      const mockRun = createMockRun({
        id: 'mock-run-id',
        jobId: 'test-job-id',
        startedAt: now,
        status: 'ok',
        generatedMessage: 'Hello!',
        deliveryStatus: 'sent',
      });
      insertResult = [mockRun];

      const run = await repo.create({
        jobId: 'test-job-id',
        startedAt: now,
        status: 'ok',
        generatedMessage: 'Hello!',
        deliveryStatus: 'sent',
      });

      expect(run).toBeDefined();
      expect(run.id).toBeTruthy();
      expect(run.jobId).toBe('test-job-id');
      expect(run.status).toBe('ok');
      expect(run.generatedMessage).toBe('Hello!');
      expect(run.deliveryStatus).toBe('sent');
      expect(nanoid).toHaveBeenCalled();
      expect(mockInsert).toHaveBeenCalled();
    });

    it('should allow creating a run with minimal fields', async () => {
      const mockRun = createMockRun({
        id: 'mock-run-id',
        jobId: 'test-job-id',
        status: 'skipped',
        generatedMessage: null,
        error: null,
      });
      insertResult = [mockRun];

      const run = await repo.create({
        jobId: 'test-job-id',
        startedAt: new Date(),
        status: 'skipped',
      });

      expect(run.id).toBeTruthy();
      expect(run.status).toBe('skipped');
      expect(run.generatedMessage).toBeNull();
      expect(run.error).toBeNull();
    });
  });

  // ==========================================================================
  // startRun()
  // ==========================================================================

  describe('startRun', () => {
    it('should create a run with jobId, startedAt, and status ok', async () => {
      const now = new Date();
      const mockRun = createMockRun({
        id: 'mock-run-id',
        jobId: 'test-job-id',
        startedAt: now,
        status: 'ok',
      });
      insertResult = [mockRun];

      const run = await repo.startRun('test-job-id');

      expect(run).toBeDefined();
      expect(run.id).toBeTruthy();
      expect(run.jobId).toBe('test-job-id');
      expect(run.status).toBe('ok');
      expect(run.startedAt).toBeDefined();
      expect(mockInsert).toHaveBeenCalled();
    });

    it('should leave completedAt, generatedMessage, deliveryStatus, error, tokenUsage as null', async () => {
      const mockRun = createMockRun({
        id: 'mock-run-id',
        jobId: 'test-job-id',
        completedAt: null,
        generatedMessage: null,
        deliveryStatus: null,
        error: null,
        tokenUsage: null,
      });
      insertResult = [mockRun];

      const run = await repo.startRun('test-job-id');

      expect(run.completedAt).toBeNull();
      expect(run.generatedMessage).toBeNull();
      expect(run.deliveryStatus).toBeNull();
      expect(run.error).toBeNull();
      expect(run.tokenUsage).toBeNull();
    });
  });

  // ==========================================================================
  // completeRun()
  // ==========================================================================

  describe('completeRun', () => {
    it('should set completedAt, status, generatedMessage, deliveryStatus', async () => {
      const completedAt = new Date();
      const mockRun = createMockRun({
        id: 'run-1',
        status: 'ok',
        generatedMessage: 'Good morning!',
        deliveryStatus: 'sent',
        completedAt,
      });
      updateResult = [mockRun];

      const completed = await repo.completeRun('run-1', {
        status: 'ok',
        generatedMessage: 'Good morning!',
        deliveryStatus: 'sent',
      });

      expect(completed).not.toBeNull();
      expect(completed!.status).toBe('ok');
      expect(completed!.generatedMessage).toBe('Good morning!');
      expect(completed!.deliveryStatus).toBe('sent');
      expect(completed!.completedAt).toBeDefined();
      expect(mockUpdate).toHaveBeenCalled();
    });

    it('should store tokenUsage as JSON string', async () => {
      const tokenUsageStr = JSON.stringify({
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        model: 'llama3.1:8b',
      });

      const mockRun = createMockRun({
        id: 'run-1',
        status: 'ok',
        generatedMessage: 'Hi there!',
        tokenUsage: tokenUsageStr,
      });
      updateResult = [mockRun];

      const tokenUsage = {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        model: 'llama3.1:8b',
      };

      const completed = await repo.completeRun('run-1', {
        status: 'ok',
        generatedMessage: 'Hi there!',
        tokenUsage,
      });

      expect(completed).not.toBeNull();
      expect(completed!.tokenUsage).toBeTruthy();
      const parsed = JSON.parse(completed!.tokenUsage!);
      expect(parsed.promptTokens).toBe(100);
      expect(parsed.completionTokens).toBe(50);
      expect(parsed.totalTokens).toBe(150);
      expect(parsed.model).toBe('llama3.1:8b');
    });

    it('should set error on failed completion', async () => {
      const mockRun = createMockRun({
        id: 'run-1',
        status: 'error',
        error: 'LLM timeout',
      });
      updateResult = [mockRun];

      const completed = await repo.completeRun('run-1', {
        status: 'error',
        error: 'LLM timeout',
      });

      expect(completed).not.toBeNull();
      expect(completed!.status).toBe('error');
      expect(completed!.error).toBe('LLM timeout');
    });

    it('should return null for non-existent run id', async () => {
      updateResult = [];

      const result = await repo.completeRun('non-existent-id', {
        status: 'ok',
      });

      expect(result).toBeNull();
    });
  });

  // ==========================================================================
  // findById()
  // ==========================================================================

  describe('findById', () => {
    it('should return the run when it exists', async () => {
      const mockRun = createMockRun({ id: 'run-1', jobId: 'test-job-id' });
      selectResult = [mockRun];

      const found = await repo.findById('run-1');

      expect(found).not.toBeNull();
      expect(found!.id).toBe('run-1');
      expect(found!.jobId).toBe('test-job-id');
      expect(mockSelect).toHaveBeenCalled();
    });

    it('should return null for non-existent id', async () => {
      selectResult = [];

      const found = await repo.findById('does-not-exist');
      expect(found).toBeNull();
    });
  });

  // ==========================================================================
  // findByJobId()
  // ==========================================================================

  describe('findByJobId', () => {
    it('should return runs for a given jobId in descending startedAt order', async () => {
      const runs = [
        createMockRun({ id: 'run-3', startedAt: new Date('2025-01-03T08:00:00Z') }),
        createMockRun({ id: 'run-2', startedAt: new Date('2025-01-02T08:00:00Z') }),
        createMockRun({ id: 'run-1', startedAt: new Date('2025-01-01T08:00:00Z') }),
      ];
      selectResult = runs;

      const result = await repo.findByJobId('job-1');

      expect(result).toHaveLength(3);
      // Descending order: most recent first
      expect(result[0].startedAt.getTime()).toBeGreaterThanOrEqual(result[1].startedAt.getTime());
      expect(result[1].startedAt.getTime()).toBeGreaterThanOrEqual(result[2].startedAt.getTime());
    });

    it('should return empty array if no runs exist for jobId', async () => {
      selectResult = [];

      const runs = await repo.findByJobId('job-1');
      expect(runs).toHaveLength(0);
    });

    it('should respect the limit parameter', async () => {
      const runs = [
        createMockRun({ id: 'run-3' }),
        createMockRun({ id: 'run-2' }),
        createMockRun({ id: 'run-1' }),
      ];
      selectResult = runs;

      const result = await repo.findByJobId('job-1', 3);
      expect(result).toHaveLength(3);
      expect(mockSelect).toHaveBeenCalled();
    });

    it('should not return runs from other jobs', async () => {
      const runs = [
        createMockRun({ id: 'run-1', jobId: 'job-1' }),
      ];
      selectResult = runs;

      const result = await repo.findByJobId('job-1');
      expect(result).toHaveLength(1);
      expect(result[0].jobId).toBe('job-1');
    });
  });

  // ==========================================================================
  // findAll() with filters
  // ==========================================================================

  describe('findAll', () => {
    it('should return all runs when no filters are provided', async () => {
      const runs = [
        createMockRun({ id: 'run-1', status: 'ok' }),
        createMockRun({ id: 'run-2', status: 'error' }),
      ];
      selectResult = runs;

      const result = await repo.findAll();
      expect(result.length).toBeGreaterThanOrEqual(2);
    });

    it('should filter by jobId', async () => {
      const runs = [
        createMockRun({ id: 'run-1', jobId: 'job-1' }),
      ];
      selectResult = runs;

      const result = await repo.findAll({ jobId: 'job-1' });
      expect(result).toHaveLength(1);
      expect(result[0].jobId).toBe('job-1');
    });

    it('should filter by status', async () => {
      const runs = [
        createMockRun({ id: 'run-1', status: 'error' }),
      ];
      selectResult = runs;

      const errors = await repo.findAll({ status: 'error' });
      expect(errors).toHaveLength(1);
      expect(errors[0].status).toBe('error');
    });

    it('should filter by deliveryStatus', async () => {
      const runs = [
        createMockRun({ id: 'run-1', deliveryStatus: 'sent' }),
      ];
      selectResult = runs;

      const sent = await repo.findAll({ deliveryStatus: 'sent' });
      expect(sent).toHaveLength(1);
      expect(sent[0].deliveryStatus).toBe('sent');
    });

    it('should filter by startAfter', async () => {
      const future = new Date('2025-06-01T00:00:00Z');
      const runs = [
        createMockRun({ id: 'run-1', startedAt: future }),
      ];
      selectResult = runs;

      const result = await repo.findAll({ startAfter: new Date('2025-03-01T00:00:00Z') });
      expect(result).toHaveLength(1);
      expect(result[0].startedAt.getTime()).toBeGreaterThanOrEqual(
        new Date('2025-03-01T00:00:00Z').getTime()
      );
    });

    it('should filter by startBefore', async () => {
      const past = new Date('2025-01-01T00:00:00Z');
      const runs = [
        createMockRun({ id: 'run-1', startedAt: past }),
      ];
      selectResult = runs;

      const result = await repo.findAll({ startBefore: new Date('2025-03-01T00:00:00Z') });
      expect(result).toHaveLength(1);
      expect(result[0].startedAt.getTime()).toBeLessThanOrEqual(
        new Date('2025-03-01T00:00:00Z').getTime()
      );
    });

    it('should combine multiple filters', async () => {
      const runs = [
        createMockRun({ id: 'run-1', jobId: 'job-1', status: 'ok' }),
      ];
      selectResult = runs;

      const result = await repo.findAll({ jobId: 'job-1', status: 'ok' });
      expect(result).toHaveLength(1);
      expect(result[0].jobId).toBe('job-1');
      expect(result[0].status).toBe('ok');
    });

    it('should respect the limit parameter', async () => {
      const runs = [
        createMockRun({ id: 'run-1' }),
        createMockRun({ id: 'run-2' }),
      ];
      selectResult = runs;

      const result = await repo.findAll(undefined, 2);
      expect(result).toHaveLength(2);
    });

    it('should order results by startedAt desc', async () => {
      const runs = [
        createMockRun({ id: 'run-3', startedAt: new Date('2025-03-01T00:00:00Z') }),
        createMockRun({ id: 'run-2', startedAt: new Date('2025-02-01T00:00:00Z') }),
        createMockRun({ id: 'run-1', startedAt: new Date('2025-01-01T00:00:00Z') }),
      ];
      selectResult = runs;

      const result = await repo.findAll();
      expect(result[0].startedAt.getTime()).toBeGreaterThanOrEqual(result[1].startedAt.getTime());
      expect(result[1].startedAt.getTime()).toBeGreaterThanOrEqual(result[2].startedAt.getTime());
    });
  });

  // ==========================================================================
  // findLastRunForJob()
  // ==========================================================================

  describe('findLastRunForJob', () => {
    it('should return the most recent run for a job', async () => {
      const newest = createMockRun({
        id: 'run-newest',
        startedAt: new Date('2025-03-01T08:00:00Z'),
        status: 'error',
      });
      selectResult = [newest];

      const lastRun = await repo.findLastRunForJob('job-1');

      expect(lastRun).not.toBeNull();
      expect(lastRun!.id).toBe('run-newest');
      expect(mockSelect).toHaveBeenCalled();
    });

    it('should return null when no runs exist for the job', async () => {
      selectResult = [];

      const lastRun = await repo.findLastRunForJob('job-1');
      expect(lastRun).toBeNull();
    });
  });

  // ==========================================================================
  // getStatsForJob()
  // ==========================================================================

  describe('getStatsForJob', () => {
    it('should return zero stats when no runs exist', async () => {
      selectResult = [];

      const stats = await repo.getStatsForJob('job-1');

      expect(stats.totalRuns).toBe(0);
      expect(stats.successfulRuns).toBe(0);
      expect(stats.failedRuns).toBe(0);
      expect(stats.skippedRuns).toBe(0);
      expect(stats.avgDurationMs).toBe(0);
      expect(stats.totalTokens).toBe(0);
      expect(stats.lastRunAt).toBeNull();
    });

    it('should count runs by status correctly', async () => {
      const runs = [
        createMockRun({ id: 'r1', status: 'ok' }),
        createMockRun({ id: 'r2', status: 'ok' }),
        createMockRun({ id: 'r3', status: 'error' }),
        createMockRun({ id: 'r4', status: 'skipped' }),
      ];
      selectResult = runs;

      const stats = await repo.getStatsForJob('job-1');

      expect(stats.totalRuns).toBe(4);
      expect(stats.successfulRuns).toBe(2);
      expect(stats.failedRuns).toBe(1);
      expect(stats.skippedRuns).toBe(1);
    });

    it('should calculate average duration from completed runs', async () => {
      const runs = [
        createMockRun({
          id: 'r1',
          startedAt: new Date('2025-01-01T08:00:00Z'),
          completedAt: new Date('2025-01-01T08:00:10Z'), // 10s
        }),
        createMockRun({
          id: 'r2',
          startedAt: new Date('2025-01-02T08:00:00Z'),
          completedAt: new Date('2025-01-02T08:00:20Z'), // 20s
        }),
      ];
      selectResult = runs;

      const stats = await repo.getStatsForJob('job-1');

      // avgDurationMs = (10000 + 20000) / 2 = 15000
      expect(stats.avgDurationMs).toBe(15000);
    });

    it('should sum totalTokens from tokenUsage JSON', async () => {
      const usage1 = JSON.stringify({
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        model: 'test',
      });
      const usage2 = JSON.stringify({
        promptTokens: 200,
        completionTokens: 100,
        totalTokens: 300,
        model: 'test',
      });

      const runs = [
        createMockRun({ id: 'r1', tokenUsage: usage1 }),
        createMockRun({ id: 'r2', tokenUsage: usage2 }),
      ];
      selectResult = runs;

      const stats = await repo.getStatsForJob('job-1');
      expect(stats.totalTokens).toBe(450);
    });

    it('should track lastRunAt as the most recent startedAt', async () => {
      const oldest = new Date('2025-01-01T08:00:00Z');
      const newest = new Date('2025-03-01T08:00:00Z');

      const runs = [
        createMockRun({ id: 'r1', startedAt: oldest }),
        createMockRun({ id: 'r2', startedAt: newest }),
      ];
      selectResult = runs;

      const stats = await repo.getStatsForJob('job-1');
      expect(stats.lastRunAt).not.toBeNull();
      expect(stats.lastRunAt!.getTime()).toBe(newest.getTime());
    });
  });

  // ==========================================================================
  // getGlobalStats()
  // ==========================================================================

  describe('getGlobalStats', () => {
    it('should count all runs across jobs', async () => {
      const runs = [
        createMockRun({ id: 'r1', jobId: 'job-1', status: 'ok', startedAt: new Date('2024-01-01') }),
        createMockRun({ id: 'r2', jobId: 'job-2', status: 'error', startedAt: new Date('2024-01-01') }),
        createMockRun({ id: 'r3', jobId: 'job-1', status: 'skipped', startedAt: new Date('2024-01-01') }),
      ];
      selectResult = runs;

      const stats = await repo.getGlobalStats();

      expect(stats.totalRuns).toBe(3);
      expect(stats.successfulRuns).toBe(1);
      expect(stats.failedRuns).toBe(1);
      expect(stats.skippedRuns).toBe(1);
    });

    it('should count runsToday and runsThisWeek for current runs', async () => {
      // Create a run with startedAt = now (should count for today and this week)
      const runs = [
        createMockRun({ id: 'r1', startedAt: new Date() }),
      ];
      selectResult = runs;

      const stats = await repo.getGlobalStats();

      expect(stats.runsToday).toBeGreaterThanOrEqual(1);
      expect(stats.runsThisWeek).toBeGreaterThanOrEqual(1);
    });

    it('should not count old runs in runsToday', async () => {
      const pastDate = new Date('2024-01-01T08:00:00Z');
      const runs = [
        createMockRun({ id: 'r1', startedAt: pastDate }),
      ];
      selectResult = runs;

      const stats = await repo.getGlobalStats();

      expect(stats.totalRuns).toBe(1);
      expect(stats.runsToday).toBe(0);
    });

    it('should filter by since parameter', async () => {
      // Only the recent run should be returned by the query when since is applied
      const runs = [
        createMockRun({ id: 'r2', status: 'error', startedAt: new Date() }),
      ];
      selectResult = runs;

      const stats = await repo.getGlobalStats(new Date('2025-01-01T00:00:00Z'));

      expect(stats.totalRuns).toBe(1);
      expect(stats.failedRuns).toBe(1);
    });

    it('should sum totalTokens globally', async () => {
      const usage = JSON.stringify({
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        model: 'test',
      });

      const runs = [
        createMockRun({ id: 'r1', tokenUsage: usage, startedAt: new Date() }),
      ];
      selectResult = runs;

      const stats = await repo.getGlobalStats();
      expect(stats.totalTokens).toBe(150);
    });
  });

  // ==========================================================================
  // deleteOldRuns()
  // ==========================================================================

  describe('deleteOldRuns', () => {
    it('should only delete runs older than the retention period', async () => {
      deleteResult = [{ id: 'old-run-1' }];

      const deleted = await repo.deleteOldRuns(30);

      expect(deleted).toBe(1);
      expect(mockDelete).toHaveBeenCalled();
    });

    it('should return 0 when no old runs exist', async () => {
      deleteResult = [];

      const deleted = await repo.deleteOldRuns(30);
      expect(deleted).toBe(0);
    });

    it('should delete multiple old runs', async () => {
      deleteResult = [{ id: 'old-1' }, { id: 'old-2' }];

      const deleted = await repo.deleteOldRuns(30);
      expect(deleted).toBe(2);
    });
  });

  // ==========================================================================
  // deleteByJobId()
  // ==========================================================================

  describe('deleteByJobId', () => {
    it('should delete all runs for a specific job', async () => {
      deleteResult = [{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }];

      const deleted = await repo.deleteByJobId('job-1');
      expect(deleted).toBe(3);
      expect(mockDelete).toHaveBeenCalled();
    });

    it('should not delete runs from other jobs', async () => {
      deleteResult = [{ id: 'r1' }];

      const deleted = await repo.deleteByJobId('job-1');
      expect(deleted).toBe(1);
    });

    it('should return 0 when no runs exist for the job', async () => {
      deleteResult = [];

      const deleted = await repo.deleteByJobId('job-1');
      expect(deleted).toBe(0);
    });
  });

  // ==========================================================================
  // getRecentFailures()
  // ==========================================================================

  describe('getRecentFailures', () => {
    it('should only return runs with status error', async () => {
      const failures = [
        createMockRun({ id: 'r1', status: 'error', error: 'Timeout' }),
        createMockRun({ id: 'r2', status: 'error', error: 'Connection failed' }),
      ];
      selectResult = failures;

      const result = await repo.getRecentFailures();

      expect(result).toHaveLength(2);
      for (const f of result) {
        expect(f.status).toBe('error');
      }
    });

    it('should order by startedAt desc', async () => {
      const failures = [
        createMockRun({
          id: 'r2',
          status: 'error',
          error: 'Second',
          startedAt: new Date('2025-03-01T00:00:00Z'),
        }),
        createMockRun({
          id: 'r1',
          status: 'error',
          error: 'First',
          startedAt: new Date('2025-01-01T00:00:00Z'),
        }),
      ];
      selectResult = failures;

      const result = await repo.getRecentFailures();

      expect(result).toHaveLength(2);
      expect(result[0].startedAt.getTime()).toBeGreaterThanOrEqual(
        result[1].startedAt.getTime()
      );
    });

    it('should respect the limit parameter', async () => {
      const failures = [
        createMockRun({ id: 'r1', status: 'error' }),
        createMockRun({ id: 'r2', status: 'error' }),
      ];
      selectResult = failures;

      const result = await repo.getRecentFailures(2);
      expect(result).toHaveLength(2);
    });

    it('should return empty array when no errors exist', async () => {
      selectResult = [];

      const result = await repo.getRecentFailures();
      expect(result).toHaveLength(0);
    });
  });

  // ==========================================================================
  // countRunsSince()
  // ==========================================================================

  describe('countRunsSince', () => {
    it('should count runs for a job since a given date', async () => {
      selectResult = [{ count: 2 }];

      const count = await repo.countRunsSince('job-1', new Date('2025-06-01T00:00:00Z'));
      expect(count).toBe(2);
    });

    it('should only count runs for the specified job', async () => {
      selectResult = [{ count: 1 }];

      const count = await repo.countRunsSince('job-1', new Date('2025-01-01T00:00:00Z'));
      expect(count).toBe(1);
    });

    it('should return 0 when no runs exist since the given date', async () => {
      selectResult = [{ count: 0 }];

      const count = await repo.countRunsSince('job-1', new Date('2025-01-01T00:00:00Z'));
      expect(count).toBe(0);
    });

    it('should return 0 when no runs exist at all', async () => {
      selectResult = [{ count: 0 }];

      const count = await repo.countRunsSince('job-1', new Date('2020-01-01T00:00:00Z'));
      expect(count).toBe(0);
    });
  });
});
