-- Platform-Agnostic Identity Tables
-- Phase 1 of Platform Memory Architecture

CREATE TABLE IF NOT EXISTS `users` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `platform_identities` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL REFERENCES `users`(`id`),
	`platform` text NOT NULL,
	`platform_user_id` text NOT NULL,
	`metadata` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`platform` text NOT NULL,
	`platform_conversation_id` text NOT NULL,
	`type` text NOT NULL,
	`title` text,
	`metadata` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_platform_identities_platform_user` ON `platform_identities` (`platform`, `platform_user_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `platform_identities_user_id_idx` ON `platform_identities` (`user_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_conversations_platform_conv` ON `conversations` (`platform`, `platform_conversation_id`);
