import { demoSnapshot } from "./demo-data";
import type {
  DashboardSnapshot,
  DataIssue,
  QuantRow,
  QuantRun,
  RankingQuery,
  ResearchSnapshot,
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
    const [rowsResult, countResult, sectorsResult, summaryResult, issuesResult] =
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
  };
  const db = await dbBinding();
  if (!db) return empty;
  try {
    const [runs, observations, active, statistics] = await Promise.all([
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
    };
  } catch {
    return empty;
  }
}
