-- Add displayName field to senders table for user-provided identity
-- This allows users to explicitly tell Jarvis their name and have it persist
-- across sessions, separate from firstName/lastName from Telegram

ALTER TABLE senders ADD COLUMN displayName TEXT;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS senders_displayName_idx ON senders(displayName);
