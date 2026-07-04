#!/usr/bin/env tsx
/**
 * Script to batch extract memories from historical messages
 */

import { db } from '../src/db/client.js';
import { messages, senders } from '../src/db/schema.js';
import { LLMClient } from '../src/clients/llm.client.js';
import { EmbeddingClient } from '../src/clients/embedding.client.js';
import { MemoryRepository } from '../src/repositories/memory.repository.js';
import { EmbeddingRepository } from '../src/repositories/embedding.repository.js';
import { MemoryService } from '../src/services/memory.service.js';
import { logger } from '../src/utils/logger.js';
import { eq, and, isNotNull, desc } from 'drizzle-orm';

async function extractMemoriesFromHistory() {
  logger.info('[Extract] Starting memory extraction from history');

  // Initialize services
  const llmClient = new LLMClient();
  const embeddingClient = new EmbeddingClient();
  const memoryRepo = new MemoryRepository(db);
  const embeddingRepo = new EmbeddingRepository(db);
  const memoryService = new MemoryService(llmClient, embeddingClient, memoryRepo, embeddingRepo);

  // Get all user messages (non-bot messages with text)
  const userMessages = await db
    .select()
    .from(messages)
    .where(and(eq(messages.isBot, false), isNotNull(messages.text)))
    .orderBy(desc(messages.createdAt))
    .limit(100);

  logger.info(`[Extract] Found ${userMessages.length} user messages to process`);

  let processedCount = 0;
  let memoryCount = 0;

  for (const message of userMessages) {
    try {
      // Get sender info
      const sender = message.senderId
        ? await db.select().from(senders).where(eq(senders.id, message.senderId)).limit(1).then(r => r[0])
        : null;

      // Get recent context (previous 5 messages from same chat)
      const context = await db
        .select()
        .from(messages)
        .where(and(eq(messages.chatId, message.chatId), isNotNull(messages.text)))
        .orderBy(desc(messages.createdAt))
        .limit(5);

      logger.info(`[Extract] Processing message: ${message.text?.substring(0, 50)}...`);

      // Extract memories
      const result = await memoryService.extractAndStore(message as any, sender as any, context as any);

      if (result.processed && result.facts.length > 0) {
        memoryCount += result.facts.length;
        logger.info(`[Extract] ✓ Extracted ${result.facts.length} memories from message`);
      }

      processedCount++;

      // Rate limit to avoid overwhelming Ollama
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      logger.error('[Extract] Failed to process message', {
        messageId: message.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  logger.info('[Extract] Completed!', {
    processedMessages: processedCount,
    extractedMemories: memoryCount,
  });

  // Show memory stats
  if (userMessages[0]?.senderId) {
    const stats = await memoryService.getStats(userMessages[0].senderId);
    logger.info('[Extract] Memory stats:', stats);
  }
}

// Run the extraction
extractMemoriesFromHistory()
  .then(() => {
    logger.info('[Extract] Done!');
    process.exit(0);
  })
  .catch((error) => {
    logger.error('[Extract] Fatal error', error);
    process.exit(1);
  });
