-- Add preferredLanguage column to chats table
ALTER TABLE `chats` ADD COLUMN `preferredLanguage` TEXT DEFAULT 'en';
