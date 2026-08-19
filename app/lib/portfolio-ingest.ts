import { isValidBursaSymbol } from "@/shared/bursa-symbol.mjs";
import {
  canonicalPortfolioAllocation,
  canonicalPortfolioSummary,
} from "@/shared/canonical-portfolio.mjs";
import { isHash, isIsoDate, sha256Hex } from "./ingest";
import type { MarketRegimeLabel, TradeStateName } from "./types";

export const PORTFOLIO_METHODOLOGY = "portfolio-v1.0.0";

export type PortfolioManifestPayload = {
  methodology_version: string;
  expected_allocations: number;
  allocation_payload_hash: string;
  summary_hash: string;
  position_cap: number;
  sector_cap: number;
  correlation_threshold: number;
  automatic_execution: boolean;
};

export type PortfolioAllocationPayload = {
  run_id: string;
  market_date: string;
  methodology_version: string;
  symbol: string;
  trade_id: string;
  trade_state: TradeStateName;
  sector: string;
  quant_score: number;
  last_close: number;
  atr_pct: number;
  stop_distance_pct: number;
  average_traded_value_20: number;
  score_multiplier: number;
  volatility_multiplier: number;
  liquidity_multiplier: number;
  correlation_multiplier: number;
  target_weight: number;
  risk_budget: number;
  risk_contribution: number;
  volatility_contribution: number | null;
  beta: number | null;
  correlation_cluster: string;
  sector_cap_applied: boolean;
  flags_json: string;
  row_hash: string;
};

export type PortfolioSummaryPayload = {
  run_id: string;
  market_date: string;
  methodology_version: string;
  regime_label: MarketRegimeLabel;
  max_equity_exposure: number;
  minimum_cash_allocation: number;
  max_portfolio_risk: number;
  position_cap: number;
  sector_cap: number;
  correlation_threshold: number;
  position_count: number;
  capital_deployed: number;
  cash_allocation: number;
  portfolio_risk: number;
  largest_position: number;
  top5_concentration: number;
  portfolio_quant_score: number | null;
  portfolio_beta: number | null;
  expected_volatility: number | null;
  sector_exposure_json: string;
  correlation_clusters_json: string;
  automatic_execution: boolean;
  row_hash: string;
};

const regimes = new Set<MarketRegimeLabel>([
  "STRONG RISK-ON", "RISK-ON", "NEUTRAL", "RISK-OFF", "STRONG RISK-OFF",
]);

function finite(value: number): boolean {
  return Number.isFinite(value);
}

function nullableFinite(value: number | null): boolean {
  return value === null || Number.isFinite(value);
}

export function validatePortfolioManifest(
  manifest: PortfolioManifestPayload,
  expectedSymbols: number,
): string | null {
  if (manifest.methodology_version !== PORTFOLIO_METHODOLOGY) return "unsupported_portfolio_methodology";
  if (!Number.isInteger(manifest.expected_allocations) || manifest.expected_allocations < 0 || manifest.expected_allocations > expectedSymbols) {
    return "invalid_portfolio_allocation_count";
  }
  if (!isHash(manifest.allocation_payload_hash) || !isHash(manifest.summary_hash)) return "invalid_portfolio_payload_hash";
  if (manifest.position_cap !== 0.06 || manifest.sector_cap !== 0.25 || manifest.correlation_threshold !== 0.75) {
    return "unsupported_portfolio_policy";
  }
  if (manifest.automatic_execution !== false) return "automatic_execution_must_be_disabled";
  return null;
}

