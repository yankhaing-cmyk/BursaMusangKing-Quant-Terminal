import { canonicalOutcome } from "@/shared/canonical-outcome.mjs";
import { isValidBursaSymbol } from "@/shared/bursa-symbol.mjs";
import { isHash, isIsoDate, sha256Hex } from "@/app/lib/ingest";

export const RESEARCH_HORIZONS = [5, 10, 20, 60] as const;
export const RESEARCH_BUCKETS = [
  "0-49",
  "50-59",
  "60-69",
  "70-79",
  "80-84",
  "85-89",
  "90-94",
  "95-100",
] as const;
export const RESEARCH_METHODOLOGY = "next-open-v1.0.0";

export type ResearchOutcomePayload = {
  signal_run_id: string;
  symbol: string;
  signal_date: string;
  score_bucket: string;
  horizon: number;
  entry_date: string;
  exit_date: string;
  quant_score: number;
  entry_open: number;
  exit_close: number;
  signal_close: number;
  forward_return: number;
  signal_close_return: number;
  mae: number;
  mfe: number;
  computed_run_id: string;
  methodology_version: string;
  observation_hash: string;
};

export function scoreBucket(score: number): string {
  if (score < 50) return "0-49";
  if (score < 60) return "50-59";
  if (score < 70) return "60-69";
  if (score < 80) return "70-79";
  if (score < 85) return "80-84";
  if (score < 90) return "85-89";
  if (score < 95) return "90-94";
  return "95-100";
}

function closeEnough(left: number, right: number, tolerance = 1e-7): boolean {
  return Math.abs(left - right) <= tolerance * Math.max(1, Math.abs(left), Math.abs(right));
}

export async function validateResearchOutcome(
  row: ResearchOutcomePayload,
): Promise<string | null> {
  if (!/^[A-Za-z0-9._:-]{8,100}$/.test(row.signal_run_id ?? "")) return "invalid_signal_run_id";
  if (!/^[A-Za-z0-9._:-]{8,100}$/.test(row.computed_run_id ?? "")) return "invalid_computed_run_id";
  if (!isValidBursaSymbol(row.symbol)) return "invalid_symbol";
  if (![row.signal_date, row.entry_date, row.exit_date].every(isIsoDate)) return "invalid_date";
  if (!(row.signal_date < row.entry_date && row.entry_date <= row.exit_date)) return "invalid_date_order";
  if (!RESEARCH_HORIZONS.includes(row.horizon as (typeof RESEARCH_HORIZONS)[number])) return "invalid_horizon";
  if (row.methodology_version !== RESEARCH_METHODOLOGY) return "unsupported_methodology";
  if (!Number.isFinite(row.quant_score) || row.quant_score < 0 || row.quant_score > 100) return "invalid_quant_score";
  if (row.score_bucket !== scoreBucket(row.quant_score)) return "score_bucket_mismatch";
  const prices = [row.entry_open, row.exit_close, row.signal_close];
  if (prices.some((value) => !Number.isFinite(value) || value <= 0)) return "invalid_price";
  const returns = [row.forward_return, row.signal_close_return, row.mae, row.mfe];
  if (returns.some((value) => !Number.isFinite(value) || value < -1 || value > 100)) return "invalid_return";
  if (row.mae > 0 || row.mfe < 0 || row.mae > row.forward_return || row.forward_return > row.mfe) {
    return "invalid_excursion";
  }
  if (!closeEnough(row.forward_return, row.exit_close / row.entry_open - 1)) return "forward_return_mismatch";
  if (!closeEnough(row.signal_close_return, row.exit_close / row.signal_close - 1)) return "signal_return_mismatch";
  if (!isHash(row.observation_hash)) return "invalid_observation_hash";
  return (await sha256Hex(canonicalOutcome(row as unknown as Record<string, unknown>))) === row.observation_hash
    ? null
    : "observation_hash_mismatch";
}

