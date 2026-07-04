-- Migration: Loop Prevention System
-- Description: Add tables for detecting and preventing conversation loops
-- Created: 2025-12-25

-- Loop Patterns table - stores learned conversation loop patterns
CREATE TABLE IF NOT EXISTS loopPatterns (
  id TEXT PRIMARY KEY,
  patternHash TEXT NOT NULL UNIQUE,
  pattern TEXT NOT NULL,
  loopType TEXT NOT NULL CHECK (loopType IN ('imperative_repeat', 'clarification_loop', 'execution_hesitation', 'misunderstanding', 'context_lost', 'custom')),
  frequency INTEGER NOT NULL DEFAULT 1,
  avgDurationMs INTEGER NOT NULL,
  avgMessageCount INTEGER NOT NULL DEFAULT 0,
  resolutionStrategy TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.5,
  metadata TEXT,
  lastOccurredAt INTEGER,
  isActive INTEGER NOT NULL DEFAULT 1 CHECK (isActive IN (0, 1)),
  createdAt INTEGER NOT NULL DEFAULT (unixepoch()),
  updatedAt INTEGER NOT NULL DEFAULT (unixepoch())
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS loopPatterns_type_idx ON loopPatterns(loopType);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS loopPatterns_frequency_idx ON loopPatterns(frequency);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS loopPatterns_active_idx ON loopPatterns(isActive);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS loopPatterns_lastOccurred_idx ON loopPatterns(lastOccurredAt);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS loopDetections (
  id TEXT PRIMARY KEY,
  patternId TEXT NOT NULL REFERENCES loopPatterns(id),
  chatId TEXT NOT NULL REFERENCES chats(id),
  senderId TEXT REFERENCES senders(id),
  messageIds TEXT NOT NULL,
  messageCount INTEGER NOT NULL,
  durationMs INTEGER NOT NULL,
  wasResolved INTEGER NOT NULL DEFAULT 0 CHECK (wasResolved IN (0, 1)),
  resolutionAction TEXT,
  userFeedback INTEGER CHECK (userFeedback IN (-1, 0, 1)),
  detectedAt INTEGER NOT NULL DEFAULT (unixepoch())
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS loopDetections_pattern_idx ON loopDetections(patternId);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS loopDetections_chat_idx ON loopDetections(chatId);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS loopDetections_sender_idx ON loopDetections(senderId);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS loopDetections_detectedAt_idx ON loopDetections(detectedAt);
