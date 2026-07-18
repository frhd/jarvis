/**
 * DataPrivacyService Tests
 *
 * Behavior-focused tests for the GDPR-compliant data privacy service:
 * - Data export (Article 20) with configurable inclusion + gating
 * - Data deletion (Article 17) with correct order + selective deletion
 * - Anonymization (PII replacement while preserving structure)
 * - User data summary counting
 * - canDeleteUserData gating
 * - Audit logging on success AND failure
 *
 * Fully mocked: no real SQLite db, no real filesystem, no live services.
 *
 * Run: npx vitest run src/services/dataPrivacy.service.test.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Mocks (MUST be declared before importing the module under test)
// ============================================================================

// A FIFO queue of results the mocked `db` returns, one per awaited chain.
// Every db.select()/delete()/update()/insert() chain consumes exactly one
// entry when awaited. Queue an `Error` instance to force that chain to reject.
const h = vi.hoisted(() => {
  const state = {
    dbQueue: [] as unknown[],
    nanoidCounter: 0,
  };
  const senderRepository = { findByTelegramId: vi.fn() };
  const messageRepository = {};
  const memoryRepository = { findBySenderId: vi.fn(), delete: vi.fn() };
  const userPreferenceRepository = {
    findBySenderId: vi.fn(),
    deleteBySenderId: vi.fn(),
  };
  const embeddingRepository = { deleteBySource: vi.fn(), findBySource: vi.fn() };
  const semanticCacheRepository = { delete: vi.fn() };
  const securityAuditRepository = { create: vi.fn() };
  const fsMock = {
    existsSync: vi.fn(() => true),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    statSync: vi.fn(() => ({ size: 2048 })),
    unlinkSync: vi.fn(),
  };
  return {
    state,
    senderRepository,
    messageRepository,
    memoryRepository,
    userPreferenceRepository,
    embeddingRepository,
    semanticCacheRepository,
    securityAuditRepository,
    fsMock,
  };
});

const {
  state,
  senderRepository,
  memoryRepository,
  userPreferenceRepository,
  embeddingRepository,
  semanticCacheRepository,
  securityAuditRepository,
  fsMock,
} = h;

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
        // Any chained method (from/where/set/values/returning/limit/orderBy...)
        // returns another thenable proxy.
        return () => new Proxy({}, handler);
      },
    };
    return new Proxy({}, handler);
  };

  return {
    db: {
      select: vi.fn(() => makeThenable()),
      selectDistinct: vi.fn(() => makeThenable()),
      delete: vi.fn(() => makeThenable()),
      update: vi.fn(() => makeThenable()),
      insert: vi.fn(() => makeThenable()),
    },
  };
});

vi.mock('../repositories/index.js', () => ({
  senderRepository: h.senderRepository,
  messageRepository: h.messageRepository,
  memoryRepository: h.memoryRepository,
  userPreferenceRepository: h.userPreferenceRepository,
  embeddingRepository: h.embeddingRepository,
  semanticCacheRepository: h.semanticCacheRepository,
  securityAuditRepository: h.securityAuditRepository,
}));

// Logger mock (module exports both `logger` and `createLogger`)
vi.mock('../utils/logger.js', () => {
  const l = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { logger: l, createLogger: () => l };
});

// nanoid mock for predictable ids
vi.mock('nanoid', () => ({
  nanoid: vi.fn(() => `id-${++h.state.nanoidCounter}`),
}));

// Filesystem mock (default import used by the service)
vi.mock('fs', () => ({ default: h.fsMock, ...h.fsMock }));

// ============================================================================
// Import AFTER mocks
// ============================================================================
import { DataPrivacyService } from './dataPrivacy.service.js';
import { SecurityError } from '../errors/index.js';
import type {
  DataExportRequest,
  DataDeletionRequest,
} from '../types/security.types.js';

// ============================================================================
// Fixtures
// ============================================================================

type GdprConfig = {
  enabled: boolean;
  allowDataExport: boolean;
  allowDataDeletion: boolean;
  dataMinimization: boolean;
};

const makeConfig = (overrides: Partial<GdprConfig> = {}): GdprConfig => ({
  enabled: true,
  allowDataExport: true,
  allowDataDeletion: true,
  dataMinimization: false,
  ...overrides,
});

const makeSender = () => ({
  id: 'sender-1',
  telegramId: '123456789',
  firstName: 'Alice',
  lastName: 'Smith',
  username: 'alice',
  phone: '+15551234567',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-02-01T00:00:00Z'),
});

const makeExportRequest = (
  overrides: Partial<DataExportRequest> = {}
): DataExportRequest => ({
  userId: 'user-1',
  telegramId: 123456789n,
  requestedAt: new Date('2026-07-01T00:00:00Z'),
  includeMessages: false,
  includeMemories: false,
  includePreferences: false,
  includeMedia: false,
  format: 'json',
  ...overrides,
});

const makeDeletionRequest = (
  overrides: Partial<DataDeletionRequest> = {}
): DataDeletionRequest => ({
  userId: 'user-1',
  telegramId: 123456789n,
  requestedAt: new Date('2026-07-01T00:00:00Z'),
  deleteMessages: false,
  deleteMemories: false,
  deletePreferences: false,
  deleteMedia: false,
  reason: 'user requested',
  ...overrides,
});

function newService(config: GdprConfig = makeConfig()): DataPrivacyService {
  return new DataPrivacyService(
    config as never,
    securityAuditRepository as never
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  state.dbQueue = [];
  fsMock.existsSync.mockReturnValue(true);
  fsMock.statSync.mockReturnValue({ size: 2048 } as never);
  securityAuditRepository.create.mockResolvedValue({ id: 'audit-1' });
});

// ============================================================================
// exportUserData
// ============================================================================

describe('DataPrivacyService.exportUserData', () => {
  it('refuses export when disabled by config, and logs a failure audit event', async () => {
    const service = newService(makeConfig({ allowDataExport: false }));

    await expect(service.exportUserData(makeExportRequest())).rejects.toBeInstanceOf(
      SecurityError
    );

    // Failure is audited
    expect(securityAuditRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'Data export failed', severity: 'ERROR' })
    );
    // Nothing was written to disk
    expect(fsMock.writeFileSync).not.toHaveBeenCalled();
  });

  it('throws when the user does not exist', async () => {
    senderRepository.findByTelegramId.mockResolvedValue(null);
    const service = newService();

    await expect(service.exportUserData(makeExportRequest())).rejects.toBeInstanceOf(
      SecurityError
    );
    expect(fsMock.writeFileSync).not.toHaveBeenCalled();
  });

  it('exports profile only when no inclusion flags are set', async () => {
    senderRepository.findByTelegramId.mockResolvedValue(makeSender());
    const service = newService();

    const result = await service.exportUserData(makeExportRequest());

    // File written, size reported from statSync
    expect(fsMock.writeFileSync).toHaveBeenCalledTimes(1);
    expect(result.sizeBytes).toBe(2048);
    expect(result.recordCounts).toEqual({
      messages: 0,
      memories: 0,
      preferences: 0,
      mediaFiles: 0,
    });

    // Profile PII is present in the written payload (portability)
    const written = JSON.parse(fsMock.writeFileSync.mock.calls[0][1] as string);
    expect(written.profile.username).toBe('alice');
    expect(written.profile.phone).toBe('+15551234567');

    // Success audit event
    expect(securityAuditRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'DATA_EXPORT', severity: 'INFO' })
    );
  });

  it('includes messages, memories and preferences when requested and counts them', async () => {
    senderRepository.findByTelegramId.mockResolvedValue(makeSender());
    // Only the messages query hits the db here.
    state.dbQueue = [
      [
        { telegramMessageId: 1, text: 'hi', mediaType: null, mediaPath: null, replyToMessageId: null, createdAt: new Date() },
        { telegramMessageId: 2, text: 'there', mediaType: 'photo', mediaPath: '/m/2.jpg', replyToMessageId: null, createdAt: new Date() },
      ],
    ];
    memoryRepository.findBySenderId.mockResolvedValue([
      { id: 'mem1', memoryType: 'fact', content: 'likes tea', confidence: 0.9, accessCount: 1, lastAccessedAt: new Date(), createdAt: new Date(), updatedAt: new Date() },
    ]);
    userPreferenceRepository.findBySenderId.mockResolvedValue([
      { category: 'ui', key: 'lang', value: 'en', confidence: 1, createdAt: new Date(), updatedAt: new Date() },
    ]);

    const service = newService();
    const result = await service.exportUserData(
      makeExportRequest({
        includeMessages: true,
        includeMemories: true,
        includePreferences: true,
        includeMedia: true,
      })
    );

    expect(result.recordCounts).toEqual({
      messages: 2,
      memories: 1,
      preferences: 1,
      mediaFiles: 1, // one message had a mediaPath
    });
  });
});

// ============================================================================
// deleteUserData
// ============================================================================

describe('DataPrivacyService.deleteUserData', () => {
  it('refuses deletion when disabled by config and audits the failure', async () => {
    const service = newService(makeConfig({ allowDataDeletion: false }));

    await expect(service.deleteUserData(makeDeletionRequest())).rejects.toBeInstanceOf(
      SecurityError
    );
    expect(securityAuditRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'Data deletion failed', severity: 'ERROR' })
    );
  });

  it('refuses deletion for an unknown user (via canDeleteUserData gate)', async () => {
    senderRepository.findByTelegramId.mockResolvedValue(null);
    const service = newService();

    await expect(service.deleteUserData(makeDeletionRequest())).rejects.toBeInstanceOf(
      SecurityError
    );
  });

  it('deletes ONLY messages when only deleteMessages is set (preserves memories/prefs)', async () => {
    senderRepository.findByTelegramId.mockResolvedValue(makeSender());
    memoryRepository.findBySenderId.mockResolvedValue([]); // no memory embeddings to remove
    // db calls in order:
    //  1) select user message ids (embeddings block)  -> none
    //  2) select cache entries                         -> none
    //  3) delete messages ... returning()              -> 2 deleted
    state.dbQueue = [[], [], [{}, {}]];

    const service = newService();
    const result = await service.deleteUserData(
      makeDeletionRequest({ deleteMessages: true })
    );

    expect(result.deletedCounts.messages).toBe(2);
    expect(result.deletedCounts.memories).toBe(0);
    expect(result.deletedCounts.preferences).toBe(0);

    // Memories and preferences must NOT be touched
    expect(memoryRepository.delete).not.toHaveBeenCalled();
    expect(userPreferenceRepository.deleteBySenderId).not.toHaveBeenCalled();

    // audit log id propagated
    expect(result.auditLogId).toBe('audit-1');
    expect(securityAuditRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'DATA_DELETION', severity: 'WARNING' })
    );
  });

  it('removes embeddings for the user content that is being deleted', async () => {
    senderRepository.findByTelegramId.mockResolvedValue(makeSender());
    memoryRepository.findBySenderId.mockResolvedValue([{ id: 'mem1' }]);
    embeddingRepository.deleteBySource.mockResolvedValue(true);
    // 1) select user message ids -> one message
    // 2) select cache entries    -> none
    // 3) delete messages         -> 1
    state.dbQueue = [[{ id: 'msg1' }], [], [{}]];

    const service = newService();
    const result = await service.deleteUserData(
      makeDeletionRequest({ deleteMessages: true })
    );

    // one memory embedding + one message embedding
    expect(embeddingRepository.deleteBySource).toHaveBeenCalledWith('memory', 'mem1');
    expect(embeddingRepository.deleteBySource).toHaveBeenCalledWith('message', 'msg1');
    expect(result.deletedCounts.embeddings).toBe(2);
  });

  it('deletes only cache entries that reference the user\'s messages', async () => {
    senderRepository.findByTelegramId.mockResolvedValue(makeSender());
    memoryRepository.findBySenderId.mockResolvedValue([]);
    // With all delete flags false, the embeddings block is skipped entirely.
    // 1) select cache entries       -> one entry referencing msg1
    // 2) select user message ids    -> [msg1] (matches)
    state.dbQueue = [
      [{ id: 'cache1', sourceMessageIds: JSON.stringify(['msg1']) }],
      [{ id: 'msg1' }],
    ];
    semanticCacheRepository.delete.mockResolvedValue(true);

    const service = newService();
    const result = await service.deleteUserData(makeDeletionRequest());

    expect(semanticCacheRepository.delete).toHaveBeenCalledWith('cache1');
    expect(result.deletedCounts.cacheEntries).toBe(1);
    // No message deletion since deleteMessages=false
    expect(result.deletedCounts.messages).toBe(0);
  });

  it('does not delete cache entries that do not reference the user', async () => {
    senderRepository.findByTelegramId.mockResolvedValue(makeSender());
    memoryRepository.findBySenderId.mockResolvedValue([]);
    state.dbQueue = [
      [{ id: 'cacheX', sourceMessageIds: JSON.stringify(['other-msg']) }],
      [{ id: 'msg1' }], // user's messages do not include 'other-msg'
    ];

    const service = newService();
    const result = await service.deleteUserData(makeDeletionRequest());

    expect(semanticCacheRepository.delete).not.toHaveBeenCalled();
    expect(result.deletedCounts.cacheEntries).toBe(0);
  });

  it('deletes memories and preferences when those flags are set', async () => {
    senderRepository.findByTelegramId.mockResolvedValue(makeSender());
    // embeddings block runs (deleteMemories true): userMemories then userMessages select
    memoryRepository.findBySenderId
      .mockResolvedValueOnce([{ id: 'mem1' }]) // embeddings block
      .mockResolvedValueOnce([{ id: 'mem1' }, { id: 'mem2' }]); // memory deletion block
    embeddingRepository.deleteBySource.mockResolvedValue(false);
    memoryRepository.delete.mockResolvedValue(true);
    userPreferenceRepository.deleteBySenderId.mockResolvedValue(3);
    // 1) select user message ids (embeddings block) -> none
    // 2) select cache entries -> none
    state.dbQueue = [[], []];

    const service = newService();
    const result = await service.deleteUserData(
      makeDeletionRequest({ deleteMemories: true, deletePreferences: true })
    );

    expect(memoryRepository.delete).toHaveBeenCalledTimes(2);
    expect(result.deletedCounts.memories).toBe(2);
    expect(result.deletedCounts.preferences).toBe(3);
  });

  it('deletes media files that exist on disk and skips missing ones', async () => {
    senderRepository.findByTelegramId.mockResolvedValue(makeSender());
    memoryRepository.findBySenderId.mockResolvedValue([]);
    // deleteMedia-only => embeddings block is skipped. db calls in order:
    // 1) cache entries -> none
    // 2) media path select -> two media rows
    state.dbQueue = [
      [],
      [{ mediaPath: '/media/a.jpg' }, { mediaPath: '/media/gone.jpg' }],
    ];
    // First file exists, second is already gone
    fsMock.existsSync.mockImplementation(
      (p: string) => p === '/media/a.jpg'
    );

    const service = newService();
    const result = await service.deleteUserData(
      makeDeletionRequest({ deleteMedia: true })
    );

    expect(fsMock.unlinkSync).toHaveBeenCalledTimes(1);
    expect(fsMock.unlinkSync).toHaveBeenCalledWith('/media/a.jpg');
    expect(result.deletedCounts.mediaFiles).toBe(1);
  });
});

// ============================================================================
// canDeleteUserData
// ============================================================================

describe('DataPrivacyService.canDeleteUserData', () => {
  it('disallows when deletion is disabled by config', async () => {
    const service = newService(makeConfig({ allowDataDeletion: false }));
    const res = await service.canDeleteUserData(123n);
    expect(res.allowed).toBe(false);
    expect(res.reason).toMatch(/disabled/i);
  });

  it('disallows when the user does not exist', async () => {
    senderRepository.findByTelegramId.mockResolvedValue(null);
    const service = newService();
    const res = await service.canDeleteUserData(123n);
    expect(res.allowed).toBe(false);
    expect(res.reason).toBe('User not found');
  });

  it('allows deletion for an existing user with deletion enabled', async () => {
    senderRepository.findByTelegramId.mockResolvedValue(makeSender());
    const service = newService();
    const res = await service.canDeleteUserData(123n);
    expect(res.allowed).toBe(true);
  });
});

// ============================================================================
// anonymizeUserData
// ============================================================================

describe('DataPrivacyService.anonymizeUserData', () => {
  it('returns zero and does nothing when the user does not exist', async () => {
    senderRepository.findByTelegramId.mockResolvedValue(null);
    const service = newService();

    const res = await service.anonymizeUserData(999n);

    expect(res.recordsAnonymized).toBe(0);
    expect(securityAuditRepository.create).not.toHaveBeenCalled();
  });

  it('anonymizes the profile and redacts every message (1 profile + N messages)', async () => {
    senderRepository.findByTelegramId.mockResolvedValue(makeSender());
    // db calls in order:
    //  1) update senders profile
    //  2) select user message ids -> two messages
    //  3) update message 1 text
    //  4) update message 2 text
    state.dbQueue = [[], [{ id: 'm1' }, { id: 'm2' }], [], []];

    const service = newService();
    const res = await service.anonymizeUserData(123n);

    expect(res.recordsAnonymized).toBe(3); // 1 sender + 2 messages
    expect(securityAuditRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'User data anonymized' })
    );
  });
});

// ============================================================================
// getUserDataSummary
// ============================================================================

describe('DataPrivacyService.getUserDataSummary', () => {
  it('returns an all-zero summary when the user does not exist', async () => {
    senderRepository.findByTelegramId.mockResolvedValue(null);
    const service = newService();

    const summary = await service.getUserDataSummary(999n);

    expect(summary).toEqual({
      messageCount: 0,
      memoryCount: 0,
      preferenceCount: 0,
      mediaFileCount: 0,
      embeddingCount: 0,
      cacheEntryCount: 0,
      oldestDataDate: null,
      newestDataDate: null,
    });
  });

  it('aggregates counts and converts unix date range to Date objects', async () => {
    senderRepository.findByTelegramId.mockResolvedValue(makeSender());
    memoryRepository.findBySenderId.mockResolvedValue([{ id: 'mem1' }]);
    userPreferenceRepository.findBySenderId.mockResolvedValue([{ key: 'a' }, { key: 'b' }]);
    // findBySource: memory embedding present, message embedding absent
    embeddingRepository.findBySource.mockImplementation(
      async (type: string) => (type === 'memory' ? { id: 'e1' } : null)
    );
    // db call order:
    //  1) message count
    //  2) media count
    //  3) select user message ids (for message-embedding loop)
    //  4) select cache entries
    //  5) date range MIN/MAX
    const oldestSec = 1_700_000_000; // seconds
    const newestSec = 1_710_000_000;
    state.dbQueue = [
      [{ count: 5 }],
      [{ count: 2 }],
      [{ id: 'msg1' }],
      [{ sourceMessageIds: JSON.stringify(['msg1']) }],
      [{ oldest: oldestSec, newest: newestSec }],
    ];

    const service = newService();
    const summary = await service.getUserDataSummary(123n);

    expect(summary.messageCount).toBe(5);
    expect(summary.mediaFileCount).toBe(2);
    expect(summary.memoryCount).toBe(1);
    expect(summary.preferenceCount).toBe(2);
    expect(summary.embeddingCount).toBe(1); // memory embedding only
    expect(summary.cacheEntryCount).toBe(1); // cache entry references msg1
    expect(summary.oldestDataDate).toEqual(new Date(oldestSec * 1000));
    expect(summary.newestDataDate).toEqual(new Date(newestSec * 1000));
  });
});

// ============================================================================
// pending request queues
// ============================================================================

describe('DataPrivacyService pending requests', () => {
  it('returns empty pending export/deletion lists initially', async () => {
    const service = newService();
    expect(await service.getPendingExportRequests()).toEqual([]);
    expect(await service.getPendingDeletionRequests()).toEqual([]);
  });

  it('processPendingRequests is a no-op with nothing queued', async () => {
    const service = newService();
    await expect(service.processPendingRequests()).resolves.toBeUndefined();
  });
});
