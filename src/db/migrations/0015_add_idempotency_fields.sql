-- Add idempotency and optimistic locking fields for duplicate prevention
-- Phase 4: Duplicate Response Prevention

-- Add version field to queue for optimistic locking
ALTER TABLE `queue` ADD COLUMN `version` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint

-- Add processing_started_at to track when processing began (for timeout detection)
ALTER TABLE `queue` ADD COLUMN `processingStartedAt` integer;
--> statement-breakpoint

-- Add idempotency_key to llmResponses for response deduplication
ALTER TABLE `llmResponses` ADD COLUMN `idempotencyKey` text;
--> statement-breakpoint

-- Add send_status to llmResponses to track pending/sent/failed states
ALTER TABLE `llmResponses` ADD COLUMN `sendStatus` text DEFAULT 'pending';
--> statement-breakpoint

-- Create unique index on idempotencyKey (partial - only non-null values)
CREATE UNIQUE INDEX IF NOT EXISTS `llmResponses_idempotencyKey_idx`
  ON `llmResponses` (`idempotencyKey`)
  WHERE `idempotencyKey` IS NOT NULL;
--> statement-breakpoint

-- Create index on queue version for optimistic locking queries
CREATE INDEX IF NOT EXISTS `queue_version_idx` ON `queue` (`id`, `version`);
--> statement-breakpoint

-- Create unique index on active queue items per message
-- (prevents multiple active queue items for same message)
CREATE UNIQUE INDEX IF NOT EXISTS `queue_messageId_active_idx`
  ON `queue` (`messageId`)
  WHERE `status` IN ('pending', 'processing');
