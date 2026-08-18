import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { canonicalScore } from "../shared/canonical-score.mjs";

test("publisher and Worker share the frozen canonical score representation", () => {
  const record = {
    symbol: "0001",
    name: "Syarikat Émas",
    sector: "Technology",
    close: 1.23,
    rank: 7,
    quant_score: 88.5,
    trend_score: 90,
    momentum_score: 87,
    relative_strength_score: 86,
    volume_score: 70,
    volatility_score: 65,
    liquidity_score: 80,
    price_structure_score: 84,
    trending_score: 88,
    momentum_strategy_score: 85,
    meta_score: 86,
    strategy_ensemble_score: 86.333333,
    return_20: 0.123,
    return_60: 0.2,
    rs_20: 0.05,
    rs_60: 0.08,
    sector_rs_20: null,
    atr_14: 0.0345,
    atr_pct: 0.028,
    average_traded_value_20: 1234567.89,
    volume_ratio_20: 1.5,
    distance_52_week_high: -0.04,
    history_days: 300,
    sector_rs_available: false,
    quality_flags: ["SECTOR_RS_UNAVAILABLE"],
    factor_explanation: { trend: "Transparent", momentum: "Measured" },
  };
  const digest = createHash("sha256").update(canonicalScore(record), "utf8").digest("hex");
  assert.equal(digest, "8f4fff8282c0e612521cc79d1aeeb56a159004efd6f51cbab8e76718140dc12c");
});

