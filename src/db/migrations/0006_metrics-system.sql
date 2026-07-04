CREATE TABLE `metrics` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`value` real NOT NULL,
	`tags` text,
	`timestamp` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `metricAggregates` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`period` text NOT NULL,
	`periodStart` integer NOT NULL,
	`count` integer NOT NULL,
	`sum` real NOT NULL,
	`min` real NOT NULL,
	`max` real NOT NULL,
	`avg` real NOT NULL,
	`p50` real,
	`p95` real,
	`p99` real,
	`tags` text,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `metrics_name_idx` ON `metrics` (`name`);
--> statement-breakpoint
CREATE INDEX `metrics_timestamp_idx` ON `metrics` (`timestamp`);
--> statement-breakpoint
CREATE INDEX `metrics_name_timestamp_idx` ON `metrics` (`name`, `timestamp`);
--> statement-breakpoint
CREATE INDEX `metricAggregates_name_period_idx` ON `metricAggregates` (`name`, `period`, `periodStart`);
--> statement-breakpoint
CREATE INDEX `metricAggregates_periodStart_idx` ON `metricAggregates` (`periodStart`);
