/**
 * Backfill Unified Identity Tables
 *
 * Migrates existing `senders` → `users` + `platformIdentities`
 * and `chats` → `conversations` using the IdentityService.
 * Produces an ID mapping file for Phase 5.
 *
 * Usage:
 *   npx tsx src/db/backfill-unified-identity.ts
 *   npx tsx src/db/backfill-unified-identity.ts --dry-run
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SenderRepository } from '../repositories/sender.repository.js';
import { ChatRepository } from '../repositories/chat.repository.js';
import { UserRepository } from '../repositories/user.repository.js';
import { PlatformIdentityRepository } from '../repositories/platform-identity.repository.js';
import { ConversationRepository } from '../repositories/conversation.repository.js';
import { IdentityService } from '../services/identity.service.js';
import { PLATFORM_TELEGRAM } from '../config/platforms.js';
import type { ConversationType } from '../config/platforms.js';
import type { Sender, Chat } from '../types/index.js';

// ============================================================================
// Constants
// ============================================================================

const BATCH_SIZE = 100;
const MAPPING_OUTPUT_PATH = resolve(process.cwd(), 'data/backfill-mapping.json');
const PROGRESS_LOG_INTERVAL = 50;

/** Telegram chat type → unified conversation type */
const CHAT_TYPE_MAP: Record<string, ConversationType> = {
  private: 'dm',
  group: 'group',
  supergroup: 'group',
  channel: 'channel',
};

// ============================================================================
// Types
// ============================================================================

export interface BackfillMapping {
  senderToUser: Record<string, string>;
  chatToConversation: Record<string, string>;
}

export interface BackfillResult {
  sendersProcessed: number;
  chatsProcessed: number;
  mapping: BackfillMapping;
}

export interface BackfillDeps {
  senderRepo: SenderRepository;
  chatRepo: ChatRepository;
  identityService: IdentityService;
}

// ============================================================================
// Display Name Composition
// ============================================================================

/**
 * Compose a display name from sender fields.
 * Priority: displayName > firstName+lastName > firstName > username > telegramId
 */
export function composeSenderDisplayName(sender: Sender): string {
  if (sender.displayName) return sender.displayName;
  if (sender.firstName && sender.lastName) return `${sender.firstName} ${sender.lastName}`;
  if (sender.firstName) return sender.firstName;
  if (sender.username) return sender.username;
  return sender.telegramId;
}

/**
 * Map a Telegram chat type to a unified conversation type.
 */
export function mapChatType(telegramType: string): ConversationType {
  const mapped = CHAT_TYPE_MAP[telegramType];
  if (!mapped) {
    throw new Error(`Unknown Telegram chat type: ${telegramType}`);
  }
  return mapped;
}

// ============================================================================
// Backfill Logic
// ============================================================================

/**
 * Backfill senders into users + platformIdentities.
 * Returns the sender ID → user ID mapping.
 */
async function backfillSenders(
  deps: BackfillDeps,
  dryRun: boolean,
): Promise<{ senderToUser: Record<string, string>; count: number }> {
  const { senderRepo, identityService } = deps;
  const senderToUser: Record<string, string> = {};
  const totalSenders = await senderRepo.count();

  console.log(`Found ${totalSenders} senders to backfill`);

  let processed = 0;

  for (let offset = 0; offset < totalSenders; offset += BATCH_SIZE) {
    const senders = await senderRepo.findMany({
      limit: BATCH_SIZE,
      offset,
      orderBy: 'asc',
    });

    for (const sender of senders) {
      const displayName = composeSenderDisplayName(sender);
      const metadata = {
        firstName: sender.firstName,
        lastName: sender.lastName,
        username: sender.username,
        phone: sender.phone,
        displayName,
      };

      if (dryRun) {
        console.log(`  [dry-run] Would resolve sender ${sender.id} (${sender.telegramId}) → user with displayName="${displayName}"`);
        senderToUser[sender.id] = `<dry-run:${sender.telegramId}>`;
      } else {
        const user = await identityService.resolveUser(
          PLATFORM_TELEGRAM,
          sender.telegramId,
          metadata,
        );
        senderToUser[sender.id] = user.id;
      }

      processed++;
      if (processed % PROGRESS_LOG_INTERVAL === 0) {
        console.log(`  Processed ${processed}/${totalSenders} senders`);
      }
    }
  }

  console.log(`Backfilled ${processed} senders`);
  return { senderToUser, count: processed };
}

