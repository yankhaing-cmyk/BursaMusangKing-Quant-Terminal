import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { canonicalRegime } from "../shared/canonical-regime.mjs";

const row = {
  run_id: "qv1-20260820-abcdef0123456789",
  market_date: "2026-08-20",
  methodology_version: "regime-v1.0.0",
  regime_label: "RISK-ON",
  regime_score: 67.25,
  benchmark_close: 1598.42,
  benchmark_sma50: 1581.77,
  benchmark_sma200: 1569.31,
  benchmark_sma50_slope20: 0.006,
  benchmark_sma200_slope20: 0.011,
  benchmark_return20: 0.014,
  benchmark_realized_volatility20: 0.168,
  breadth_above20: 0.62,
  breadth_above50: 0.55,
  breadth_above200: 0.51,
  breadth_momentum: 0.07,
  new_high_rate: 0.041,
  new_low_rate: 0.019,
  volume_participation_rate: 0.53,
  sector_positive_rate: 0.61,
  benchmark_trend_score: 85,
  breadth_score: 57.4,
  sector_breadth_score: 61,
  participation_score: 53,
  volatility_score: 79.13,
  minimum_quant_score: 80,
  max_equity_exposure: 0.85,
  new_position_size_multiplier: 1,
  minimum_cash_allocation: 0.15,
  max_new_entries: 4,
  trend_weight_multiplier: 1.1,
  explanation: {
    participation: "10% volume breadth.",
    policy: "Guidance only.",
    benchmark_trend: "35% KLCI trend.",
    volatility: "10% KLCI volatility.",
    market_breadth: "35% stock breadth.",
    sector_breadth: "10% sector breadth.",
  },
};

test("canonical regime hash matches the Python contract", () => {
  const hash = createHash("sha256").update(canonicalRegime(row), "utf8").digest("hex");
  assert.equal(hash, "05c5f1379346043104c5401b962a3acfb7f83bea123f6124e5826423d8a117f1");
});
