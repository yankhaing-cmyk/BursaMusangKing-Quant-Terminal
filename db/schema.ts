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

export const marketRegimes = sqliteTable(
  "market_regimes",
  {
    runId: text("run_id")
      .primaryKey()
      .references(() => quantRuns.id, { onDelete: "cascade" }),
    marketDate: text("market_date").notNull(),
    methodologyVersion: text("methodology_version").notNull(),
    regimeLabel: text("regime_label", {
      enum: [
        "STRONG RISK-ON",
        "RISK-ON",
        "NEUTRAL",
        "RISK-OFF",
        "STRONG RISK-OFF",
      ],
    }).notNull(),
    regimeScore: real("regime_score").notNull(),
    benchmarkClose: real("benchmark_close").notNull(),
    benchmarkSma50: real("benchmark_sma50").notNull(),
    benchmarkSma200: real("benchmark_sma200").notNull(),
    benchmarkSma50Slope20: real("benchmark_sma50_slope20").notNull(),
    benchmarkSma200Slope20: real("benchmark_sma200_slope20").notNull(),
    benchmarkReturn20: real("benchmark_return20").notNull(),
    benchmarkRealizedVolatility20: real("benchmark_realized_volatility20").notNull(),
    breadthAbove20: real("breadth_above20").notNull(),
    breadthAbove50: real("breadth_above50").notNull(),
    breadthAbove200: real("breadth_above200").notNull(),
    breadthMomentum: real("breadth_momentum").notNull(),
    newHighRate: real("new_high_rate").notNull(),
    newLowRate: real("new_low_rate").notNull(),
    volumeParticipationRate: real("volume_participation_rate").notNull(),
    sectorPositiveRate: real("sector_positive_rate").notNull(),
    benchmarkTrendScore: real("benchmark_trend_score").notNull(),
    breadthScore: real("breadth_score").notNull(),
    sectorBreadthScore: real("sector_breadth_score").notNull(),
    participationScore: real("participation_score").notNull(),
    volatilityScore: real("volatility_score").notNull(),
    minimumQuantScore: integer("minimum_quant_score").notNull(),
    maxEquityExposure: real("max_equity_exposure").notNull(),
    newPositionSizeMultiplier: real("new_position_size_multiplier").notNull(),
    minimumCashAllocation: real("minimum_cash_allocation").notNull(),
    maxNewEntries: integer("max_new_entries").notNull(),
    trendWeightMultiplier: real("trend_weight_multiplier").notNull(),
    explanationJson: text("explanation_json").notNull(),
    rowHash: text("row_hash").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("market_regimes_date_methodology_uq").on(
      table.marketDate,
      table.methodologyVersion,
    ),
    index("market_regimes_label_date_idx").on(table.regimeLabel, table.marketDate),
  ],
);

export const tradePublications = sqliteTable(
  "trade_publications",
  {
    runId: text("run_id")
      .primaryKey()
      .references(() => quantRuns.id, { onDelete: "cascade" }),
    status: text("status", {
      enum: ["PENDING", "ACTIVE", "REJECTED"],
    }).notNull().default("PENDING"),
    methodologyVersion: text("methodology_version").notNull(),
    expectedStates: integer("expected_states").notNull(),
    receivedStates: integer("received_states").notNull().default(0),
    statePayloadHash: text("state_payload_hash").notNull(),
    expectedEvents: integer("expected_events").notNull(),
    receivedEvents: integer("received_events").notNull().default(0),
    eventPayloadHash: text("event_payload_hash").notNull(),
    atrStopMultiple: real("atr_stop_multiple").notNull(),
    nearStopAtrMultiple: real("near_stop_atr_multiple").notNull(),
    automaticExecution: integer("automatic_execution", { mode: "boolean" }).notNull().default(false),
    startedAt: text("started_at").notNull(),
    committedAt: text("committed_at"),
  },
  (table) => [index("trade_publications_status_idx").on(table.status)],
);

export const tradeStateSnapshots = sqliteTable(
  "trade_state_snapshots",
  {
    runId: text("run_id")
      .notNull()
      .references(() => quantRuns.id, { onDelete: "cascade" }),
    marketDate: text("market_date").notNull(),
    methodologyVersion: text("methodology_version").notNull(),
    symbol: text("symbol").notNull().references(() => instruments.symbol),
    tradeId: text("trade_id"),
    state: text("state", {
      enum: ["FLAT", "BUY_PENDING", "OPEN", "NEAR_SELL", "CLOSED"],
    }).notNull(),
    signalRunId: text("signal_run_id"),
    signalDate: text("signal_date"),
    signalScoreBucket: text("signal_score_bucket"),
    entryDate: text("entry_date"),
    exitDate: text("exit_date"),
    entryPrice: real("entry_price"),
    exitPrice: real("exit_price"),
    peakClose: real("peak_close"),
    lastClose: real("last_close").notNull(),
    atr14: real("atr14"),
    trailingStop: real("trailing_stop"),
    stopDistancePct: real("stop_distance_pct"),
    unrealizedReturn: real("unrealized_return"),
    quantScore: real("quant_score").notNull(),
    signalQuantScore: real("signal_quant_score"),
    signalRank: integer("signal_rank"),
    regimeLabel: text("regime_label").notNull(),
    expectedEdge20d: real("expected_edge_20d"),
    edgeSampleSize: integer("edge_sample_size").notNull(),
    edgeConfidence: text("edge_confidence", {
      enum: ["INSUFFICIENT", "PROVISIONAL", "ESTABLISHED"],
    }).notNull(),
    reason: text("reason").notNull(),
    rowHash: text("row_hash").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.runId, table.symbol] }),
    index("trade_state_run_state_idx").on(table.runId, table.state),
    index("trade_state_trade_id_idx").on(table.tradeId),
  ],
);

