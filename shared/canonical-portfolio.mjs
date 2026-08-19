function fixed(value) {
  if (value === null) return "";
  if (!Number.isFinite(value)) throw new Error("non_finite_number");
  return value.toFixed(8);
}

const allocationFields = [
  "run_id", "market_date", "methodology_version", "symbol", "trade_id",
  "trade_state", "sector", "quant_score", "last_close", "atr_pct",
  "stop_distance_pct", "average_traded_value_20", "score_multiplier",
  "volatility_multiplier", "liquidity_multiplier", "correlation_multiplier",
  "target_weight", "risk_budget", "risk_contribution",
  "volatility_contribution", "beta", "correlation_cluster",
  "sector_cap_applied", "flags_json",
];

const summaryFields = [
  "run_id", "market_date", "methodology_version", "regime_label",
  "max_equity_exposure", "minimum_cash_allocation", "max_portfolio_risk",
  "position_cap", "sector_cap", "correlation_threshold", "position_count",
  "capital_deployed", "cash_allocation", "portfolio_risk",
  "largest_position", "top5_concentration", "portfolio_quant_score",
  "portfolio_beta", "expected_volatility", "sector_exposure_json",
  "correlation_clusters_json", "automatic_execution",
];

const numericFields = new Set([
  "quant_score", "last_close", "atr_pct", "stop_distance_pct",
  "average_traded_value_20", "score_multiplier", "volatility_multiplier",
  "liquidity_multiplier", "correlation_multiplier", "target_weight",
  "risk_budget", "risk_contribution", "volatility_contribution", "beta",
  "max_equity_exposure", "minimum_cash_allocation", "max_portfolio_risk",
  "position_cap", "sector_cap", "correlation_threshold", "capital_deployed",
  "cash_allocation", "portfolio_risk", "largest_position",
  "top5_concentration", "portfolio_quant_score", "portfolio_beta",
  "expected_volatility",
]);

function canonical(row, fields) {
  return fields.map((field) => {
    const value = row[field];
    if (numericFields.has(field)) return fixed(value);
    if (field === "position_count") return String(value);
    if (field === "sector_cap_applied" || field === "automatic_execution") return value ? "1" : "0";
    if (field === "symbol") return String(value ?? "").trim().toUpperCase();
    return value === null ? "" : String(value ?? "").trim();
  }).join("\u001f");
}

export function canonicalPortfolioAllocation(row) {
  return canonical(row, allocationFields);
}

export function canonicalPortfolioSummary(row) {
  return canonical(row, summaryFields);
}
