import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as schema from '../db/schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Mocks MUST be declared before importing modules that use them.
// The repository (and its BaseRepository) import the shared `db` singleton;
// redirect it to a per-test in-memory database via a hoisted holder.
// ---------------------------------------------------------------------------
const dbHolder = vi.hoisted(() => ({ current: null as unknown }));

vi.mock('../db/client', () => ({
  get db() {
    return dbHolder.current;
  },
}));

vi.mock('../utils/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { DeadLetterQueueRepository } from './deadLetterQueue.repository.js';

function createTestDb() {
  const connection = new Database(':memory:');
  connection.pragma('journal_mode = WAL');
  const db = drizzle(connection, { schema });
  migrate(db, { migrationsFolder: join(__dirname, '..', 'db', 'migrations') });
  // The DLQ table has FKs to queue/messages; this test exercises trim logic in
  // isolation, so relax FK enforcement rather than seed unrelated parent rows.
  connection.pragma('foreign_keys = OFF');
  return { db, connection };
}

describe('DeadLetterQueueRepository.trimToMaxEntries', () => {
  let connection: Database.Database;
  let repo: DeadLetterQueueRepository;

  beforeEach(() => {
    const testDb = createTestDb();
    connection = testDb.connection;
    dbHolder.current = testDb.db;
    repo = new DeadLetterQueueRepository();
  });

  afterEach(() => {
    connection.close();
    vi.clearAllMocks();
  });

  /** Add N DLQ items with strictly increasing createdAt so ordering is deterministic. */
  async function seed(count: number): Promise<string[]> {
    const ids: string[] = [];
    const base = new Date('2026-01-01T00:00:00Z').getTime();
    for (let i = 0; i < count; i++) {
      const item = await repo.add({
        originalQueueId: `queue-${i}`,
        messageId: `msg-${i}`,
        reason: 'systematic-failure',
        errorHistory: [{ timestamp: new Date(base + i), error: `err-${i}` } as never],
        // Older items first: item 0 is oldest, item count-1 is newest.
        createdAt: new Date(base + i * 1000),
      });
      ids.push(item.id);
    }
    return ids;
  }

  it('keeps the newest N entries and deletes the oldest beyond the cap', async () => {
    const ids = await seed(5); // ids[0] oldest ... ids[4] newest
    const maxEntries = 2;

    const trimmed = await repo.trimToMaxEntries(maxEntries);

    expect(trimmed).toBe(3);

    const remaining = await repo.getAll({ limit: 100 });
    const remainingIds = remaining.map((r) => r.id).sort();

    // The two newest (ids[4], ids[3]) must survive; the three oldest are gone.
    expect(remainingIds).toEqual([ids[3], ids[4]].sort());
  });

  it('is a no-op when the queue is within the cap', async () => {
    await seed(3);

    const trimmed = await repo.trimToMaxEntries(10);

    expect(trimmed).toBe(0);
    const remaining = await repo.getAll({ limit: 100 });
    expect(remaining).toHaveLength(3);
  });

  it('trims everything when cap is zero', async () => {
    await seed(4);

    const trimmed = await repo.trimToMaxEntries(0);

    expect(trimmed).toBe(4);
    const remaining = await repo.getAll({ limit: 100 });
    expect(remaining).toHaveLength(0);
  });

  it('returns 0 for a negative cap without deleting anything', async () => {
    await seed(2);

    const trimmed = await repo.trimToMaxEntries(-1);

    expect(trimmed).toBe(0);
    const remaining = await repo.getAll({ limit: 100 });
    expect(remaining).toHaveLength(2);
  });
});
