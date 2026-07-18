/**
 * RetentionService Tests
 *
 * Behavior-focused tests for the data-retention / cleanup service:
 * - Reading/updating retention policies (+ validation)
 * - runCleanupForEntity: no-policy => nothing deleted; policy => deletes matched
 * - archive-before-delete writes an archive file before deleting
 * - runCleanup orchestration + audit logging
 * - previewCleanup (dry run) counts without deleting
 * - Media cleanup frees disk and tolerates missing files
 * - Storage statistics aggregation
 * - Error paths wrap DB failures in SecurityError
 *
 * Fully mocked: no real SQLite db, no real filesystem, no live services.
 *
 * Run: npx vitest run src/services/retention.service.test.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Mocks (hoisted so factories can reference them)
// ============================================================================

const h = vi.hoisted(() => {
  const state = { dbQueue: [] as unknown[] };
  const db = {
    select: vi.fn(),
    delete: vi.fn(),
    update: vi.fn(),
    insert: vi.fn(),
  };
  const fsPromises = {
    mkdir: vi.fn(),
    writeFile: vi.fn(),
    stat: vi.fn(),
    unlink: vi.fn(),
    readdir: vi.fn(),
  };
  return { state, db, fsPromises };
});

const { state, fsPromises } = h;

vi.mock('../db/client.js', () => {
  const makeThenable = () => {
    const handler: ProxyHandler<Record<string, unknown>> = {
      get(_target, prop) {
        if (prop === 'then') {
          return (
            resolve: (v: unknown) => unknown,
            reject: (e: unknown) => unknown
          ) => {
            const v = h.state.dbQueue.length ? h.state.dbQueue.shift() : [];
            if (v instanceof Error) {
              return Promise.resolve().then(() => reject(v));
            }
            return Promise.resolve(v).then(resolve);
          };
        }
        if (prop === Symbol.toStringTag) return 'Promise';
        return () => new Proxy({}, handler);
      },
    };
    return new Proxy({}, handler);
  };

  h.db.select.mockImplementation(() => makeThenable());
  h.db.delete.mockImplementation(() => makeThenable());
  h.db.update.mockImplementation(() => makeThenable());
  h.db.insert.mockImplementation(() => makeThenable());

  return { db: h.db };
});

vi.mock('../utils/logger.js', () => {
  const l = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { logger: l, createLogger: () => l };
});

vi.mock('nanoid', () => ({ nanoid: vi.fn(() => 'generated-id') }));

vi.mock('fs/promises', () => ({ default: h.fsPromises, ...h.fsPromises }));

// ============================================================================
// Import AFTER mocks
// ============================================================================
import { RetentionService } from './retention.service.js';
import { SecurityError } from '../errors/index.js';

// ============================================================================
// Fixtures
// ============================================================================

type RetentionConfig = {
  messageRetentionDays: number;
  memoryRetentionDays: number;
  mediaRetentionDays: number;
  cacheRetentionDays: number;
  metricsRetentionDays: number;
  auditLogRetentionDays: number;
};

const makeConfig = (overrides: Partial<RetentionConfig> = {}): RetentionConfig => ({
  messageRetentionDays: 90,
  memoryRetentionDays: 180,
  mediaRetentionDays: 30,
  cacheRetentionDays: 7,
  metricsRetentionDays: 30,
  auditLogRetentionDays: 365,
  ...overrides,
});

const auditRepo = { create: vi.fn() };

function newService(config: RetentionConfig = makeConfig()): RetentionService {
  return new RetentionService(config as never, auditRepo as never);
}

// A DB policy row as returned by drizzle select().
const policyRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'p1',
  entityType: 'message',
  retentionDays: 90,
  archiveBeforeDelete: 0,
  requiresUserConsent: 0,
  isActive: 1,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  state.dbQueue = [];
  auditRepo.create.mockResolvedValue({ id: 'audit-1' });
  fsPromises.mkdir.mockResolvedValue(undefined);
  fsPromises.writeFile.mockResolvedValue(undefined);
  fsPromises.unlink.mockResolvedValue(undefined);
  fsPromises.readdir.mockResolvedValue([]);
  fsPromises.stat.mockResolvedValue({ size: 100 });
});

// ============================================================================
// getPolicies / getPolicy
// ============================================================================

describe('RetentionService.getPolicies', () => {
  it('returns only active policies with booleans coerced', async () => {
    state.dbQueue = [
      [
        policyRow({ entityType: 'message', retentionDays: 90, archiveBeforeDelete: 1, requiresUserConsent: 0 }),
        policyRow({ entityType: 'memory', retentionDays: 180, archiveBeforeDelete: 0, requiresUserConsent: 1 }),
      ],
    ];

    const policies = await newService().getPolicies();

    expect(policies).toHaveLength(2);
    expect(policies[0]).toEqual({
      entityType: 'message',
      retentionDays: 90,
      archiveBeforeDelete: true,
      requiresUserConsent: false,
    });
    expect(policies[1].archiveBeforeDelete).toBe(false);
    expect(policies[1].requiresUserConsent).toBe(true);
  });

  it('wraps DB failures in a SecurityError', async () => {
    state.dbQueue = [new Error('db down')];
    await expect(newService().getPolicies()).rejects.toBeInstanceOf(SecurityError);
  });
});

describe('RetentionService.getPolicy', () => {
  it('returns null when no active policy exists for the entity', async () => {
    state.dbQueue = [[]];
    const result = await newService().getPolicy('message');
    expect(result).toBeNull();
  });

  it('returns the mapped policy when found', async () => {
    state.dbQueue = [[policyRow({ entityType: 'cache', retentionDays: 7 })]];
    const result = await newService().getPolicy('cache');
    expect(result).toEqual({
      entityType: 'cache',
      retentionDays: 7,
      archiveBeforeDelete: false,
      requiresUserConsent: false,
    });
  });
});

// ============================================================================
// updatePolicy
// ============================================================================

describe('RetentionService.updatePolicy', () => {
  it('rejects negative retention days without touching the DB', async () => {
    await expect(newService().updatePolicy('message', -1)).rejects.toBeInstanceOf(
      SecurityError
    );
    expect(auditRepo.create).not.toHaveBeenCalled();
    expect(h.db.update).not.toHaveBeenCalled();
    expect(h.db.insert).not.toHaveBeenCalled();
  });

  it('updates an existing policy and audits the config change', async () => {
    // 1) select existing -> found ; 2) update
    state.dbQueue = [[policyRow({ entityType: 'message' })], []];

    await newService().updatePolicy('message', 120, true);

    expect(h.db.update).toHaveBeenCalledTimes(1);
    expect(h.db.insert).not.toHaveBeenCalled();
    expect(auditRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'update_retention_policy',
        details: expect.objectContaining({ entityType: 'message', retentionDays: 120 }),
      })
    );
  });

  it('inserts a new policy when none exists', async () => {
    // 1) select existing -> empty ; 2) insert
    state.dbQueue = [[], []];

    await newService().updatePolicy('metrics', 45);

    expect(h.db.insert).toHaveBeenCalledTimes(1);
    expect(h.db.update).not.toHaveBeenCalled();
    expect(auditRepo.create).toHaveBeenCalled();
  });
});

// ============================================================================
// runCleanupForEntity
// ============================================================================

describe('RetentionService.runCleanupForEntity', () => {
  it('does nothing (no delete) when no policy exists for the entity', async () => {
    state.dbQueue = [[]]; // getPolicy -> none

    const result = await newService().runCleanupForEntity('message');

    expect(result).toEqual({ archived: 0, deleted: 0 });
    expect(h.db.delete).not.toHaveBeenCalled();
  });

  it('deletes records older than the cutoff and reports the count', async () => {
    // 1) getPolicy -> message policy (no archive)
    // 2) select old message ids -> two rows
    // 3) delete
    state.dbQueue = [
      [policyRow({ entityType: 'message', retentionDays: 90, archiveBeforeDelete: 0 })],
      [{ id: 'm1' }, { id: 'm2' }],
      [],
    ];

    const result = await newService().runCleanupForEntity('message');

    expect(result.deleted).toBe(2);
    expect(result.archived).toBe(0);
    expect(h.db.delete).toHaveBeenCalledTimes(1);
    expect(fsPromises.writeFile).not.toHaveBeenCalled(); // no archive written
  });

  it('reports nothing deleted when no old records match', async () => {
    state.dbQueue = [
      [policyRow({ entityType: 'metrics', retentionDays: 30 })],
      [], // no old metrics
    ];

    const result = await newService().runCleanupForEntity('metrics');

    expect(result).toEqual({ archived: 0, deleted: 0 });
    expect(h.db.delete).not.toHaveBeenCalled();
  });

  it('archives records to a file BEFORE deleting when archiveBeforeDelete is set', async () => {
    // 1) getPolicy -> archive enabled
    // 2) select old memory ids -> two rows
    // 3) archiveRecords: select full records
    // 4) delete
    state.dbQueue = [
      [policyRow({ entityType: 'memory', retentionDays: 180, archiveBeforeDelete: 1 })],
      [{ id: 'mem1' }, { id: 'mem2' }],
      [{ id: 'mem1', content: 'a' }, { id: 'mem2', content: 'b' }],
      [],
    ];

    const result = await newService().runCleanupForEntity('memory');

    expect(result.archived).toBe(2);
    expect(result.deleted).toBe(2);
    // archive directory created + archive file written before deletion
    expect(fsPromises.mkdir).toHaveBeenCalled();
    expect(fsPromises.writeFile).toHaveBeenCalledTimes(1);
    const written = JSON.parse(fsPromises.writeFile.mock.calls[0][1] as string);
    expect(written.entityType).toBe('memory');
    expect(written.recordCount).toBe(2);
    expect(h.db.delete).toHaveBeenCalledTimes(1);
  });

  it('skips unknown entity types without deleting', async () => {
    state.dbQueue = [[policyRow({ entityType: 'bogus' as never })]];

    const result = await newService().runCleanupForEntity('bogus');

    expect(result).toEqual({ archived: 0, deleted: 0 });
    expect(h.db.delete).not.toHaveBeenCalled();
  });

  it('wraps DB failures during cleanup in a SecurityError', async () => {
    state.dbQueue = [new Error('policy read failed')];
    await expect(newService().runCleanupForEntity('message')).rejects.toBeInstanceOf(
      SecurityError
    );
  });
});

// ============================================================================
// runCleanup (orchestration)
// ============================================================================

describe('RetentionService.runCleanup', () => {
  it('runs all entity cleanups + media, and writes an audit log', async () => {
    // Each of the 6 entity cleanups calls getPolicy -> none (1 select each),
    // then cleanupMediaFiles does 1 select for old media (none).
    state.dbQueue = [[], [], [], [], [], [], []];

    const result = await newService().runCleanup();

    expect(result).toEqual({
      messages: { archived: 0, deleted: 0 },
      memories: { archived: 0, deleted: 0 },
      media: { deleted: 0, bytesFreed: 0 },
      cache: { archived: 0, deleted: 0 },
      metrics: { archived: 0, deleted: 0 },
      embeddings: { archived: 0, deleted: 0 },
      auditLogs: { archived: 0, deleted: 0 },
    });
    expect(auditRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'retention_cleanup' })
    );
  });

  it('wraps a failure during orchestration in a SecurityError', async () => {
    // First getPolicy (message) fails.
    state.dbQueue = [new Error('boom')];
    await expect(newService().runCleanup()).rejects.toBeInstanceOf(SecurityError);
  });
});

// ============================================================================
// previewCleanup (dry run)
// ============================================================================

describe('RetentionService.previewCleanup', () => {
  it('counts candidates per entity without deleting anything', async () => {
    // 1) getPolicies -> message + memory policies
    // 2) message count
    // 3) memory count
    // 4) previewMediaCleanup count
    state.dbQueue = [
      [
        policyRow({ entityType: 'message', retentionDays: 90 }),
        policyRow({ entityType: 'memory', retentionDays: 180 }),
      ],
      [{ count: 12 }],
      [{ count: 4 }],
      [{ count: 3 }],
    ];

    const preview = await newService().previewCleanup();

    expect(preview.messages).toBe(12);
    expect(preview.memories).toBe(4);
    expect(preview.media).toBe(3);
    // Dry run: no deletes, no archive writes
    expect(h.db.delete).not.toHaveBeenCalled();
    expect(fsPromises.writeFile).not.toHaveBeenCalled();
    expect(fsPromises.unlink).not.toHaveBeenCalled();
  });

  it('wraps DB failures in a SecurityError', async () => {
    state.dbQueue = [new Error('getPolicies failed')];
    await expect(newService().previewCleanup()).rejects.toBeInstanceOf(SecurityError);
  });
});

// ============================================================================
// media cleanup (via runCleanup path is covered; test frees + tolerates gaps)
// ============================================================================

describe('RetentionService media cleanup', () => {
  it('deletes old media files, sums freed bytes, and tolerates missing files', async () => {
    // All 6 entity policies return none (6 selects), then media select returns
    // two media rows. First unlink succeeds (frees 500 bytes); second throws.
    state.dbQueue = [
      [],
      [],
      [],
      [],
      [],
      [],
      [
        { id: 'm1', mediaPath: 'data/media/a.jpg', mediaType: 'photo' },
        { id: 'm2', mediaPath: 'data/media/gone.jpg', mediaType: 'photo' },
      ],
    ];
    fsPromises.stat
      .mockResolvedValueOnce({ size: 500 })
      .mockRejectedValueOnce(new Error('ENOENT'));

    const result = await newService().runCleanup();

    expect(result.media.deleted).toBe(1);
    expect(result.media.bytesFreed).toBe(500);
    expect(fsPromises.unlink).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// getStorageStats
// ============================================================================

describe('RetentionService.getStorageStats', () => {
  it('aggregates per-entity counts, total, oldest date and disk estimate', async () => {
    // 6 count selects, then oldest-message select, then getMediaDiskUsage (readdir)
    const oldest = new Date('2026-01-01T00:00:00Z');
    state.dbQueue = [
      [{ count: 10 }], // messages
      [{ count: 5 }], // memories
      [{ count: 2 }], // cache
      [{ count: 3 }], // metrics
      [{ count: 4 }], // embeddings
      [{ count: 1 }], // audit logs
      [{ createdAt: oldest }], // oldest message
    ];
    fsPromises.readdir.mockResolvedValue([]); // no media files

    const stats = await newService().getStorageStats();

    expect(stats.byEntityType).toEqual({
      messages: 10,
      memories: 5,
      cache: 2,
      metrics: 3,
      embeddings: 4,
      auditLogs: 1,
    });
    expect(stats.totalRecords).toBe(25);
    expect(stats.oldestRecordDate).toEqual(oldest);
    // 25 records * 1024 bytes/record estimate + 0 media
    expect(stats.estimatedDiskUsage).toBe(25 * 1024);
  });

  it('wraps DB failures in a SecurityError', async () => {
    state.dbQueue = [new Error('count failed')];
    await expect(newService().getStorageStats()).rejects.toBeInstanceOf(SecurityError);
  });
});

// ============================================================================
// initializer
// ============================================================================

describe('RetentionService constructor', () => {
  it('constructs with an injected config + audit repo', () => {
    const svc = newService(makeConfig({ mediaRetentionDays: 15 }));
    expect(svc).toBeInstanceOf(RetentionService);
  });
});
