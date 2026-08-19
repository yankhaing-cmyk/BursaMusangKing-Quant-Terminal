CREATE TABLE `trade_events` (
	`event_id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`market_date` text NOT NULL,
	`methodology_version` text NOT NULL,
	`symbol` text NOT NULL,
	`trade_id` text NOT NULL,
	`event_type` text NOT NULL,
	`prior_state` text NOT NULL,
	`new_state` text NOT NULL,
	`event_price` real,
	`quant_score` real NOT NULL,
	`trailing_stop` real,
	`reason` text NOT NULL,
	`row_hash` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `quant_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`symbol`) REFERENCES `instruments`(`symbol`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `trade_events_run_type_idx` ON `trade_events` (`run_id`,`event_type`);--> statement-breakpoint
CREATE INDEX `trade_events_trade_date_idx` ON `trade_events` (`trade_id`,`market_date`);--> statement-breakpoint
CREATE TABLE `trade_publications` (
	`run_id` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`methodology_version` text NOT NULL,
	`expected_states` integer NOT NULL,
	`received_states` integer DEFAULT 0 NOT NULL,
	`state_payload_hash` text NOT NULL,
	`expected_events` integer NOT NULL,
	`received_events` integer DEFAULT 0 NOT NULL,
	`event_payload_hash` text NOT NULL,
	`atr_stop_multiple` real NOT NULL,
	`near_stop_atr_multiple` real NOT NULL,
	`automatic_execution` integer DEFAULT false NOT NULL,
	`started_at` text NOT NULL,
	`committed_at` text,
	FOREIGN KEY (`run_id`) REFERENCES `quant_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `trade_publications_status_idx` ON `trade_publications` (`status`);--> statement-breakpoint
CREATE TABLE `trade_state_snapshots` (
	`run_id` text NOT NULL,
	`market_date` text NOT NULL,
	`methodology_version` text NOT NULL,
	`symbol` text NOT NULL,
	`trade_id` text,
	`state` text NOT NULL,
	`signal_run_id` text,
	`signal_date` text,
	`signal_score_bucket` text,
	`entry_date` text,
	`exit_date` text,
	`entry_price` real,
	`exit_price` real,
	`peak_close` real,
	`last_close` real NOT NULL,
	`atr14` real,
	`trailing_stop` real,
	`stop_distance_pct` real,
	`unrealized_return` real,
	`quant_score` real NOT NULL,
	`signal_quant_score` real,
	`signal_rank` integer,
	`regime_label` text NOT NULL,
	`expected_edge_20d` real,
	`edge_sample_size` integer NOT NULL,
	`edge_confidence` text NOT NULL,
	`reason` text NOT NULL,
	`row_hash` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`run_id`, `symbol`),
	FOREIGN KEY (`run_id`) REFERENCES `quant_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`symbol`) REFERENCES `instruments`(`symbol`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `trade_state_run_state_idx` ON `trade_state_snapshots` (`run_id`,`state`);--> statement-breakpoint
CREATE INDEX `trade_state_trade_id_idx` ON `trade_state_snapshots` (`trade_id`);