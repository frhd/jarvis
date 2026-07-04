CREATE TABLE `llmResponses` (
	`id` text PRIMARY KEY NOT NULL,
	`messageId` text NOT NULL,
	`promptType` text NOT NULL,
	`prompt` text NOT NULL,
	`response` text NOT NULL,
	`model` text NOT NULL,
	`durationMs` integer,
	`promptTokens` integer,
	`completionTokens` integer,
	`error` text,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`messageId`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `llmResponses_messageId_idx` ON `llmResponses` (`messageId`);--> statement-breakpoint
CREATE INDEX `llmResponses_promptType_idx` ON `llmResponses` (`promptType`);