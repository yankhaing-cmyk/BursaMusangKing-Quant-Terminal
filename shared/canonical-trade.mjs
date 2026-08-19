function fixed(value) {
  if (value === null) return "";
  if (!Number.isFinite(value)) throw new Error("non_finite_number");
  return value.toFixed(8);
}

const stateFields = [
  "run_id", "market_date", "methodology_version", "symbol", "trade_id",
  "state", "signal_run_id", "signal_date", "signal_score_bucket",
  "entry_date", "exit_date", "entry_price", "exit_price", "peak_close",
  "last_close", "atr14", "trailing_stop", "stop_distance_pct",
  "unrealized_return", "quant_score", "signal_quant_score", "signal_rank",
  "regime_label", "expected_edge_20d", "edge_sample_size",
  "edge_confidence", "reason",
];

const eventFields = [
  "event_id", "run_id", "market_date", "methodology_version", "symbol",
  "trade_id", "event_type", "prior_state", "new_state", "event_price",
  "quant_score", "trailing_stop", "reason",
];

const numericFields = new Set([
  "entry_price", "exit_price", "peak_close", "last_close", "atr14",
  "trailing_stop", "stop_distance_pct", "unrealized_return", "quant_score",
  "signal_quant_score", "expected_edge_20d", "event_price",
]);
const integerFields = new Set(["signal_rank", "edge_sample_size"]);

function canonical(row, fields) {
  return fields.map((field) => {
    const value = row[field];
    if (numericFields.has(field)) return fixed(value);
    if (integerFields.has(field)) return value === null ? "" : String(value);
    if (field === "symbol") return String(value ?? "").trim().toUpperCase();
    return value === null ? "" : String(value ?? "").trim();
  }).join("\u001f");
}

export function canonicalTradeState(row) {
  return canonical(row, stateFields);
}

export function canonicalTradeEvent(row) {
  return canonical(row, eventFields);
}
