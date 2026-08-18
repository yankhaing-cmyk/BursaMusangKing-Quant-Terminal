import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const instruments = sqliteTable(
  "instruments",
  {
    symbol: text("symbol").primaryKey(),
    name: text("name").notNull(),
    sector: text("sector").notNull(),
    sectorBenchmark: text("sector_benchmark"),
    board: text("board"),
    securityType: text("security_type").notNull().default("EQUITY"),
    listingDate: text("listing_date"),
    delistingDate: text("delisting_date"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    suspended: integer("suspended", { mode: "boolean" }).notNull().default(false),
    sourceId: text("source_id"),
    lastSeenDate: text("last_seen_date").notNull(),
  },
  (table) => [index("instruments_sector_idx").on(table.sector)],
);

export const quantRuns = sqliteTable(
  "quant_runs",
  {
    id: text("id").primaryKey(),
    marketDate: text("market_date").notNull(),
    status: text("status", {
      enum: ["PENDING", "ACTIVE", "REJECTED", "SUPERSEDED"],
    })
      .notNull()
      .default("PENDING"),
    provider: text("provider").notNull(),
    modelVersion: text("model_version").notNull(),
    payloadHash: text("payload_hash").notNull(),
    expectedSymbols: integer("expected_symbols").notNull(),
    receivedSymbols: integer("received_symbols").notNull().default(0),
    validSymbols: integer("valid_symbols").notNull(),
    totalInstruments: integer("total_instruments").notNull(),
    benchmarkDate: text("benchmark_date").notNull(),
    validationJson: text("validation_json").notNull(),
    startedAt: text("started_at").notNull(),
    committedAt: text("committed_at"),
  },
  (table) => [
    uniqueIndex("quant_runs_date_hash_uq").on(
      table.marketDate,
      table.payloadHash,
    ),
    index("quant_runs_status_date_idx").on(table.status, table.marketDate),
  ],
);

export const dailyScores = sqliteTable(
  "daily_scores",
  {
    runId: text("run_id")
      .notNull()
      .references(() => quantRuns.id, { onDelete: "cascade" }),
    symbol: text("symbol")
      .notNull()
      .references(() => instruments.symbol),
    name: text("name").notNull(),
    sector: text("sector").notNull(),
    close: real("close").notNull(),
    rank: integer("rank").notNull(),
    quantScore: real("quant_score").notNull(),
    trendScore: real("trend_score").notNull(),
    momentumScore: real("momentum_score").notNull(),
    relativeStrengthScore: real("relative_strength_score").notNull(),
    volumeScore: real("volume_score").notNull(),
    volatilityScore: real("volatility_score").notNull(),
    liquidityScore: real("liquidity_score").notNull(),
    priceStructureScore: real("price_structure_score").notNull(),
    trendingScore: real("trending_score").notNull(),
    momentumStrategyScore: real("momentum_strategy_score").notNull(),
    metaScore: real("meta_score").notNull(),
    strategyEnsembleScore: real("strategy_ensemble_score").notNull(),
    return20: real("return_20"),
    return60: real("return_60"),
    rs20: real("rs_20"),
    rs60: real("rs_60"),
    sectorRs20: real("sector_rs_20"),
    atr14: real("atr_14"),
    atrPct: real("atr_pct"),
    averageTradedValue20: real("average_traded_value_20"),
    volumeRatio20: real("volume_ratio_20"),
    distance52WeekHigh: real("distance_52_week_high"),
    historyDays: integer("history_days").notNull(),
    sectorRsAvailable: integer("sector_rs_available", { mode: "boolean" })
      .notNull()
      .default(false),
    qualityFlagsJson: text("quality_flags_json").notNull().default("[]"),
    factorExplanationJson: text("factor_explanation_json")
      .notNull()
      .default("{}"),
    rowHash: text("row_hash").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.runId, table.symbol] }),
    uniqueIndex("daily_scores_run_rank_uq").on(table.runId, table.rank),
    index("daily_scores_run_quant_idx").on(table.runId, table.quantScore),
    index("daily_scores_run_sector_idx").on(table.runId, table.sector),
  ],
);

export const factorValues = sqliteTable(
  "factor_values",
  {
    runId: text("run_id")
      .notNull()
      .references(() => quantRuns.id, { onDelete: "cascade" }),
    symbol: text("symbol").notNull(),
    factorName: text("factor_name").notNull(),
    rawValue: real("raw_value"),
    normalizedValue: real("normalized_value"),
    score: real("score"),
  },
  (table) => [
    primaryKey({ columns: [table.runId, table.symbol, table.factorName] }),
  ],
);

export const dataIssues = sqliteTable(
  "data_issues",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    runId: text("run_id")
      .notNull()
      .references(() => quantRuns.id, { onDelete: "cascade" }),
    severity: text("severity", { enum: ["WARNING", "CRITICAL"] }).notNull(),
    code: text("code").notNull(),
    symbol: text("symbol"),
    field: text("field"),
    detail: text("detail").notNull(),
  },
  (table) => [index("data_issues_run_severity_idx").on(table.runId, table.severity)],
);

export const appState = sqliteTable("app_state", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull(),
});