export async function validatePortfolioAllocation(row: PortfolioAllocationPayload): Promise<string | null> {
  if (row.methodology_version !== PORTFOLIO_METHODOLOGY || !isIsoDate(row.market_date)) return "invalid_portfolio_methodology_or_date";
  if (!isValidBursaSymbol(row.symbol) || !/^tv1-[a-f0-9]{24}$/.test(row.trade_id)) return "invalid_portfolio_identity";
  if (!["BUY_PENDING", "OPEN", "NEAR_SELL"].includes(row.trade_state)) return "invalid_portfolio_trade_state";
  if (!row.sector.trim() || row.sector.length > 100) return "invalid_portfolio_sector";
  const values = [
    row.quant_score, row.last_close, row.atr_pct, row.stop_distance_pct,
    row.average_traded_value_20, row.score_multiplier, row.volatility_multiplier,
    row.liquidity_multiplier, row.correlation_multiplier, row.target_weight,
    row.risk_budget, row.risk_contribution,
  ];
  if (!values.every(finite) || !nullableFinite(row.volatility_contribution) || !nullableFinite(row.beta)) return "invalid_portfolio_number";
  if (row.quant_score < 0 || row.quant_score > 100 || row.last_close <= 0 || row.atr_pct <= 0 || row.stop_distance_pct < 0) return "invalid_portfolio_market_input";
  if (row.average_traded_value_20 < 100_000) return "portfolio_liquidity_floor_failed";
  if (row.target_weight < 0 || row.target_weight > 0.06 || row.risk_budget < 0 || row.risk_contribution < 0) return "invalid_portfolio_weight_or_risk";
  if (!/^C\d{2}$/.test(row.correlation_cluster)) return "invalid_correlation_cluster";
  try {
    const flags = JSON.parse(row.flags_json) as unknown;
    if (!Array.isArray(flags) || flags.some((flag) => typeof flag !== "string")) return "invalid_portfolio_flags";
  } catch {
    return "invalid_portfolio_flags";
  }
  if (!isHash(row.row_hash)) return "invalid_portfolio_row_hash";
  return (await sha256Hex(canonicalPortfolioAllocation(row as unknown as Record<string, unknown>))) === row.row_hash
    ? null
    : "portfolio_row_hash_mismatch";
}

export async function validatePortfolioSummary(row: PortfolioSummaryPayload): Promise<string | null> {
  if (row.methodology_version !== PORTFOLIO_METHODOLOGY || !isIsoDate(row.market_date)) return "invalid_portfolio_summary_methodology_or_date";
  if (!regimes.has(row.regime_label)) return "invalid_portfolio_regime";
  const values = [
    row.max_equity_exposure, row.minimum_cash_allocation, row.max_portfolio_risk,
    row.position_cap, row.sector_cap, row.correlation_threshold,
    row.capital_deployed, row.cash_allocation, row.portfolio_risk,
    row.largest_position, row.top5_concentration,
  ];
  if (!values.every(finite) || !nullableFinite(row.portfolio_quant_score) || !nullableFinite(row.portfolio_beta) || !nullableFinite(row.expected_volatility)) {
    return "invalid_portfolio_summary_number";
  }
  if (!Number.isInteger(row.position_count) || row.position_count < 0) return "invalid_portfolio_position_count";
  if (row.position_cap !== 0.06 || row.sector_cap !== 0.25 || row.correlation_threshold !== 0.75 || row.automatic_execution !== false) {
    return "unsupported_portfolio_summary_policy";
  }
  if (Math.abs(row.max_equity_exposure + row.minimum_cash_allocation - 1) > 1e-7) return "inconsistent_portfolio_exposure_policy";
  if (row.capital_deployed < 0 || row.capital_deployed > row.max_equity_exposure + 1e-7 || Math.abs(row.capital_deployed + row.cash_allocation - 1) > 1e-7) {
    return "invalid_portfolio_exposure";
  }
  if (row.portfolio_risk < 0 || row.portfolio_risk > row.max_portfolio_risk + 1e-7 || row.largest_position > row.position_cap + 1e-7) {
    return "portfolio_limit_exceeded";
  }
  try {
    const sectors = JSON.parse(row.sector_exposure_json) as Record<string, number>;
    const clusters = JSON.parse(row.correlation_clusters_json) as Record<string, string[]>;
    if (!sectors || Array.isArray(sectors) || Object.values(sectors).some((value) => !Number.isFinite(value) || value < 0 || value > 0.25 + 1e-7)) {
      return "invalid_sector_exposure";
    }
    if (!clusters || Array.isArray(clusters) || Object.entries(clusters).some(([key, members]) => !/^C\d{2}$/.test(key) || !Array.isArray(members))) {
      return "invalid_correlation_clusters";
    }
  } catch {
    return "invalid_portfolio_summary_json";
  }
  if (!isHash(row.row_hash)) return "invalid_portfolio_summary_hash";
  return (await sha256Hex(canonicalPortfolioSummary(row as unknown as Record<string, unknown>))) === row.row_hash
    ? null
    : "portfolio_summary_hash_mismatch";
}
