CREATE TABLE `intentClassificationLogs` (
	`id` text PRIMARY KEY NOT NULL,
	`messageId` text NOT NULL,
	`parentIntent` text,
	`childIntent` text,
	`confidence` real,
	`confidenceLevel` text,
	`classificationMethod` text NOT NULL,
	`wasEscalated` integer DEFAULT 0 NOT NULL,
	`feedbackCorrectIntent` text,
	`feedbackScore` integer,
	`durationMs` integer,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`messageId`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `intentClassificationLogs_messageId_idx` ON `intentClassificationLogs` (`messageId`);--> statement-breakpoint
CREATE INDEX `intentClassificationLogs_method_idx` ON `intentClassificationLogs` (`classificationMethod`);--> statement-breakpoint
CREATE INDEX `intentClassificationLogs_escalated_idx` ON `intentClassificationLogs` (`wasEscalated`);--> statement-breakpoint
CREATE INDEX `intentClassificationLogs_createdAt_idx` ON `intentClassificationLogs` (`createdAt`);
