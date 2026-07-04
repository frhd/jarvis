ALTER TABLE `messages` ADD COLUMN `transcript` text;
--> statement-breakpoint
ALTER TABLE `messages` ADD COLUMN `transcriptStatus` text;
--> statement-breakpoint
ALTER TABLE `messages` ADD COLUMN `transcriptError` text;
--> statement-breakpoint
ALTER TABLE `messages` ADD COLUMN `transcriptLanguage` text;
--> statement-breakpoint
ALTER TABLE `messages` ADD COLUMN `transcriptDurationMs` integer;
--> statement-breakpoint
ALTER TABLE `messages` ADD COLUMN `transcriptedAt` integer;
--> statement-breakpoint
CREATE INDEX `messages_transcriptStatus_idx` ON `messages` (`transcriptStatus`) WHERE `mediaType` = 'voice';
