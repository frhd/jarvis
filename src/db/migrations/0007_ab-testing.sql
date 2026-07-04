CREATE TABLE `experiments` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`status` text NOT NULL DEFAULT 'draft',
	`targetMetric` text NOT NULL,
	`config` text,
	`startDate` integer,
	`endDate` integer,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `experimentVariants` (
	`id` text PRIMARY KEY NOT NULL,
	`experimentId` text NOT NULL,
	`name` text NOT NULL,
	`weight` integer NOT NULL,
	`config` text,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`experimentId`) REFERENCES `experiments`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `experimentAssignments` (
	`id` text PRIMARY KEY NOT NULL,
	`experimentId` text NOT NULL,
	`senderId` text NOT NULL,
	`variantId` text NOT NULL,
	`assignedAt` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`experimentId`) REFERENCES `experiments`(`id`) ON DELETE CASCADE,
	FOREIGN KEY (`senderId`) REFERENCES `senders`(`id`) ON DELETE CASCADE,
	FOREIGN KEY (`variantId`) REFERENCES `experimentVariants`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `experimentEvents` (
	`id` text PRIMARY KEY NOT NULL,
	`experimentId` text NOT NULL,
	`variantId` text NOT NULL,
	`senderId` text NOT NULL,
	`eventType` text NOT NULL,
	`value` real,
	`metadata` text,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`experimentId`) REFERENCES `experiments`(`id`) ON DELETE CASCADE,
	FOREIGN KEY (`variantId`) REFERENCES `experimentVariants`(`id`) ON DELETE CASCADE,
	FOREIGN KEY (`senderId`) REFERENCES `senders`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `experiments_status_idx` ON `experiments` (`status`);
--> statement-breakpoint
CREATE INDEX `experiments_targetMetric_idx` ON `experiments` (`targetMetric`);
--> statement-breakpoint
CREATE INDEX `experiments_startDate_idx` ON `experiments` (`startDate`);
--> statement-breakpoint
CREATE INDEX `experimentVariants_experimentId_idx` ON `experimentVariants` (`experimentId`);
--> statement-breakpoint
CREATE UNIQUE INDEX `experimentAssignments_unique_idx` ON `experimentAssignments` (`experimentId`, `senderId`);
--> statement-breakpoint
CREATE INDEX `experimentAssignments_experimentId_idx` ON `experimentAssignments` (`experimentId`);
--> statement-breakpoint
CREATE INDEX `experimentAssignments_senderId_idx` ON `experimentAssignments` (`senderId`);
--> statement-breakpoint
CREATE INDEX `experimentAssignments_variantId_idx` ON `experimentAssignments` (`variantId`);
--> statement-breakpoint
CREATE INDEX `experimentEvents_experimentId_idx` ON `experimentEvents` (`experimentId`);
--> statement-breakpoint
CREATE INDEX `experimentEvents_variantId_idx` ON `experimentEvents` (`variantId`);
--> statement-breakpoint
CREATE INDEX `experimentEvents_senderId_idx` ON `experimentEvents` (`senderId`);
--> statement-breakpoint
CREATE INDEX `experimentEvents_eventType_idx` ON `experimentEvents` (`eventType`);
--> statement-breakpoint
CREATE INDEX `experimentEvents_createdAt_idx` ON `experimentEvents` (`createdAt`);