/**
 * Backfill chats into conversations.
 * Returns the chat ID → conversation ID mapping.
 */
async function backfillChats(
  deps: BackfillDeps,
  dryRun: boolean,
): Promise<{ chatToConversation: Record<string, string>; count: number }> {
  const { chatRepo, identityService } = deps;
  const chatToConversation: Record<string, string> = {};
  const totalChats = await chatRepo.count();

  console.log(`Found ${totalChats} chats to backfill`);

  let processed = 0;

  for (let offset = 0; offset < totalChats; offset += BATCH_SIZE) {
    const chats = await chatRepo.findMany({
      limit: BATCH_SIZE,
      offset,
      orderBy: 'asc',
    });

    for (const chat of chats) {
      const conversationType = mapChatType(chat.type);
      const metadata = {
        title: chat.title,
        username: chat.username,
        preferredLanguage: chat.preferredLanguage,
      };

      if (dryRun) {
        console.log(`  [dry-run] Would resolve chat ${chat.id} (${chat.telegramId}, ${chat.type}→${conversationType}) → conversation`);
        chatToConversation[chat.id] = `<dry-run:${chat.telegramId}>`;
      } else {
        const conversation = await identityService.resolveConversation(
          PLATFORM_TELEGRAM,
          chat.telegramId,
          conversationType,
          metadata,
        );
        chatToConversation[chat.id] = conversation.id;
      }

      processed++;
      if (processed % PROGRESS_LOG_INTERVAL === 0) {
        console.log(`  Processed ${processed}/${totalChats} chats`);
      }
    }
  }

  console.log(`Backfilled ${processed} chats`);
  return { chatToConversation, count: processed };
}

/**
 * Run the full backfill, producing a mapping file.
 */
export async function runBackfill(
  deps: BackfillDeps,
  options: { dryRun?: boolean; outputPath?: string } = {},
): Promise<BackfillResult> {
  const dryRun = options.dryRun ?? false;
  const outputPath = options.outputPath ?? MAPPING_OUTPUT_PATH;

  console.log(`Starting unified identity backfill${dryRun ? ' (DRY RUN)' : ''}...`);

  const { senderToUser, count: sendersProcessed } = await backfillSenders(deps, dryRun);
  const { chatToConversation, count: chatsProcessed } = await backfillChats(deps, dryRun);

  const mapping: BackfillMapping = { senderToUser, chatToConversation };

  if (!dryRun) {
    writeFileSync(outputPath, JSON.stringify(mapping, null, 2));
    console.log(`Mapping written to ${outputPath}`);
  } else {
    console.log(`[dry-run] Would write mapping to ${outputPath}`);
  }

  console.log(`Backfill complete: ${sendersProcessed} senders, ${chatsProcessed} chats`);
  return { sendersProcessed, chatsProcessed, mapping };
}

// ============================================================================
// CLI Entry Point
// ============================================================================

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  const senderRepo = new SenderRepository();
  const chatRepo = new ChatRepository();
  const identityService = new IdentityService(
    new UserRepository(),
    new PlatformIdentityRepository(),
    new ConversationRepository(),
  );

  await runBackfill({ senderRepo, chatRepo, identityService }, { dryRun });
}

// Only run when executed directly (not imported)
const isDirectExecution = process.argv[1]?.endsWith('backfill-unified-identity.ts')
  || process.argv[1]?.endsWith('backfill-unified-identity.js');

if (isDirectExecution) {
  main().catch((err) => {
    console.error('Backfill failed:', err);
    process.exit(1);
  });
}