export const tradeEvents = sqliteTable(
  "trade_events",
  {
    eventId: text("event_id").primaryKey(),
    runId: text("run_id").notNull().references(() => quantRuns.id, { onDelete: "cascade" }),
    marketDate: text("market_date").notNull(),
    methodologyVersion: text("methodology_version").notNull(),
    symbol: text("symbol").notNull().references(() => instruments.symbol),
    tradeId: text("trade_id").notNull(),
    eventType: text("event_type", {
      enum: ["SIGNAL", "ENTRY", "NEAR_SELL", "RECOVERED", "EXIT"],
    }).notNull(),
    priorState: text("prior_state").notNull(),
    newState: text("new_state").notNull(),
    eventPrice: real("event_price"),
    quantScore: real("quant_score").notNull(),
    trailingStop: real("trailing_stop"),
    reason: text("reason").notNull(),
    rowHash: text("row_hash").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("trade_events_run_type_idx").on(table.runId, table.eventType),
    index("trade_events_trade_date_idx").on(table.tradeId, table.marketDate),
  ],
);

export const researchPublications = sqliteTable(
  "research_publications",
  {
    computedRunId: text("computed_run_id")
      .primaryKey()
      .references(() => quantRuns.id),
    status: text("status", {
      enum: ["PENDING", "ACTIVE", "REJECTED", "SUPERSEDED"],
    })
      .notNull()
      .default("PENDING"),
    methodologyVersion: text("methodology_version").notNull(),
    expectedObservations: integer("expected_observations").notNull(),
    receivedObservations: integer("received_observations").notNull().default(0),
    payloadHash: text("payload_hash").notNull(),
    startedAt: text("started_at").notNull(),
    committedAt: text("committed_at"),
  },
  (table) => [index("research_publications_status_idx").on(table.status)],
);

export const forwardOutcomes = sqliteTable(
  "forward_outcomes",
  {
    signalRunId: text("signal_run_id").notNull().references(() => quantRuns.id),
    symbol: text("symbol").notNull(),
    signalDate: text("signal_date").notNull(),
    scoreBucket: text("score_bucket").notNull(),
    horizon: integer("horizon").notNull(),
    entryDate: text("entry_date").notNull(),
    exitDate: text("exit_date").notNull(),
    quantScore: real("quant_score").notNull(),
    entryOpen: real("entry_open").notNull(),
    exitClose: real("exit_close").notNull(),
    signalClose: real("signal_close").notNull(),
    forwardReturn: real("forward_return").notNull(),
    signalCloseReturn: real("signal_close_return").notNull(),
    mae: real("mae").notNull(),
    mfe: real("mfe").notNull(),
    computedRunId: text("computed_run_id")
      .notNull()
      .references(() => researchPublications.computedRunId),
    methodologyVersion: text("methodology_version").notNull(),
    observationHash: text("observation_hash").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.signalRunId, table.symbol, table.horizon] }),
    index("forward_outcomes_bucket_horizon_idx").on(table.scoreBucket, table.horizon),
    index("forward_outcomes_computed_run_idx").on(table.computedRunId),
  ],
);

export const researchBucketStats = sqliteTable(
  "research_bucket_stats",
  {
    scoreBucket: text("score_bucket").notNull(),
    horizon: integer("horizon").notNull(),
    sampleSize: integer("sample_size").notNull(),
    averageReturn: real("average_return").notNull(),
    medianReturn: real("median_return").notNull(),
    winRate: real("win_rate").notNull(),
    averageMae: real("average_mae").notNull(),
    averageMfe: real("average_mfe").notNull(),
    standardError: real("standard_error"),
    confidenceLow: real("confidence_low"),
    confidenceHigh: real("confidence_high"),
    profitFactor: real("profit_factor"),
    firstSignalDate: text("first_signal_date").notNull(),
    lastExitDate: text("last_exit_date").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.scoreBucket, table.horizon] })],
);

export const researchRegimeStats = sqliteTable(
  "research_regime_stats",
  {
    regimeLabel: text("regime_label").notNull(),
    horizon: integer("horizon").notNull(),
    sampleSize: integer("sample_size").notNull(),
    averageReturn: real("average_return").notNull(),
    medianReturn: real("median_return").notNull(),
    winRate: real("win_rate").notNull(),
    averageMae: real("average_mae").notNull(),
    averageMfe: real("average_mfe").notNull(),
    standardError: real("standard_error"),
    confidenceLow: real("confidence_low"),
    confidenceHigh: real("confidence_high"),
    profitFactor: real("profit_factor"),
    firstSignalDate: text("first_signal_date").notNull(),
    lastExitDate: text("last_exit_date").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.regimeLabel, table.horizon] })],
);
