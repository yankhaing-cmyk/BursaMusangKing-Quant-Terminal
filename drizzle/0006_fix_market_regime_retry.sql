DROP INDEX IF EXISTS `market_regimes_date_methodology_uq`;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `market_regimes_date_methodology_idx`
ON `market_regimes` (`market_date`,`methodology_version`);
