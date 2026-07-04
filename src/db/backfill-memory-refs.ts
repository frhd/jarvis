/**
 * Backfill Memory References
 *
 * Updates `memories` rows to set `userId` and `conversationId` using
 * the ID mapping produced by Phase 4 (`data/backfill-mapping.json`).
 *
 * Usage:
 *   npx tsx src/db/backfill-memory-refs.ts
 *   npx tsx src/db/backfill-memory-refs.ts --dry-run
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { eq, isNotNull } from 'drizzle-orm';
import { db, type DbClient } from './client.js';
import { memories } from './schema.js';
import type { BackfillMapping } from './backfill-unified-identity.js';

// ============================================================================
// Constants
// ============================================================================

const BATCH_SIZE = 100;
const PROGRESS_LOG_INTERVAL = 50;
const DEFAULT_MAPPING_PATH = resolve(process.cwd(), 'data/backfill-mapping.json');

// ============================================================================
// Types
// ============================================================================

export interface MemoryBackfillResult {
  totalMemories: number;
  userIdUpdated: number;
  conversationIdUpdated: number;
  userIdSkipped: number;
  conversationIdSkipped: number;
}

export interface MemoryBackfillDeps {
  database: DbClient;
  mapping: BackfillMapping;
}

// ============================================================================
// Backfill Logic
// ============================================================================

/**
 * Update memories with senderId to set the corresponding userId.
 */
async function backfillUserIds(
  deps: MemoryBackfillDeps,
  dryRun: boolean,
): Promise<{ updated: number; skipped: number }> {
  const { database, mapping } = deps;

  // Find memories with senderId but no userId yet
  const rows = database
    .select({ id: memories.id, senderId: memories.senderId })
    .from(memories)
    .where(isNotNull(memories.senderId))
    .all();

  const needsUpdate = rows.filter((r) => r.senderId !== null);
  console.log(`Found ${needsUpdate.length} memories with senderId to process`);

  let updated = 0;
  let skipped = 0;

  for (let i = 0; i < needsUpdate.length; i += BATCH_SIZE) {
    const batch = needsUpdate.slice(i, i + BATCH_SIZE);

    for (const row of batch) {
      const userId = mapping.senderToUser[row.senderId!];
      if (!userId) {
        console.warn(`  Warning: No user mapping for senderId="${row.senderId}" (memory ${row.id})`);
        skipped++;
        continue;
      }

      if (!dryRun) {
        database
          .update(memories)
          .set({ userId })
          .where(eq(memories.id, row.id))
          .run();
      }
      updated++;
    }

    if ((i + batch.length) % PROGRESS_LOG_INTERVAL === 0 || i + batch.length === needsUpdate.length) {
      console.log(`  Processed ${i + batch.length}/${needsUpdate.length} memories (userId)`);
    }
  }

  return { updated, skipped };
}

/**
 * Update memories with chatId to set the corresponding conversationId.
 */
async function backfillConversationIds(
  deps: MemoryBackfillDeps,
  dryRun: boolean,
): Promise<{ updated: number; skipped: number }> {
  const { database, mapping } = deps;

  // Find memories with chatId but no conversationId yet
  const rows = database
    .select({ id: memories.id, chatId: memories.chatId })
    .from(memories)
    .where(isNotNull(memories.chatId))
    .all();

  const needsUpdate = rows.filter((r) => r.chatId !== null);
  console.log(`Found ${needsUpdate.length} memories with chatId to process`);

  let updated = 0;
  let skipped = 0;

  for (let i = 0; i < needsUpdate.length; i += BATCH_SIZE) {
    const batch = needsUpdate.slice(i, i + BATCH_SIZE);

    for (const row of batch) {
      const conversationId = mapping.chatToConversation[row.chatId!];
      if (!conversationId) {
        console.warn(`  Warning: No conversation mapping for chatId="${row.chatId}" (memory ${row.id})`);
        skipped++;
        continue;
      }

      if (!dryRun) {
        database
          .update(memories)
          .set({ conversationId })
          .where(eq(memories.id, row.id))
          .run();
      }
      updated++;
    }

    if ((i + batch.length) % PROGRESS_LOG_INTERVAL === 0 || i + batch.length === needsUpdate.length) {
      console.log(`  Processed ${i + batch.length}/${needsUpdate.length} memories (conversationId)`);
    }
  }

  return { updated, skipped };
}

/**
 * Run the full memory refs backfill.
 */
export async function runMemoryBackfill(
  deps: MemoryBackfillDeps,
  options: { dryRun?: boolean } = {},
): Promise<MemoryBackfillResult> {
  const dryRun = options.dryRun ?? false;

  console.log(`Starting memory refs backfill${dryRun ? ' (DRY RUN)' : ''}...`);

  // Count total memories
  const allMemories = deps.database.select({ id: memories.id }).from(memories).all();
  const totalMemories = allMemories.length;
  console.log(`Total memories in database: ${totalMemories}`);

  const userResult = await backfillUserIds(deps, dryRun);
  const convResult = await backfillConversationIds(deps, dryRun);

  const result: MemoryBackfillResult = {
    totalMemories,
    userIdUpdated: userResult.updated,
    conversationIdUpdated: convResult.updated,
    userIdSkipped: userResult.skipped,
    conversationIdSkipped: convResult.skipped,
  };

  console.log('\nBackfill summary:');
  console.log(`  Total memories: ${result.totalMemories}`);
  console.log(`  userId updated: ${result.userIdUpdated}, skipped: ${result.userIdSkipped}`);
  console.log(`  conversationId updated: ${result.conversationIdUpdated}, skipped: ${result.conversationIdSkipped}`);

  return result;
}

// ============================================================================
// CLI Entry Point
// ============================================================================

function loadMapping(mappingPath: string): BackfillMapping {
  if (!existsSync(mappingPath)) {
    throw new Error(
      `Mapping file not found: ${mappingPath}\n` +
      'Run Phase 4 backfill first: npm run db:backfill:identity',
    );
  }
  const raw = readFileSync(mappingPath, 'utf-8');
  return JSON.parse(raw) as BackfillMapping;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const mappingPath = DEFAULT_MAPPING_PATH;

  const mapping = loadMapping(mappingPath);
  console.log(`Loaded mapping: ${Object.keys(mapping.senderToUser).length} senders, ${Object.keys(mapping.chatToConversation).length} chats`);

  await runMemoryBackfill({ database: db, mapping }, { dryRun });
}

// Only run when executed directly (not imported)
const isDirectExecution = process.argv[1]?.endsWith('backfill-memory-refs.ts')
  || process.argv[1]?.endsWith('backfill-memory-refs.js');

if (isDirectExecution) {
  main().catch((err) => {
    console.error('Memory refs backfill failed:', err);
    process.exit(1);
  });
}
