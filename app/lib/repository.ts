import { demoSnapshot } from "./demo-data";
import type {
  DashboardSnapshot,
  DataIssue,
  MarketRegime,
  MarketRegimeLabel,
  PortfolioAllocation,
  PortfolioSnapshot,
  QuantRow,
  QuantRun,
  RankingQuery,
  ResearchSnapshot,
  TradeEvent,
  TradeSnapshot,
  TradeState,
  TradeStateName,
} from "./types";
import { RESEARCH_METHODOLOGY } from "./research-ingest";

type RuntimeEnv = { DB?: D1Database };

const sortColumns = {
  score: "quant_score",
  trend: "trend_score",
  momentum: "momentum_score",
  rs: "relative_strength_score",
  liquidity: "liquidity_score",
  symbol: "symbol",
} as const;

async function dbBinding(): Promise<D1Database | null> {
  try {
    const cloudflare = await import("cloudflare:workers");
    return (cloudflare.env as unknown as RuntimeEnv).DB ?? null;
  } catch {
    return null;
  }
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function mapRow(row: Record<string, unknown>): QuantRow {
  const number = (key: string) => Number(row[key]);
  const nullable = (key: string) =>
    row[key] === null || row[key] === undefined ? null : Number(row[key]);
  return {
    symbol: String(row.symbol),
    name: String(row.name),
    sector: String(row.sector),
    close: number("close"),
    rank: number("rank"),
    quantScore: number("quant_score"),
    trendScore: number("trend_score"),
    momentumScore: number("momentum_score"),
    relativeStrengthScore: number("relative_strength_score"),
    volumeScore: number("volume_score"),
    volatilityScore: number("volatility_score"),
    liquidityScore: number("liquidity_score"),
    priceStructureScore: number("price_structure_score"),
    trendingScore: number("trending_score"),
    momentumStrategyScore: number("momentum_strategy_score"),
    metaScore: number("meta_score"),
    strategyEnsembleScore: number("strategy_ensemble_score"),
    return20: nullable("return_20"),
    return60: nullable("return_60"),
    rs20: nullable("rs_20"),
    rs60: nullable("rs_60"),
    sectorRs20: nullable("sector_rs_20"),
    atr14: nullable("atr_14"),
    atrPct: nullable("atr_pct"),
    averageTradedValue20: nullable("average_traded_value_20"),
    volumeRatio20: nullable("volume_ratio_20"),
    distance52WeekHigh: nullable("distance_52_week_high"),
    historyDays: number("history_days"),
    sectorRsAvailable: Boolean(row.sector_rs_available),
    qualityFlags: parseJson<string[]>(row.quality_flags_json, []),
    factorExplanation: parseJson<Record<string, string>>(
      row.factor_explanation_json,
      {},
    ),
  };
}

function mapRun(row: Record<string, unknown>): QuantRun {
  return {
    id: String(row.id),
    marketDate: String(row.market_date),
    status: "ACTIVE",
    provider: String(row.provider),
    modelVersion: String(row.model_version),
    payloadHash: String(row.payload_hash),
    validSymbols: Number(row.valid_symbols),
    totalInstruments: Number(row.total_instruments),
    benchmarkDate: String(row.benchmark_date),
    committedAt: row.committed_at ? String(row.committed_at) : null,
  };
}

function mapRegime(row: Record<string, unknown>): MarketRegime {
  const number = (key: string) => Number(row[key]);
  return {
    runId: String(row.run_id),
    marketDate: String(row.market_date),
    methodologyVersion: String(row.methodology_version),
    label: String(row.regime_label) as MarketRegimeLabel,
    score: number("regime_score"),
    benchmarkClose: number("benchmark_close"),
    benchmarkSma50: number("benchmark_sma50"),
    benchmarkSma200: number("benchmark_sma200"),
    benchmarkSma50Slope20: number("benchmark_sma50_slope20"),
    benchmarkSma200Slope20: number("benchmark_sma200_slope20"),
    benchmarkReturn20: number("benchmark_return20"),
    benchmarkRealizedVolatility20: number("benchmark_realized_volatility20"),
    breadthAbove20: number("breadth_above20"),
    breadthAbove50: number("breadth_above50"),
    breadthAbove200: number("breadth_above200"),
    breadthMomentum: number("breadth_momentum"),
    newHighRate: number("new_high_rate"),
    newLowRate: number("new_low_rate"),
    volumeParticipationRate: number("volume_participation_rate"),
    sectorPositiveRate: number("sector_positive_rate"),
    benchmarkTrendScore: number("benchmark_trend_score"),
    breadthScore: number("breadth_score"),
    sectorBreadthScore: number("sector_breadth_score"),
    participationScore: number("participation_score"),
    volatilityScore: number("volatility_score"),
    minimumQuantScore: number("minimum_quant_score"),
    maxEquityExposure: number("max_equity_exposure"),
    newPositionSizeMultiplier: number("new_position_size_multiplier"),
    minimumCashAllocation: number("minimum_cash_allocation"),
    maxNewEntries: number("max_new_entries"),
    trendWeightMultiplier: number("trend_weight_multiplier"),
    explanation: parseJson<Record<string, string>>(row.explanation_json, {}),
  };
}

export async function getDashboardSnapshot(
  query: RankingQuery = {},
): Promise<DashboardSnapshot> {
  const db = await dbBinding();
  if (!db) return demoSnapshot;

  try {
    const active = await db
      .prepare(
        `SELECT qr.* FROM app_state s
         JOIN quant_runs qr ON qr.id = s.value
         WHERE s.key = 'active_run_id' AND qr.status = 'ACTIVE'
         LIMIT 1`,
      )
      .first<Record<string, unknown>>();
    if (!active) return demoSnapshot;

    const run = mapRun(active);
    const page = Math.max(1, Math.floor(query.page ?? 1));
    const pageSize = Math.min(100, Math.max(10, Math.floor(query.pageSize ?? 50)));
    const minimumScore = Math.min(100, Math.max(0, query.minimumScore ?? 0));
    const search = (query.search ?? "").trim().slice(0, 60);
    const sector = (query.sector ?? "").trim().slice(0, 80);
    const sort = sortColumns[query.sort ?? "score"];
    const direction = query.direction === "asc" ? "ASC" : "DESC";

    const where: string[] = ["run_id = ?", "quant_score >= ?"];
    const bindings: unknown[] = [run.id, minimumScore];
    if (search) {
      where.push("(symbol LIKE ? OR name LIKE ?)");
      bindings.push(`%${search}%`, `%${search}%`);
    }
    if (sector) {
      where.push("sector = ?");
      bindings.push(sector);
    }

    const whereSql = where.join(" AND ");
    const [rowsResult, countResult, sectorsResult, summaryResult, issuesResult, regimeResult] =
      await Promise.all([
        db
          .prepare(
            `SELECT * FROM daily_scores WHERE ${whereSql}
             ORDER BY ${sort} ${direction}, symbol ASC LIMIT ? OFFSET ?`,
          )
          .bind(...bindings, pageSize, (page - 1) * pageSize)
          .all<Record<string, unknown>>(),
        db
          .prepare(`SELECT COUNT(*) AS count FROM daily_scores WHERE ${whereSql}`)
          .bind(...bindings)
          .first<{ count: number }>(),
        db
          .prepare(
            "SELECT DISTINCT sector FROM daily_scores WHERE run_id = ? ORDER BY sector",
          )
          .bind(run.id)
          .all<{ sector: string }>(),
        db
          .prepare(
            `SELECT AVG(quant_score) AS average_score,
                    SUM(CASE WHEN quant_score >= 80 THEN 1 ELSE 0 END) AS high_count
             FROM daily_scores WHERE run_id = ?`,
          )
          .bind(run.id)
          .first<{ average_score: number; high_count: number }>(),
        db
          .prepare(
            `SELECT severity, code, symbol, detail FROM data_issues
             WHERE run_id = ? ORDER BY severity DESC, id ASC LIMIT 20`,
          )
          .bind(run.id)
          .all<DataIssue>(),
        db
          .prepare("SELECT * FROM market_regimes WHERE run_id = ? LIMIT 1")
          .bind(run.id)
          .first<Record<string, unknown>>(),
      ]);

    return {
      mode: "LIVE",
      run,
      rows: rowsResult.results.map((row) => mapRow(row)),
      totalRows: Number(countResult?.count ?? 0),
      sectors: sectorsResult.results.map((row) => row.sector),
      universeMeanScore:
        summaryResult?.average_score === null ||
        summaryResult?.average_score === undefined
          ? null
          : Number(summaryResult.average_score),
      highScoreCount: Number(summaryResult?.high_count ?? 0),
      issues: issuesResult.results,
      marketRegime: regimeResult ? mapRegime(regimeResult) : null,
    };
  } catch {
    return demoSnapshot;
  }
}

export async function getStock(symbol: string): Promise<QuantRow | null> {
  const db = await dbBinding();
  if (!db) {
    return (
      demoSnapshot.rows.find((row) => row.symbol === symbol.toUpperCase()) ?? null
    );
  }
  try {
    const row = await db
      .prepare(
        `SELECT ds.* FROM app_state s
         JOIN daily_scores ds ON ds.run_id = s.value
         WHERE s.key = 'active_run_id' AND ds.symbol = ? LIMIT 1`,
      )
      .bind(symbol.toUpperCase())
      .first<Record<string, unknown>>();
    return row ? mapRow(row) : null;
  } catch {
    return null;
  }
}

export async function getResearchSnapshot(): Promise<ResearchSnapshot> {
  const empty: ResearchSnapshot = {
    methodologyVersion: RESEARCH_METHODOLOGY,
    scoreDates: 0,
    observationCount: 0,
    latestResearchRunId: null,
    latestResearchAt: null,
    minimumSample: 30,
    establishedSample: 100,
    statistics: [],
    regimeStatistics: [],
  };
  const db = await dbBinding();
  if (!db) return empty;
  try {
    const [runs, observations, active, statistics, regimeStatistics] = await Promise.all([
      db
        .prepare("SELECT COUNT(*) AS count FROM quant_runs WHERE status IN ('ACTIVE', 'SUPERSEDED')")
        .first<{ count: number }>(),
      db.prepare("SELECT COUNT(*) AS count FROM forward_outcomes").first<{ count: number }>(),
      db
        .prepare(
          `SELECT rp.computed_run_id, rp.methodology_version, rp.committed_at
           FROM app_state state JOIN research_publications rp ON rp.computed_run_id = state.value
           WHERE state.key = 'research_run_id' AND rp.status = 'ACTIVE' LIMIT 1`,
        )
        .first<{ computed_run_id: string; methodology_version: string; committed_at: string | null }>(),
      db
        .prepare(
          `SELECT * FROM research_bucket_stats
           ORDER BY CASE score_bucket
             WHEN '95-100' THEN 1 WHEN '90-94' THEN 2 WHEN '85-89' THEN 3
             WHEN '80-84' THEN 4 WHEN '70-79' THEN 5 WHEN '60-69' THEN 6
             WHEN '50-59' THEN 7 ELSE 8 END, horizon`,
        )
        .all<Record<string, unknown>>(),
      db
        .prepare(
          `SELECT * FROM research_regime_stats
           ORDER BY CASE regime_label
             WHEN 'STRONG RISK-ON' THEN 1 WHEN 'RISK-ON' THEN 2
             WHEN 'NEUTRAL' THEN 3 WHEN 'RISK-OFF' THEN 4 ELSE 5 END, horizon`,
        )
        .all<Record<string, unknown>>(),
    ]);
    return {
      methodologyVersion: active?.methodology_version ?? RESEARCH_METHODOLOGY,
      scoreDates: Number(runs?.count ?? 0),
      observationCount: Number(observations?.count ?? 0),
      latestResearchRunId: active?.computed_run_id ?? null,
      latestResearchAt: active?.committed_at ?? null,
      minimumSample: 30,
      establishedSample: 100,
      statistics: statistics.results.map((row) => ({
        scoreBucket: String(row.score_bucket),
        horizon: Number(row.horizon),
        sampleSize: Number(row.sample_size),
        averageReturn: Number(row.average_return),
        medianReturn: Number(row.median_return),
        winRate: Number(row.win_rate),
        averageMae: Number(row.average_mae),
        averageMfe: Number(row.average_mfe),
        standardError: row.standard_error === null ? null : Number(row.standard_error),
        confidenceLow: row.confidence_low === null ? null : Number(row.confidence_low),
        confidenceHigh: row.confidence_high === null ? null : Number(row.confidence_high),
        profitFactor: row.profit_factor === null ? null : Number(row.profit_factor),
        firstSignalDate: String(row.first_signal_date),
        lastExitDate: String(row.last_exit_date),
        updatedAt: String(row.updated_at),
      })),
      regimeStatistics: regimeStatistics.results.map((row) => ({
        regimeLabel: String(row.regime_label) as MarketRegimeLabel,
        horizon: Number(row.horizon),
        sampleSize: Number(row.sample_size),
        averageReturn: Number(row.average_return),
        medianReturn: Number(row.median_return),
        winRate: Number(row.win_rate),
        averageMae: Number(row.average_mae),
        averageMfe: Number(row.average_mfe),
        standardError: row.standard_error === null ? null : Number(row.standard_error),
        confidenceLow: row.confidence_low === null ? null : Number(row.confidence_low),
        confidenceHigh: row.confidence_high === null ? null : Number(row.confidence_high),
        profitFactor: row.profit_factor === null ? null : Number(row.profit_factor),
        firstSignalDate: String(row.first_signal_date),
        lastExitDate: String(row.last_exit_date),
        updatedAt: String(row.updated_at),
      })),
    };
  } catch {
    return empty;
  }
}

function mapTradeState(row: Record<string, unknown>): TradeState {
  const nullable = (key: string) => row[key] === null || row[key] === undefined ? null : Number(row[key]);
  return {
    runId: String(row.run_id),
    marketDate: String(row.market_date),
    methodologyVersion: String(row.methodology_version),
    symbol: String(row.symbol),
    name: String(row.name),
    sector: String(row.sector),
    tradeId: row.trade_id ? String(row.trade_id) : null,
    state: String(row.state) as TradeStateName,
    signalDate: row.signal_date ? String(row.signal_date) : null,
    signalScoreBucket: row.signal_score_bucket ? String(row.signal_score_bucket) : null,
    entryDate: row.entry_date ? String(row.entry_date) : null,
    exitDate: row.exit_date ? String(row.exit_date) : null,
    entryPrice: nullable("entry_price"),
    exitPrice: nullable("exit_price"),
    peakClose: nullable("peak_close"),
    lastClose: Number(row.last_close),
    atr14: nullable("atr14"),
    trailingStop: nullable("trailing_stop"),
    stopDistancePct: nullable("stop_distance_pct"),
    unrealizedReturn: nullable("unrealized_return"),
    quantScore: Number(row.quant_score),
    signalQuantScore: nullable("signal_quant_score"),
    signalRank: row.signal_rank === null || row.signal_rank === undefined ? null : Number(row.signal_rank),
    regimeLabel: String(row.regime_label) as MarketRegimeLabel,
    expectedEdge20d: nullable("expected_edge_20d"),
    edgeSampleSize: Number(row.edge_sample_size),
    edgeConfidence: String(row.edge_confidence) as TradeState["edgeConfidence"],
    reason: String(row.reason),
  };
}

function mapTradeEvent(row: Record<string, unknown>): TradeEvent {
  return {
    eventId: String(row.event_id),
    runId: String(row.run_id),
    marketDate: String(row.market_date),
    symbol: String(row.symbol),
    name: String(row.name),
    tradeId: String(row.trade_id),
    eventType: String(row.event_type) as TradeEvent["eventType"],
    priorState: String(row.prior_state) as TradeStateName,
    newState: String(row.new_state) as TradeStateName,
    eventPrice: row.event_price === null ? null : Number(row.event_price),
    quantScore: Number(row.quant_score),
    trailingStop: row.trailing_stop === null ? null : Number(row.trailing_stop),
    reason: String(row.reason),
  };
}

export async function getTradeSnapshot(): Promise<TradeSnapshot> {
  const empty: TradeSnapshot = {
    status: "AWAITING_RUN",
    methodologyVersion: "trade-v1.0.0",
    marketDate: null,
    automaticExecution: false,
    atrStopMultiple: 3,
    nearStopAtrMultiple: 1,
    stateCounts: { FLAT: 0, BUY_PENDING: 0, OPEN: 0, NEAR_SELL: 0, CLOSED: 0 },
    states: [],
    events: [],
  };
  const db = await dbBinding();
  if (!db) return empty;
  try {
    const publication = await db
      .prepare(
        `SELECT tp.*, qr.market_date FROM app_state state
         JOIN quant_runs qr ON qr.id = state.value
         JOIN trade_publications tp ON tp.run_id = qr.id
         WHERE state.key = 'active_run_id' AND qr.status = 'ACTIVE'
           AND tp.status = 'ACTIVE' AND tp.automatic_execution = 0
         LIMIT 1`,
      )
      .first<Record<string, unknown>>();
    if (!publication) return empty;
    const runId = String(publication.run_id);
    const [states, events, counts] = await Promise.all([
      db
        .prepare(
          `SELECT snapshot.*, instrument.name, instrument.sector
           FROM trade_state_snapshots snapshot
           JOIN instruments instrument ON instrument.symbol = snapshot.symbol
           WHERE snapshot.run_id = ? AND snapshot.state <> 'FLAT'
           ORDER BY CASE snapshot.state
             WHEN 'NEAR_SELL' THEN 1 WHEN 'BUY_PENDING' THEN 2
             WHEN 'OPEN' THEN 3 WHEN 'CLOSED' THEN 4 ELSE 5 END,
             snapshot.stop_distance_pct ASC, snapshot.quant_score DESC`,
        )
        .bind(runId)
        .all<Record<string, unknown>>(),
      db
        .prepare(
          `SELECT event.*, instrument.name FROM trade_events event
           JOIN instruments instrument ON instrument.symbol = event.symbol
           WHERE event.run_id = ?
           ORDER BY CASE event.event_type
             WHEN 'EXIT' THEN 1 WHEN 'NEAR_SELL' THEN 2 WHEN 'ENTRY' THEN 3
             WHEN 'SIGNAL' THEN 4 ELSE 5 END, event.symbol LIMIT 100`,
        )
        .bind(runId)
        .all<Record<string, unknown>>(),
      db
        .prepare(
          `SELECT state, COUNT(*) AS count FROM trade_state_snapshots
           WHERE run_id = ? GROUP BY state`,
        )
        .bind(runId)
        .all<{ state: TradeStateName; count: number }>(),
    ]);
    const stateCounts = { ...empty.stateCounts };
    for (const row of counts.results) stateCounts[row.state] = Number(row.count);
    return {
      status: "ACTIVE",
      methodologyVersion: String(publication.methodology_version),
      marketDate: String(publication.market_date),
      automaticExecution: false,
      atrStopMultiple: Number(publication.atr_stop_multiple),
      nearStopAtrMultiple: Number(publication.near_stop_atr_multiple),
      stateCounts,
      states: states.results.map(mapTradeState),
      events: events.results.map(mapTradeEvent),
    };
  } catch {
    return empty;
  }
}

function mapPortfolioAllocation(row: Record<string, unknown>): PortfolioAllocation {
  return {
    runId: String(row.run_id),
    marketDate: String(row.market_date),
    methodologyVersion: String(row.methodology_version),
    symbol: String(row.symbol),
    name: String(row.name),
    tradeId: String(row.trade_id),
    tradeState: row.trade_state as PortfolioAllocation["tradeState"],
    sector: String(row.sector),
    quantScore: Number(row.quant_score),
    lastClose: Number(row.last_close),
    atrPct: Number(row.atr_pct),
    stopDistancePct: Number(row.stop_distance_pct),
    averageTradedValue20: Number(row.average_traded_value_20),
    scoreMultiplier: Number(row.score_multiplier),
    volatilityMultiplier: Number(row.volatility_multiplier),
    liquidityMultiplier: Number(row.liquidity_multiplier),
    correlationMultiplier: Number(row.correlation_multiplier),
    targetWeight: Number(row.target_weight),
    riskBudget: Number(row.risk_budget),
    riskContribution: Number(row.risk_contribution),
    volatilityContribution: row.volatility_contribution === null ? null : Number(row.volatility_contribution),
    beta: row.beta === null ? null : Number(row.beta),
    correlationCluster: String(row.correlation_cluster),
    sectorCapApplied: Boolean(row.sector_cap_applied),
    flags: parseJson<string[]>(row.flags_json, []),
  };
}

export async function getPortfolioSnapshot(): Promise<PortfolioSnapshot> {
  const empty: PortfolioSnapshot = {
    status: "AWAITING_RUN",
    methodologyVersion: "portfolio-v1.0.0",
    marketDate: null,
    regimeLabel: null,
    automaticExecution: false,
    maxEquityExposure: 0,
    minimumCashAllocation: 1,
    maxPortfolioRisk: 0,
    positionCap: 0.06,
    sectorCap: 0.25,
    correlationThreshold: 0.75,
    positionCount: 0,
    capitalDeployed: 0,
    cashAllocation: 1,
    portfolioRisk: 0,
    largestPosition: 0,
    top5Concentration: 0,
    portfolioQuantScore: null,
    portfolioBeta: null,
    expectedVolatility: null,
    sectorExposure: {},
    correlationClusters: {},
    allocations: [],
  };
  const db = await dbBinding();
  if (!db) return empty;
  try {
    const publication = await db
      .prepare(
        `SELECT pp.*, qr.market_date FROM app_state state
         JOIN quant_runs qr ON qr.id = state.value
         JOIN portfolio_publications pp ON pp.run_id = qr.id
         WHERE state.key = 'active_run_id' AND qr.status = 'ACTIVE'
           AND pp.status = 'ACTIVE' AND pp.summary_received = 1
           AND pp.automatic_execution = 0 LIMIT 1`,
      )
      .first<Record<string, unknown>>();
    if (!publication) return empty;
    const runId = String(publication.run_id);
    const allocations = await db
      .prepare(
        `SELECT allocation.*, instrument.name
         FROM portfolio_allocations allocation
         JOIN instruments instrument ON instrument.symbol = allocation.symbol
         WHERE allocation.run_id = ?
         ORDER BY allocation.risk_contribution DESC, allocation.target_weight DESC,
                  allocation.symbol`,
      )
      .bind(runId)
      .all<Record<string, unknown>>();
    return {
      status: "ACTIVE",
      methodologyVersion: String(publication.methodology_version),
      marketDate: String(publication.market_date),
      regimeLabel: publication.regime_label as MarketRegimeLabel,
      automaticExecution: false,
      maxEquityExposure: Number(publication.max_equity_exposure),
      minimumCashAllocation: Number(publication.minimum_cash_allocation),
      maxPortfolioRisk: Number(publication.max_portfolio_risk),
      positionCap: Number(publication.position_cap),
      sectorCap: Number(publication.sector_cap),
      correlationThreshold: Number(publication.correlation_threshold),
      positionCount: Number(publication.position_count),
      capitalDeployed: Number(publication.capital_deployed),
      cashAllocation: Number(publication.cash_allocation),
      portfolioRisk: Number(publication.portfolio_risk),
      largestPosition: Number(publication.largest_position),
      top5Concentration: Number(publication.top5_concentration),
      portfolioQuantScore: publication.portfolio_quant_score === null ? null : Number(publication.portfolio_quant_score),
      portfolioBeta: publication.portfolio_beta === null ? null : Number(publication.portfolio_beta),
      expectedVolatility: publication.expected_volatility === null ? null : Number(publication.expected_volatility),
      sectorExposure: parseJson<Record<string, number>>(publication.sector_exposure_json, {}),
      correlationClusters: parseJson<Record<string, string[]>>(publication.correlation_clusters_json, {}),
      allocations: allocations.results.map(mapPortfolioAllocation),
    };
  } catch {
    return empty;
  }
}
