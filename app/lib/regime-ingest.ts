import { canonicalRegime } from "@/shared/canonical-regime.mjs";
import { isHash, isIsoDate, sha256Hex } from "@/app/lib/ingest";

export const REGIME_METHODOLOGY = "regime-v1.0.0";
export const REGIME_LABELS = [
  "STRONG RISK-ON",
  "RISK-ON",
  "NEUTRAL",
  "RISK-OFF",
  "STRONG RISK-OFF",
] as const;

export type RegimeLabel = (typeof REGIME_LABELS)[number];

export type RegimePayload = {
  run_id: string;
  market_date: string;
  methodology_version: string;
  regime_label: RegimeLabel;
  regime_score: number;
  benchmark_close: number;
  benchmark_sma50: number;
  benchmark_sma200: number;
  benchmark_sma50_slope20: number;
  benchmark_sma200_slope20: number;
  benchmark_return20: number;
  benchmark_realized_volatility20: number;
  breadth_above20: number;
  breadth_above50: number;
  breadth_above200: number;
  breadth_momentum: number;
  new_high_rate: number;
  new_low_rate: number;
  volume_participation_rate: number;
  sector_positive_rate: number;
  benchmark_trend_score: number;
  breadth_score: number;
  sector_breadth_score: number;
  participation_score: number;
  volatility_score: number;
  minimum_quant_score: number;
  max_equity_exposure: number;
  new_position_size_multiplier: number;
  minimum_cash_allocation: number;
  max_new_entries: number;
  trend_weight_multiplier: number;
  explanation: Record<string, string>;
  row_hash: string;
};

const policies: Record<RegimeLabel, [number, number, number, number, number, number]> = {
  "STRONG RISK-ON": [78, 0.90, 1.00, 0.10, 5, 1.15],
  "RISK-ON": [80, 0.85, 1.00, 0.15, 4, 1.10],
  "NEUTRAL": [84, 0.65, 0.75, 0.35, 2, 1.00],
  "RISK-OFF": [88, 0.45, 0.50, 0.55, 1, 0.90],
  "STRONG RISK-OFF": [92, 0.25, 0.25, 0.75, 0, 0.80],
};

function closeEnough(left: number, right: number, tolerance = 1e-8): boolean {
  return Math.abs(left - right) <= tolerance * Math.max(1, Math.abs(left), Math.abs(right));
}

function classifiedLabel(row: RegimePayload): RegimeLabel {
  if (
    row.regime_score >= 75 &&
    row.benchmark_close > row.benchmark_sma50 &&
    row.benchmark_close > row.benchmark_sma200 &&
    row.breadth_above50 >= 0.60
  ) return "STRONG RISK-ON";
  if (
    row.regime_score >= 60 &&
    row.benchmark_close > row.benchmark_sma200 &&
    row.breadth_above50 >= 0.50
  ) return "RISK-ON";
  if (
    row.regime_score < 30 &&
    row.benchmark_close < row.benchmark_sma50 &&
    row.benchmark_close < row.benchmark_sma200 &&
    row.breadth_above50 <= 0.30
  ) return "STRONG RISK-OFF";
  if (
    row.regime_score < 45 ||
    (row.benchmark_close < row.benchmark_sma200 && row.breadth_above50 < 0.40)
  ) return "RISK-OFF";
  return "NEUTRAL";
}

export async function validateRegime(row: RegimePayload): Promise<string | null> {
  if (!/^[A-Za-z0-9._:-]{8,100}$/.test(row.run_id ?? "")) return "invalid_regime_run_id";
  if (!isIsoDate(row.market_date)) return "invalid_regime_market_date";
  if (row.methodology_version !== REGIME_METHODOLOGY) return "unsupported_regime_methodology";
  if (!REGIME_LABELS.includes(row.regime_label)) return "invalid_regime_label";

  const scores = [
    row.regime_score,
    row.benchmark_trend_score,
    row.breadth_score,
    row.sector_breadth_score,
    row.participation_score,
    row.volatility_score,
  ];
  if (scores.some((value) => !Number.isFinite(value) || value < 0 || value > 100)) {
    return "regime_score_out_of_range";
  }
  const positive = [row.benchmark_close, row.benchmark_sma50, row.benchmark_sma200];
  if (positive.some((value) => !Number.isFinite(value) || value <= 0)) return "invalid_regime_benchmark";
  const diagnostics = [
    row.benchmark_sma50_slope20,
    row.benchmark_sma200_slope20,
    row.benchmark_return20,
    row.benchmark_realized_volatility20,
    row.breadth_momentum,
  ];
  if (diagnostics.some((value) => !Number.isFinite(value) || value < -1 || value > 5)) {
    return "invalid_regime_diagnostic";
  }
  const rates = [
    row.breadth_above20,
    row.breadth_above50,
    row.breadth_above200,
    row.new_high_rate,
    row.new_low_rate,
    row.volume_participation_rate,
    row.sector_positive_rate,
    row.max_equity_exposure,
    row.minimum_cash_allocation,
  ];
  if (rates.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) {
    return "regime_rate_out_of_range";
  }
  if (!closeEnough(row.max_equity_exposure + row.minimum_cash_allocation, 1)) {
    return "regime_exposure_cash_mismatch";
  }
  if (!Number.isInteger(row.minimum_quant_score) || row.minimum_quant_score < 0 || row.minimum_quant_score > 100) {
    return "invalid_regime_minimum_score";
  }
  if (!Number.isInteger(row.max_new_entries) || row.max_new_entries < 0 || row.max_new_entries > 20) {
    return "invalid_regime_entry_limit";
  }
  if (
    !Number.isFinite(row.new_position_size_multiplier) ||
    row.new_position_size_multiplier < 0 ||
    row.new_position_size_multiplier > 1 ||
    !Number.isFinite(row.trend_weight_multiplier) ||
    row.trend_weight_multiplier < 0.5 ||
    row.trend_weight_multiplier > 1.5
  ) return "invalid_regime_multiplier";

  const expected = policies[row.regime_label];
  const actual = [
    row.minimum_quant_score,
    row.max_equity_exposure,
    row.new_position_size_multiplier,
    row.minimum_cash_allocation,
    row.max_new_entries,
    row.trend_weight_multiplier,
  ];
  if (actual.some((value, index) => !closeEnough(value, expected[index]))) {
    return "regime_policy_mismatch";
  }
  if (classifiedLabel(row) !== row.regime_label) return "regime_label_mismatch";
  if (
    !row.explanation ||
    typeof row.explanation !== "object" ||
    Array.isArray(row.explanation) ||
    Object.keys(row.explanation).length < 5 ||
    Object.keys(row.explanation).length > 10 ||
    Object.values(row.explanation).some(
      (value) => typeof value !== "string" || !value.trim() || value.length > 500,
    )
  ) return "invalid_regime_explanation";
  if (!isHash(row.row_hash)) return "invalid_regime_hash";
  return (await sha256Hex(canonicalRegime(row as unknown as Record<string, unknown>))) === row.row_hash
    ? null
    : "regime_hash_mismatch";
}
