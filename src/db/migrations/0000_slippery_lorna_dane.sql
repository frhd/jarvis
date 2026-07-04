CREATE TABLE `chatFilters` (
	`id` text PRIMARY KEY NOT NULL,
	`telegramChatId` text NOT NULL,
	`filterType` text NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `chatFilters_telegramChatId_idx` ON `chatFilters` (`telegramChatId`);--> statement-breakpoint
CREATE TABLE `chats` (
	`id` text PRIMARY KEY NOT NULL,
	`telegramId` text NOT NULL,
	`type` text NOT NULL,
	`title` text,
	`username` text,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chats_telegramId_unique` ON `chats` (`telegramId`);--> statement-breakpoint
CREATE INDEX `chats_telegramId_idx` ON `chats` (`telegramId`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`telegramMessageId` integer NOT NULL,
	`chatId` text NOT NULL,
	`senderId` text,
	`text` text,
	`mediaType` text,
	`mediaPath` text,
	`mediaFileId` text,
	`replyToMessageId` integer,
	`forwardFromChatId` text,
	`forwardFromMessageId` integer,
	`rawJson` text NOT NULL,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`chatId`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`senderId`) REFERENCES `senders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `messages_chatId_telegramMessageId_idx` ON `messages` (`chatId`,`telegramMessageId`);--> statement-breakpoint
CREATE TABLE `queue` (
	`id` text PRIMARY KEY NOT NULL,
	`messageId` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`lastError` text,
	`processedAt` integer,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`messageId`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `queue_messageId_unique` ON `queue` (`messageId`);--> statement-breakpoint
CREATE INDEX `queue_status_priority_createdAt_idx` ON `queue` (`status`,`priority`,`createdAt`);--> statement-breakpoint
CREATE TABLE `senders` (
	`id` text PRIMARY KEY NOT NULL,
	`telegramId` text NOT NULL,
	`firstName` text,
	`lastName` text,
	`username` text,
	`phone` text,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `senders_telegramId_unique` ON `senders` (`telegramId`);--> statement-breakpoint
CREATE INDEX `senders_telegramId_idx` ON `senders` (`telegramId`);