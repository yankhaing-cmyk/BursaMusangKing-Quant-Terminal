CREATE TABLE `forward_outcomes` (
	`signal_run_id` text NOT NULL,
	`symbol` text NOT NULL,
	`signal_date` text NOT NULL,
	`score_bucket` text NOT NULL,
	`horizon` integer NOT NULL,
	`entry_date` text NOT NULL,
	`exit_date` text NOT NULL,
	`quant_score` real NOT NULL,
	`entry_open` real NOT NULL,
	`exit_close` real NOT NULL,
	`signal_close` real NOT NULL,
	`forward_return` real NOT NULL,
	`signal_close_return` real NOT NULL,
	`mae` real NOT NULL,
	`mfe` real NOT NULL,
	`computed_run_id` text NOT NULL,
	`methodology_version` text NOT NULL,
	`observation_hash` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`signal_run_id`, `symbol`, `horizon`),
	FOREIGN KEY (`signal_run_id`) REFERENCES `quant_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`computed_run_id`) REFERENCES `research_publications`(`computed_run_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `forward_outcomes_bucket_horizon_idx` ON `forward_outcomes` (`score_bucket`,`horizon`);--> statement-breakpoint
CREATE INDEX `forward_outcomes_computed_run_idx` ON `forward_outcomes` (`computed_run_id`);--> statement-breakpoint
CREATE TABLE `research_bucket_stats` (
	`score_bucket` text NOT NULL,
	`horizon` integer NOT NULL,
	`sample_size` integer NOT NULL,
	`average_return` real NOT NULL,
	`median_return` real NOT NULL,
	`win_rate` real NOT NULL,
	`average_mae` real NOT NULL,
	`average_mfe` real NOT NULL,
	`standard_error` real,
	`confidence_low` real,
	`confidence_high` real,
	`profit_factor` real,
	`first_signal_date` text NOT NULL,
	`last_exit_date` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`score_bucket`, `horizon`)
);
--> statement-breakpoint
CREATE TABLE `research_publications` (
	`computed_run_id` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`methodology_version` text NOT NULL,
	`expected_observations` integer NOT NULL,
	`received_observations` integer DEFAULT 0 NOT NULL,
	`payload_hash` text NOT NULL,
	`started_at` text NOT NULL,
	`committed_at` text,
	FOREIGN KEY (`computed_run_id`) REFERENCES `quant_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `research_publications_status_idx` ON `research_publications` (`status`);