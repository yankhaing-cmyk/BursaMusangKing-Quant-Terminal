import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  canonicalTradeEvent,
  canonicalTradeState,
} from "../shared/canonical-trade.mjs";

const state = {
  run_id: "qv1-20260820-abcdef0123456789",
  market_date: "2026-08-20",
  methodology_version: "trade-v1.0.0",
  symbol: "NATGATE",
  trade_id: "tv1-0123456789abcdef01234567",
  state: "OPEN",
  signal_run_id: "qv1-20260819-1111111111111111",
  signal_date: "2026-08-19",
  signal_score_bucket: "85-89",
  entry_date: "2026-08-20",
  exit_date: null,
  entry_price: 1.53,
  exit_price: null,
  peak_close: 1.58,
  last_close: 1.57,
  atr14: 0.06,
  trailing_stop: 1.4,
  stop_distance_pct: 0.1082802548,
  unrealized_return: 0.0261437908,
  quant_score: 87.25,
  signal_quant_score: 86.75,
  signal_rank: 3,
  regime_label: "RISK-ON",
  expected_edge_20d: 0.078,
  edge_sample_size: 186,
  edge_confidence: "ESTABLISHED",
  reason: "TRAILING_STOP_UPDATED_AFTER_STOP_CHECK",
};

const event = {
  event_id: "a".repeat(64),
  run_id: state.run_id,
  market_date: state.market_date,
  methodology_version: "trade-v1.0.0",
  symbol: "NATGATE",
  trade_id: state.trade_id,
  event_type: "ENTRY",
  prior_state: "BUY_PENDING",
  new_state: "OPEN",
  event_price: 1.53,
  quant_score: 87.25,
  trailing_stop: 1.35,
  reason: "NEXT_BURSA_SESSION_OPEN",
};

test("Python and Worker share the frozen trade-state representation", () => {
  const hash = createHash("sha256").update(canonicalTradeState(state), "utf8").digest("hex");
  assert.equal(hash, "908469b67e5ddfcd4522914bc48a1881f72d9a97f44d6259e366c233e4fa0a29");
});

test("Python and Worker share the frozen trade-event representation", () => {
  const hash = createHash("sha256").update(canonicalTradeEvent(event), "utf8").digest("hex");
  assert.equal(hash, "36b6ae219e5a0422175f0ab02aedc71d266ca4c9dd66363a35f36c2b7e1531b1");
});
