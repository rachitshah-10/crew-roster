CREATE TABLE `demo_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`workspace_id` text NOT NULL,
	`role` text NOT NULL,
	`csrf` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_idx` ON `demo_sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `session_expiry_idx` ON `demo_sessions` (`expires_at`);