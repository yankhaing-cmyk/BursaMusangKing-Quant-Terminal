function fixed(value) {
  if (!Number.isFinite(value)) throw new Error("non_finite_number");
  return value.toFixed(8);
}

export function canonicalOutcome(row) {
  return [
    row.signal_run_id.trim(),
    row.symbol.trim().toUpperCase(),
    row.signal_date,
    row.score_bucket,
    String(row.horizon),
    row.entry_date,
    row.exit_date,
    fixed(row.quant_score),
    fixed(row.entry_open),
    fixed(row.exit_close),
    fixed(row.signal_close),
    fixed(row.forward_return),
    fixed(row.signal_close_return),
    fixed(row.mae),
    fixed(row.mfe),
    row.computed_run_id.trim(),
    row.methodology_version,
  ].join("\u001f");
}
