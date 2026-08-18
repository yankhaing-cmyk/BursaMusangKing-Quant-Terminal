CREATE TABLE `app_state` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `daily_scores` (
	`run_id` text NOT NULL,
	`symbol` text NOT NULL,
	`name` text NOT NULL,
	`sector` text NOT NULL,
	`close` real NOT NULL,
	`rank` integer NOT NULL,
	`quant_score` real NOT NULL,
	`trend_score` real NOT NULL,
	`momentum_score` real NOT NULL,
	`relative_strength_score` real NOT NULL,
	`volume_score` real NOT NULL,
	`volatility_score` real NOT NULL,
	`liquidity_score` real NOT NULL,
	`price_structure_score` real NOT NULL,
	`trending_score` real NOT NULL,
	`momentum_strategy_score` real NOT NULL,
	`meta_score` real NOT NULL,
	`strategy_ensemble_score` real NOT NULL,
	`return_20` real,
	`return_60` real,
	`rs_20` real,
	`rs_60` real,
	`sector_rs_20` real,
	`atr_14` real,
	`atr_pct` real,
	`average_traded_value_20` real,
	`volume_ratio_20` real,
	`distance_52_week_high` real,
	`history_days` integer NOT NULL,
	`sector_rs_available` integer DEFAULT false NOT NULL,
	`quality_flags_json` text DEFAULT '[]' NOT NULL,
	`factor_explanation_json` text DEFAULT '{}' NOT NULL,
	PRIMARY KEY(`run_id`, `symbol`),
	FOREIGN KEY (`run_id`) REFERENCES `quant_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`symbol`) REFERENCES `instruments`(`symbol`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `daily_scores_run_rank_uq` ON `daily_scores` (`run_id`,`rank`);--> statement-breakpoint
CREATE INDEX `daily_scores_run_quant_idx` ON `daily_scores` (`run_id`,`quant_score`);--> statement-breakpoint
CREATE INDEX `daily_scores_run_sector_idx` ON `daily_scores` (`run_id`,`sector`);--> statement-breakpoint
CREATE TABLE `data_issues` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` text NOT NULL,
	`severity` text NOT NULL,
	`code` text NOT NULL,
	`symbol` text,
	`field` text,
	`detail` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `quant_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `data_issues_run_severity_idx` ON `data_issues` (`run_id`,`severity`);--> statement-breakpoint
CREATE TABLE `factor_values` (
	`run_id` text NOT NULL,
	`symbol` text NOT NULL,
	`factor_name` text NOT NULL,
	`raw_value` real,
	`normalized_value` real,
	`score` real,
	PRIMARY KEY(`run_id`, `symbol`, `factor_name`),
	FOREIGN KEY (`run_id`) REFERENCES `quant_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `instruments` (
	`symbol` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`sector` text NOT NULL,
	`sector_benchmark` text,
	`board` text,
	`security_type` text DEFAULT 'EQUITY' NOT NULL,
	`listing_date` text,
	`delisting_date` text,
	`active` integer DEFAULT true NOT NULL,
	`suspended` integer DEFAULT false NOT NULL,
	`source_id` text,
	`last_seen_date` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `instruments_sector_idx` ON `instruments` (`sector`);--> statement-breakpoint
CREATE TABLE `quant_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`market_date` text NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`provider` text NOT NULL,
	`model_version` text NOT NULL,
	`payload_hash` text NOT NULL,
	`expected_symbols` integer NOT NULL,
	`received_symbols` integer DEFAULT 0 NOT NULL,
	`valid_symbols` integer NOT NULL,
	`total_instruments` integer NOT NULL,
	`benchmark_date` text NOT NULL,
	`validation_json` text NOT NULL,
	`started_at` text NOT NULL,
	`committed_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `quant_runs_date_hash_uq` ON `quant_runs` (`market_date`,`payload_hash`);--> statement-breakpoint
CREATE INDEX `quant_runs_status_date_idx` ON `quant_runs` (`status`,`market_date`);