CREATE TABLE `semanticCache` (
	`id` text PRIMARY KEY NOT NULL,
	`promptHash` text NOT NULL,
	`promptText` text NOT NULL,
	`response` text NOT NULL,
	`model` text NOT NULL,
	`intent` text,
	`metadata` text,
	`hitCount` integer DEFAULT 1 NOT NULL,
	`lastAccessedAt` integer DEFAULT (unixepoch()) NOT NULL,
	`expiresAt` integer,
	`sourceMessageIds` text,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `semanticCache_hash_idx` ON `semanticCache` (`promptHash`);
--> statement-breakpoint
CREATE INDEX `semanticCache_model_idx` ON `semanticCache` (`model`);
--> statement-breakpoint
CREATE INDEX `semanticCache_intent_idx` ON `semanticCache` (`intent`);
--> statement-breakpoint
CREATE INDEX `semanticCache_expires_idx` ON `semanticCache` (`expiresAt`);
--> statement-breakpoint
CREATE INDEX `semanticCache_access_idx` ON `semanticCache` (`lastAccessedAt`);
