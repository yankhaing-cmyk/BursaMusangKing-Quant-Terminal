import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  canonicalPortfolioAllocation,
  canonicalPortfolioSummary,
} from "../shared/canonical-portfolio.mjs";

const allocation = {
  run_id: "qv1-test", market_date: "2026-08-20", methodology_version: "portfolio-v1.0.0",
  symbol: "PWRWELL", trade_id: "tv1-0123456789abcdef01234567", trade_state: "OPEN",
  sector: "Industrials", quant_score: 88.5, last_close: 1.53, atr_pct: 0.04,
  stop_distance_pct: 0.08, average_traded_value_20: 2500000, score_multiplier: 0.9625,
  volatility_multiplier: 0.85, liquidity_multiplier: 0.85, correlation_multiplier: 1,
  target_weight: 0.05, risk_budget: 0.004, risk_contribution: 0.004,
  volatility_contribution: 0.02, beta: 1.1, correlation_cluster: "C01",
  sector_cap_applied: false, flags_json: "[]",
};

const summary = {
  run_id: "qv1-test", market_date: "2026-08-20", methodology_version: "portfolio-v1.0.0",
  regime_label: "RISK-ON", max_equity_exposure: 0.85, minimum_cash_allocation: 0.15,
  max_portfolio_risk: 0.05, position_cap: 0.06, sector_cap: 0.25,
  correlation_threshold: 0.75, position_count: 1, capital_deployed: 0.05,
  cash_allocation: 0.95, portfolio_risk: 0.004, largest_position: 0.05,
  top5_concentration: 0.05, portfolio_quant_score: 88.5, portfolio_beta: 0.055,
  expected_volatility: 0.012, sector_exposure_json: '{"Industrials":0.05}',
  correlation_clusters_json: '{"C01":["PWRWELL"]}', automatic_execution: false,
};

test("Python and Worker share frozen Phase 5 canonical representations", () => {
  const script = [
    "import json,sys",
    "from bmk_quant.portfolio import _canonical,ALLOCATION_FIELDS,SUMMARY_FIELDS",
    "payload=json.load(sys.stdin)",
    "print(_canonical(payload['allocation'], ALLOCATION_FIELDS))",
    "print(_canonical(payload['summary'], SUMMARY_FIELDS))",
  ].join(";");
  const result = spawnSync("python3", ["-c", script], {
    input: JSON.stringify({ allocation, summary }),
    encoding: "utf8",
    env: { ...process.env, PYTHONPATH: "quant" },
  });
  assert.equal(result.status, 0, result.stderr);
  const [pythonAllocation, pythonSummary] = result.stdout.trim().split("\n");
  assert.equal(canonicalPortfolioAllocation(allocation), pythonAllocation);
  assert.equal(canonicalPortfolioSummary(summary), pythonSummary);
});
