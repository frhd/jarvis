-- Plans table - stores plan content and state
CREATE TABLE `plans` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`state` text DEFAULT 'proposing' NOT NULL,
	`created_by` text,
	`chat_id` text,
	`metadata` text DEFAULT '{}',
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`approved_at` integer,
	`completed_at` integer,
	FOREIGN KEY (`created_by`) REFERENCES `senders`(`id`),
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`)
);
--> statement-breakpoint
CREATE INDEX `plans_state_idx` ON `plans` (`state`);
--> statement-breakpoint
CREATE INDEX `plans_chat_id_idx` ON `plans` (`chat_id`);
--> statement-breakpoint
CREATE INDEX `plans_created_by_idx` ON `plans` (`created_by`);
--> statement-breakpoint

-- Plan Executions table - tracks loop.sh execution sessions
CREATE TABLE `plan_executions` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
	`session_id` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`prompt_file` text,
	`loop_log_path` text,
	`started_at` integer DEFAULT (unixepoch()) NOT NULL,
	`completed_at` integer,
	`total_iterations` integer DEFAULT 0,
	`current_iteration` integer DEFAULT 0,
	`total_tokens_in` integer DEFAULT 0,
	`total_tokens_out` integer DEFAULT 0,
	`total_cost` real DEFAULT 0,
	`progress_report` text DEFAULT '{}',
	FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`)
);
--> statement-breakpoint
CREATE INDEX `plan_executions_plan_id_idx` ON `plan_executions` (`plan_id`);
--> statement-breakpoint
CREATE INDEX `plan_executions_status_idx` ON `plan_executions` (`status`);
--> statement-breakpoint
CREATE INDEX `plan_executions_session_id_idx` ON `plan_executions` (`session_id`);
--> statement-breakpoint

-- Plan Feedback table - stores feedback iterations
CREATE TABLE `plan_feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
	`sender_id` text NOT NULL,
	`feedback` text NOT NULL,
	`version` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`),
	FOREIGN KEY (`sender_id`) REFERENCES `senders`(`id`)
);
--> statement-breakpoint
CREATE INDEX `plan_feedback_plan_id_idx` ON `plan_feedback` (`plan_id`);
--> statement-breakpoint
CREATE INDEX `plan_feedback_sender_id_idx` ON `plan_feedback` (`sender_id`);
