-- Migration: Add indexes for messages table analytics queries
-- Purpose: Improve query performance for date range and user-specific queries

-- Index for date range queries (analytics, retention cleanup)
CREATE INDEX IF NOT EXISTS messages_createdAt_idx ON messages (createdAt);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS messages_senderId_idx ON messages (senderId);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS messages_senderId_createdAt_idx ON messages (senderId, createdAt);
