ALTER TABLE `memories` ADD `user_id` text REFERENCES `users`(`id`);
--> statement-breakpoint
ALTER TABLE `memories` ADD `conversation_id` text REFERENCES `conversations`(`id`);
--> statement-breakpoint
CREATE INDEX `memories_user_idx` ON `memories` (`user_id`);
--> statement-breakpoint
CREATE INDEX `memories_conversation_idx` ON `memories` (`conversation_id`);