export async function refreshResearchBucketStats(
  db: D1Database,
  groups: Array<{ score_bucket: string; horizon: number }>,
): Promise<void> {
  const unique = new Map(groups.map((group) => [`${group.score_bucket}:${group.horizon}`, group]));
  const updatedAt = new Date().toISOString();
  for (const group of unique.values()) {
    const summary = await db
      .prepare(
        `SELECT COUNT(*) AS sample_size,
                AVG(forward_return) AS average_return,
                AVG(mae) AS average_mae,
                AVG(mfe) AS average_mfe,
                SUM(forward_return * forward_return) AS sum_squares,
                SUM(CASE WHEN forward_return > 0 THEN 1 ELSE 0 END) AS wins,
                SUM(CASE WHEN forward_return > 0 THEN forward_return ELSE 0 END) AS gross_profit,
                SUM(CASE WHEN forward_return < 0 THEN -forward_return ELSE 0 END) AS gross_loss,
                MIN(signal_date) AS first_signal_date,
                MAX(exit_date) AS last_exit_date
         FROM forward_outcomes WHERE score_bucket = ? AND horizon = ?`,
      )
      .bind(group.score_bucket, group.horizon)
      .first<Record<string, number | string | null>>();
    const median = await db
      .prepare(
        `WITH ordered AS (
           SELECT forward_return,
                  ROW_NUMBER() OVER (ORDER BY forward_return) AS row_number,
                  COUNT(*) OVER () AS total_rows
           FROM forward_outcomes WHERE score_bucket = ? AND horizon = ?
         )
         SELECT AVG(forward_return) AS median_return FROM ordered
         WHERE row_number IN ((total_rows + 1) / 2, (total_rows + 2) / 2)`,
      )
      .bind(group.score_bucket, group.horizon)
      .first<{ median_return: number | null }>();
    const sampleSize = Number(summary?.sample_size ?? 0);
    if (!sampleSize || median?.median_return === null || median?.median_return === undefined) continue;
    const average = Number(summary?.average_return ?? 0);
    const sumSquares = Number(summary?.sum_squares ?? 0);
    const variance = sampleSize > 1
      ? Math.max(0, (sumSquares - sampleSize * average * average) / (sampleSize - 1))
      : 0;
    const standardError = sampleSize > 1 ? Math.sqrt(variance / sampleSize) : null;
    const confidenceWidth = standardError === null ? null : 1.96 * standardError;
    const grossLoss = Number(summary?.gross_loss ?? 0);
    const profitFactor = grossLoss > 0 ? Number(summary?.gross_profit ?? 0) / grossLoss : null;
    await db
      .prepare(
        `INSERT INTO research_bucket_stats
         (score_bucket, horizon, sample_size, average_return, median_return,
          win_rate, average_mae, average_mfe, standard_error, confidence_low,
          confidence_high, profit_factor, first_signal_date, last_exit_date, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(score_bucket, horizon) DO UPDATE SET
           sample_size=excluded.sample_size, average_return=excluded.average_return,
           median_return=excluded.median_return, win_rate=excluded.win_rate,
           average_mae=excluded.average_mae, average_mfe=excluded.average_mfe,
           standard_error=excluded.standard_error, confidence_low=excluded.confidence_low,
           confidence_high=excluded.confidence_high, profit_factor=excluded.profit_factor,
           first_signal_date=excluded.first_signal_date, last_exit_date=excluded.last_exit_date,
           updated_at=excluded.updated_at`,
      )
      .bind(
        group.score_bucket,
        group.horizon,
        sampleSize,
        average,
        Number(median.median_return),
        Number(summary?.wins ?? 0) / sampleSize,
        Number(summary?.average_mae ?? 0),
        Number(summary?.average_mfe ?? 0),
        standardError,
        confidenceWidth === null ? null : average - confidenceWidth,
        confidenceWidth === null ? null : average + confidenceWidth,
        profitFactor,
        String(summary?.first_signal_date ?? ""),
        String(summary?.last_exit_date ?? ""),
        updatedAt,
      )
      .run();
  }
}
