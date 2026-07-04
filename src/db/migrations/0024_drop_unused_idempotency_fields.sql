-- Drop unused idempotency/sendStatus columns from llmResponses.
-- These were added in 0015 for "Phase 4: Duplicate Response Prevention" but the
-- writer-side wiring was never implemented: no code writes to sendStatus or
-- idempotencyKey, so the column has been stuck at 'pending' for every row.
-- Drop the dead state to remove confusion. The deduplication this was meant to
-- enable is now handled at the queue/message layer (see 0023).

DROP INDEX IF EXISTS `llmResponses_idempotencyKey_idx`;
--> statement-breakpoint

ALTER TABLE `llmResponses` DROP COLUMN `idempotencyKey`;
--> statement-breakpoint

ALTER TABLE `llmResponses` DROP COLUMN `sendStatus`;
