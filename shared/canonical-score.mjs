function fixed(value) {
  if (value === null) return "";
  if (!Number.isFinite(value)) throw new Error("non_finite_number");
  return value.toFixed(8);
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function canonicalScore(row) {
  return [
    row.symbol.trim().toUpperCase(),
    row.name.trim(),
    row.sector.trim(),
    fixed(row.close),
    String(row.rank),
    fixed(row.quant_score),
    fixed(row.trend_score),
    fixed(row.momentum_score),
    fixed(row.relative_strength_score),
    fixed(row.volume_score),
    fixed(row.volatility_score),
    fixed(row.liquidity_score),
    fixed(row.price_structure_score),
    fixed(row.trending_score),
    fixed(row.momentum_strategy_score),
    fixed(row.meta_score),
    fixed(row.strategy_ensemble_score),
    fixed(row.return_20),
    fixed(row.return_60),
    fixed(row.rs_20),
    fixed(row.rs_60),
    fixed(row.sector_rs_20),
    fixed(row.atr_14),
    fixed(row.atr_pct),
    fixed(row.average_traded_value_20),
    fixed(row.volume_ratio_20),
    fixed(row.distance_52_week_high),
    String(row.history_days),
    row.sector_rs_available ? "1" : "0",
    stableJson([...row.quality_flags].sort()),
    stableJson(row.factor_explanation),
  ].join("\u001f");
}

