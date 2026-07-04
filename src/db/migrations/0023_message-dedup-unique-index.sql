-- Add UNIQUE index on messages(chatId, telegramMessageId) to enforce deduplication at DB level.
-- Previously this was a non-unique index, allowing duplicate messages from race conditions.
DROP INDEX IF EXISTS messages_chatId_telegramMessageId_idx;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS messages_chatId_telegramMessageId_unique_idx
  ON messages (chatId, telegramMessageId)
  WHERE isBot = 0 AND telegramMessageId > 0;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS messages_chatId_telegramMessageId_idx
  ON messages (chatId, telegramMessageId);
