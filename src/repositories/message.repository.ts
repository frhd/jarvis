import { eq, and, desc, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { messages } from '../db/schema.js';
import { BaseRepository } from './base.repository.js';
import type { IMessageRepository } from '../interfaces/repositories.js';
import type { Message, NewMessage } from '../types/index.js';
import { nanoid } from 'nanoid';

// Re-export types for backward compatibility
export type { Message, NewMessage };

export class MessageRepository extends BaseRepository<Message, NewMessage, typeof messages> implements IMessageRepository {
  protected table = messages;

  /**
   * Create a message if it doesn't already exist (based on chatId + telegramMessageId).
   * Returns the existing message if a duplicate is detected, or the newly created message.
   * This prevents race conditions during concurrent ingestion (e.g., handler + catchup).
   */
  async createIfNotExists(data: NewMessage): Promise<{ message: Message; created: boolean }> {
    // First check if message already exists (fast path)
    if (data.telegramMessageId !== undefined) {
      const existing = await this.findByTelegramId(data.chatId, data.telegramMessageId);
      if (existing) {
        return { message: existing, created: false };
      }
    }

    // Try to insert - if there's a UNIQUE constraint violation, the insert will fail
    // We use a try-catch to handle the race condition gracefully
    try {
      const inserted = await db
        .insert(messages)
        .values({
          id: nanoid(),
          telegramMessageId: data.telegramMessageId,
          chatId: data.chatId,
          senderId: data.senderId ?? null,
          text: data.text ?? null,
          mediaType: data.mediaType ?? null,
          mediaPath: data.mediaPath ?? null,
          mediaFileId: data.mediaFileId ?? null,
          replyToMessageId: data.replyToMessageId ?? null,
          forwardFromChatId: data.forwardFromChatId ?? null,
          forwardFromMessageId: data.forwardFromMessageId ?? null,
          rawJson: data.rawJson,
          createdAt: new Date(),
        })
        .returning();

      return { message: inserted[0], created: true };
    } catch (error) {
      // Check if this is a constraint violation or other recoverable SQLite error
      // better-sqlite3 errors have a `code` property (e.g., 'SQLITE_CONSTRAINT', 'SQLITE_ERROR')
      const errorCode = (error as { code?: string })?.code;
      const errorMessage = error instanceof Error ? error.message : String(error);

      // SQLITE_CONSTRAINT: UNIQUE violation (race condition)
      // SQLITE_ERROR: Generic error that can occur during concurrent access
      const isRecoverable =
        errorCode === 'SQLITE_CONSTRAINT' ||
        errorCode === 'SQLITE_ERROR' ||
        errorMessage.includes('UNIQUE constraint failed') ||
        errorMessage.includes('SQLITE_CONSTRAINT');

      if (isRecoverable) {
        // Race condition or concurrent access issue: try to fetch the existing message
        if (data.telegramMessageId !== undefined) {
          const existing = await this.findByTelegramId(data.chatId, data.telegramMessageId);
          if (existing) {
            return { message: existing, created: false };
          }
        }
      }
      // Re-throw if it's a different error or we couldn't find the existing message
      throw error;
    }
  }

  async findByTelegramId(chatId: string, messageId: number): Promise<Message | null> {
    const result = await db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.chatId, chatId),
          eq(messages.telegramMessageId, messageId)
        )
      )
      .limit(1);

    return result[0] || null;
  }

  async findByChat(
    chatId: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<Message[]> {
    return await db
      .select()
      .from(messages)
      .where(eq(messages.chatId, chatId))
      .orderBy(desc(messages.createdAt))
      .limit(limit)
      .offset(offset);
  }

  async findRecentByChatId(chatId: string, limit: number = 10): Promise<Message[]> {
    return await db
      .select()
      .from(messages)
      .where(eq(messages.chatId, chatId))
      .orderBy(desc(messages.createdAt))
      .limit(limit);
  }

  async findByDateRange(chatId: string, start: Date, end: Date): Promise<Message[]> {
    return await db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.chatId, chatId),
          sql`${messages.createdAt} >= ${start.getTime() / 1000}`,
          sql`${messages.createdAt} <= ${end.getTime() / 1000}`
        )
      )
      .orderBy(desc(messages.createdAt));
  }

  async findRecentMessages(limit: number = 50): Promise<Message[]> {
    return await db
      .select()
      .from(messages)
      .orderBy(desc(messages.createdAt))
      .limit(limit);
  }

  async markTranscriptPending(messageId: string): Promise<void> {
    await db
      .update(messages)
      .set({ transcriptStatus: 'pending' })
      .where(eq(messages.id, messageId));
  }

  async markTranscriptProcessing(messageId: string): Promise<void> {
    await db
      .update(messages)
      .set({ transcriptStatus: 'processing' })
      .where(eq(messages.id, messageId));
  }

  async updateTranscript(
    messageId: string,
    data: { transcript: string; language: string; durationMs: number }
  ): Promise<void> {
    await db
      .update(messages)
      .set({
        transcript: data.transcript,
        transcriptStatus: 'completed',
        transcriptLanguage: data.language,
        transcriptDurationMs: data.durationMs,
        transcriptedAt: new Date(),
        transcriptError: null,
      })
      .where(eq(messages.id, messageId));
  }

  async markTranscriptFailed(messageId: string, error: string): Promise<void> {
    await db
      .update(messages)
      .set({
        transcriptStatus: 'failed',
        transcriptError: error,
      })
      .where(eq(messages.id, messageId));
  }

  async findPendingTranscriptions(limit: number = 50): Promise<Message[]> {
    return await db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.mediaType, 'voice'),
          eq(messages.transcriptStatus, 'pending')
        )
      )
      .limit(limit);
  }

  async findByChatId(chatId: string, limit: number = 100): Promise<Message[]> {
    return await db
      .select()
      .from(messages)
      .where(eq(messages.chatId, chatId))
      .orderBy(desc(messages.createdAt))
      .limit(limit);
  }

  /**
   * Check if a bot response has already been sent that replies to the given telegramMessageId.
   * Used to prevent duplicate responses when messages are reprocessed.
   */
  async hasBotResponseForMessage(chatId: string, replyToTelegramMessageId: number): Promise<boolean> {
    const result = await db
      .select({ id: messages.id })
      .from(messages)
      .where(
        and(
          eq(messages.chatId, chatId),
          eq(messages.replyToMessageId, replyToTelegramMessageId),
          eq(messages.isBot, true)
        )
      )
      .limit(1);

    return result.length > 0;
  }

  async deleteByChatId(chatId: string): Promise<number> {
    const result = await db
      .delete(messages)
      .where(eq(messages.chatId, chatId))
      .returning({ id: messages.id });

    return result.length;
  }
}
