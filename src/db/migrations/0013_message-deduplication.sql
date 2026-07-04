-- Migration: Add unique constraint on messages to prevent duplicate Telegram messages
-- This prevents race conditions where the same message is ingested multiple times
-- (e.g., during reconnection when both normal handler and catchup handler process the same message)

-- Step 1: Clean up existing duplicates by keeping only the oldest entry
-- We need to do this before adding the unique constraint
DELETE FROM messages
WHERE id IN (
    SELECT m.id
    FROM messages m
    INNER JOIN (
        SELECT chatId, telegramMessageId, MIN(createdAt) as minCreatedAt
        FROM messages
        WHERE telegramMessageId IS NOT NULL
        GROUP BY chatId, telegramMessageId
        HAVING COUNT(*) > 1
    ) dups ON m.chatId = dups.chatId
        AND m.telegramMessageId = dups.telegramMessageId
        AND m.createdAt > dups.minCreatedAt
);
--> statement-breakpoint
DELETE FROM queue
WHERE messageId NOT IN (SELECT id FROM messages);
--> statement-breakpoint
DROP INDEX IF EXISTS messages_chatId_telegramMessageId_idx;
--> statement-breakpoint
CREATE UNIQUE INDEX messages_chatId_telegramMessageId_unique_idx
ON messages (chatId, telegramMessageId)
WHERE telegramMessageId IS NOT NULL;
