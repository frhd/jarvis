-- Security Audit Logs table
CREATE TABLE `security_audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`event_type` text NOT NULL,
	`user_id` text,
	`telegram_id` integer,
	`action` text NOT NULL,
	`details` text DEFAULT '{}' NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`severity` text DEFAULT 'INFO' NOT NULL,
	`correlation_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_security_audit_event_type` ON `security_audit_logs` (`event_type`);
--> statement-breakpoint
CREATE INDEX `idx_security_audit_user_id` ON `security_audit_logs` (`user_id`);
--> statement-breakpoint
CREATE INDEX `idx_security_audit_telegram_id` ON `security_audit_logs` (`telegram_id`);
--> statement-breakpoint
CREATE INDEX `idx_security_audit_created_at` ON `security_audit_logs` (`created_at`);
--> statement-breakpoint
CREATE INDEX `idx_security_audit_severity` ON `security_audit_logs` (`severity`);
--> statement-breakpoint

-- Data Export Requests table
CREATE TABLE `data_export_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`telegram_id` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`include_messages` integer DEFAULT 1 NOT NULL,
	`include_memories` integer DEFAULT 1 NOT NULL,
	`include_preferences` integer DEFAULT 1 NOT NULL,
	`include_media` integer DEFAULT 0 NOT NULL,
	`format` text DEFAULT 'json' NOT NULL,
	`file_path` text,
	`size_bytes` integer,
	`record_counts` text DEFAULT '{}',
	`requested_at` integer DEFAULT (unixepoch()) NOT NULL,
	`completed_at` integer,
	`error_message` text
);
--> statement-breakpoint
CREATE INDEX `idx_data_export_user_id` ON `data_export_requests` (`user_id`);
--> statement-breakpoint
CREATE INDEX `idx_data_export_telegram_id` ON `data_export_requests` (`telegram_id`);
--> statement-breakpoint
CREATE INDEX `idx_data_export_status` ON `data_export_requests` (`status`);
--> statement-breakpoint

-- Data Deletion Requests table
CREATE TABLE `data_deletion_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`telegram_id` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`delete_messages` integer DEFAULT 1 NOT NULL,
	`delete_memories` integer DEFAULT 1 NOT NULL,
	`delete_preferences` integer DEFAULT 1 NOT NULL,
	`delete_media` integer DEFAULT 1 NOT NULL,
	`reason` text,
	`deleted_counts` text DEFAULT '{}',
	`audit_log_id` text,
	`requested_at` integer DEFAULT (unixepoch()) NOT NULL,
	`completed_at` integer,
	`error_message` text
);
--> statement-breakpoint
CREATE INDEX `idx_data_deletion_user_id` ON `data_deletion_requests` (`user_id`);
--> statement-breakpoint
CREATE INDEX `idx_data_deletion_telegram_id` ON `data_deletion_requests` (`telegram_id`);
--> statement-breakpoint
CREATE INDEX `idx_data_deletion_status` ON `data_deletion_requests` (`status`);
--> statement-breakpoint

-- Retention Policies table
CREATE TABLE `retention_policies` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_type` text NOT NULL,
	`retention_days` integer NOT NULL,
	`archive_before_delete` integer DEFAULT 0 NOT NULL,
	`requires_user_consent` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `retention_policies_entity_type_unique` ON `retention_policies` (`entity_type`);
--> statement-breakpoint

-- Insert default retention policies
INSERT OR IGNORE INTO `retention_policies` (`id`, `entity_type`, `retention_days`, `archive_before_delete`) VALUES
  ('ret_messages', 'message', 90, 1),
  ('ret_memories', 'memory', 180, 1),
  ('ret_media', 'media', 30, 0),
  ('ret_cache', 'cache', 7, 0),
  ('ret_metrics', 'metrics', 30, 0),
  ('ret_embeddings', 'embeddings', 180, 0),
  ('ret_audit_logs', 'audit_logs', 365, 1);
