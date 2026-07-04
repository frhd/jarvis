CREATE TABLE `conversationSummaries` (
	`id` text PRIMARY KEY NOT NULL,
	`chatId` text NOT NULL,
	`startMessageId` text,
	`endMessageId` text,
	`messageCount` integer NOT NULL,
	`summary` text NOT NULL,
	`keyTopics` text,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`chatId`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`startMessageId`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`endMessageId`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `conversationSummaries_chat_idx` ON `conversationSummaries` (`chatId`);--> statement-breakpoint
CREATE TABLE `embeddings` (
	`id` text PRIMARY KEY NOT NULL,
	`sourceType` text NOT NULL,
	`sourceId` text NOT NULL,
	`content` text NOT NULL,
	`embedding` text NOT NULL,
	`model` text NOT NULL,
	`dimensions` integer DEFAULT 768 NOT NULL,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `embeddings_source_idx` ON `embeddings` (`sourceType`,`sourceId`);--> statement-breakpoint
CREATE TABLE `memories` (
	`id` text PRIMARY KEY NOT NULL,
	`senderId` text,
	`chatId` text,
	`memoryType` text NOT NULL,
	`content` text NOT NULL,
	`confidence` integer DEFAULT 100 NOT NULL,
	`sourceMessageIds` text,
	`lastAccessedAt` integer,
	`accessCount` integer DEFAULT 0 NOT NULL,
	`isArchived` integer DEFAULT false NOT NULL,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`senderId`) REFERENCES `senders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`chatId`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `memories_sender_idx` ON `memories` (`senderId`);--> statement-breakpoint
CREATE INDEX `memories_chat_idx` ON `memories` (`chatId`);--> statement-breakpoint
CREATE INDEX `memories_type_idx` ON `memories` (`memoryType`);--> statement-breakpoint
CREATE INDEX `memories_archived_idx` ON `memories` (`isArchived`);--> statement-breakpoint
CREATE TABLE `userPreferences` (
	`id` text PRIMARY KEY NOT NULL,
	`senderId` text NOT NULL,
	`category` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`confidence` integer DEFAULT 100 NOT NULL,
	`sourceMessageIds` text,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`senderId`) REFERENCES `senders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `userPreferences_sender_idx` ON `userPreferences` (`senderId`);--> statement-breakpoint
CREATE INDEX `userPreferences_category_idx` ON `userPreferences` (`category`);--> statement-breakpoint
CREATE INDEX `userPreferences_unique_idx` ON `userPreferences` (`senderId`,`category`,`key`);