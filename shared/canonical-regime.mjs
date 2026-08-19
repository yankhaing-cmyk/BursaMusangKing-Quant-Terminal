function fixed(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) throw new TypeError("non-finite number in canonical regime");
  return numeric.toFixed(8);
}

function canonicalExplanation(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("regime explanation must be an object");
  }
  return JSON.stringify(
    Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))),
  );
}

export function canonicalRegime(row) {
  return [
    String(row.run_id).trim(),
    String(row.market_date),
    String(row.methodology_version),
    String(row.regime_label),
    fixed(row.regime_score),
    fixed(row.benchmark_close),
    fixed(row.benchmark_sma50),
    fixed(row.benchmark_sma200),
    fixed(row.benchmark_sma50_slope20),
    fixed(row.benchmark_sma200_slope20),
    fixed(row.benchmark_return20),
    fixed(row.benchmark_realized_volatility20),
    fixed(row.breadth_above20),
    fixed(row.breadth_above50),
    fixed(row.breadth_above200),
    fixed(row.breadth_momentum),
    fixed(row.new_high_rate),
    fixed(row.new_low_rate),
    fixed(row.volume_participation_rate),
    fixed(row.sector_positive_rate),
    fixed(row.benchmark_trend_score),
    fixed(row.breadth_score),
    fixed(row.sector_breadth_score),
    fixed(row.participation_score),
    fixed(row.volatility_score),
    String(Number(row.minimum_quant_score)),
    fixed(row.max_equity_exposure),
    fixed(row.new_position_size_multiplier),
    fixed(row.minimum_cash_allocation),
    String(Number(row.max_new_entries)),
    fixed(row.trend_weight_multiplier),
    canonicalExplanation(row.explanation),
  ].join("\x1f");
}
