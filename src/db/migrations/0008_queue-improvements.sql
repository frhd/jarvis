-- Add new columns to queue table for enhanced retry and priority management
ALTER TABLE `queue` ADD COLUMN `nextRetryAt` integer;
--> statement-breakpoint
ALTER TABLE `queue` ADD COLUMN `priorityBoostApplied` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `queue` ADD COLUMN `originalPriority` integer;
--> statement-breakpoint
CREATE INDEX `queue_nextRetryAt_idx` ON `queue` (`nextRetryAt`);
--> statement-breakpoint

-- Create deadLetterQueue table for failed messages
CREATE TABLE `deadLetterQueue` (
	`id` text PRIMARY KEY NOT NULL,
	`originalQueueId` text NOT NULL,
	`messageId` text NOT NULL,
	`reason` text NOT NULL,
	`errorHistory` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`metadata` text,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`lastAttemptAt` integer,
	FOREIGN KEY (`messageId`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `deadLetterQueue_createdAt_idx` ON `deadLetterQueue` (`createdAt`);
--> statement-breakpoint
CREATE INDEX `deadLetterQueue_messageId_idx` ON `deadLetterQueue` (`messageId`);
--> statement-breakpoint

-- Create circuitBreakerStates table for service health tracking
CREATE TABLE `circuitBreakerStates` (
	`id` text PRIMARY KEY NOT NULL,
	`serviceName` text NOT NULL,
	`state` text DEFAULT 'CLOSED' NOT NULL,
	`failureCount` integer DEFAULT 0 NOT NULL,
	`successCount` integer DEFAULT 0 NOT NULL,
	`lastFailureAt` integer,
	`lastSuccessAt` integer,
	`lastStateChangeAt` integer,
	`nextAttemptAt` integer,
	`halfOpenAttempts` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `circuitBreakerStates_serviceName_unique` ON `circuitBreakerStates` (`serviceName`);
--> statement-breakpoint
CREATE INDEX `circuitBreakerStates_serviceName_idx` ON `circuitBreakerStates` (`serviceName`);
--> statement-breakpoint
CREATE INDEX `circuitBreakerStates_state_idx` ON `circuitBreakerStates` (`state`);
