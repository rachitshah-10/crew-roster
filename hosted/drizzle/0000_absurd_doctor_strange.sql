CREATE TABLE `demo_audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`actor_role` text NOT NULL,
	`action` text NOT NULL,
	`target_id` text NOT NULL,
	`created_at` text NOT NULL,
	`details` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_workspace_idx` ON `demo_audit_events` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `demo_rule_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`version` integer NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rule_workspace_version_idx` ON `demo_rule_versions` (`workspace_id`,`version`);--> statement-breakpoint
CREATE TABLE `demo_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`upload_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`owner_role` text NOT NULL,
	`filename` text NOT NULL,
	`created_at` text NOT NULL,
	`result_json` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `run_upload_idx` ON `demo_runs` (`upload_id`);--> statement-breakpoint
CREATE INDEX `run_workspace_idx` ON `demo_runs` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `demo_uploads` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`owner_role` text NOT NULL,
	`filename` text NOT NULL,
	`created_at` text NOT NULL,
	`file_hash` text NOT NULL,
	`rule_version` integer NOT NULL,
	`rows_json` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `upload_workspace_idx` ON `demo_uploads` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `demo_workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`role` text NOT NULL,
	`csrf` text NOT NULL,
	`active_version` integer NOT NULL,
	`upload_count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_token_idx` ON `demo_workspaces` (`token_hash`);