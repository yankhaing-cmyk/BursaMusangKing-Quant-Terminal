import { isValidBursaSymbol } from "@/shared/bursa-symbol.mjs";
import {
  canonicalTradeEvent,
  canonicalTradeState,
} from "@/shared/canonical-trade.mjs";
import { isHash, isIsoDate, sha256Hex } from "./ingest";
import type { MarketRegimeLabel } from "./types";

export const TRADE_METHODOLOGY = "trade-v1.0.0";
export const TRADE_STATES = ["FLAT", "BUY_PENDING", "OPEN", "NEAR_SELL", "CLOSED"] as const;
export type TradeStateName = (typeof TRADE_STATES)[number];
export type EdgeConfidence = "INSUFFICIENT" | "PROVISIONAL" | "ESTABLISHED";

export type TradeManifestPayload = {
  methodology_version: string;
  expected_states: number;
  state_payload_hash: string;
  expected_events: number;
  event_payload_hash: string;
  atr_stop_multiple: number;
  near_stop_atr_multiple: number;
  automatic_execution: boolean;
};

export type TradeStatePayload = {
  run_id: string;
  market_date: string;
  methodology_version: string;
  symbol: string;
  trade_id: string | null;
  state: TradeStateName;
  signal_run_id: string | null;
  signal_date: string | null;
  signal_score_bucket: string | null;
  entry_date: string | null;
  exit_date: string | null;
  entry_price: number | null;
  exit_price: number | null;
  peak_close: number | null;
  last_close: number;
  atr14: number | null;
  trailing_stop: number | null;
  stop_distance_pct: number | null;
  unrealized_return: number | null;
  quant_score: number;
  signal_quant_score: number | null;
  signal_rank: number | null;
  regime_label: MarketRegimeLabel;
  expected_edge_20d: number | null;
  edge_sample_size: number;
  edge_confidence: EdgeConfidence;
  reason: string;
  row_hash: string;
};

export type TradeEventPayload = {
  event_id: string;
  run_id: string;
  market_date: string;
  methodology_version: string;
  symbol: string;
  trade_id: string;
  event_type: "SIGNAL" | "ENTRY" | "NEAR_SELL" | "RECOVERED" | "EXIT";
  prior_state: TradeStateName;
  new_state: TradeStateName;
  event_price: number | null;
  quant_score: number;
  trailing_stop: number | null;
  reason: string;
  row_hash: string;
};

const regimeLabels = new Set<MarketRegimeLabel>([
  "STRONG RISK-ON", "RISK-ON", "NEUTRAL", "RISK-OFF", "STRONG RISK-OFF",
]);
const scoreBuckets = new Set(["0-49", "50-59", "60-69", "70-79", "80-84", "85-89", "90-94", "95-100"]);

function finiteOrNull(value: number | null): boolean {
  return value === null || Number.isFinite(value);
}

function positiveOrNull(value: number | null): boolean {
  return value === null || (Number.isFinite(value) && value > 0);
}

export function validateTradeManifest(
  manifest: TradeManifestPayload,
  expectedSymbols: number,
): string | null {
  if (manifest.methodology_version !== TRADE_METHODOLOGY) return "unsupported_trade_methodology";
  if (manifest.expected_states !== expectedSymbols) return "trade_state_count_mismatch";
  if (!Number.isInteger(manifest.expected_events) || manifest.expected_events < 0 || manifest.expected_events > expectedSymbols * 2) {
    return "invalid_trade_event_count";
  }
  if (!isHash(manifest.state_payload_hash) || !isHash(manifest.event_payload_hash)) return "invalid_trade_payload_hash";
  if (manifest.atr_stop_multiple !== 3 || manifest.near_stop_atr_multiple !== 1) return "unsupported_trade_stop_policy";
  if (manifest.automatic_execution !== false) return "automatic_execution_must_be_disabled";
  return null;
}

export async function validateTradeState(row: TradeStatePayload): Promise<string | null> {
  if (row.methodology_version !== TRADE_METHODOLOGY) return "unsupported_trade_methodology";
  if (!isIsoDate(row.market_date) || (row.signal_date !== null && !isIsoDate(row.signal_date)) ||
      (row.entry_date !== null && !isIsoDate(row.entry_date)) || (row.exit_date !== null && !isIsoDate(row.exit_date))) {
    return "invalid_trade_date";
  }
  if (!isValidBursaSymbol(row.symbol)) return "invalid_trade_symbol";
  if (!TRADE_STATES.includes(row.state)) return "invalid_trade_state";
  if (!regimeLabels.has(row.regime_label)) return "invalid_trade_regime";
  if (!Number.isFinite(row.quant_score) || row.quant_score < 0 || row.quant_score > 100) return "invalid_trade_quant_score";
  if (!Number.isFinite(row.last_close) || row.last_close <= 0) return "invalid_trade_last_close";
  if (![row.entry_price, row.exit_price, row.peak_close, row.atr14, row.trailing_stop].every(positiveOrNull)) return "invalid_trade_price";
  if (![row.stop_distance_pct, row.unrealized_return, row.signal_quant_score, row.expected_edge_20d].every(finiteOrNull)) return "invalid_trade_number";
  if (!Number.isInteger(row.edge_sample_size) || row.edge_sample_size < 0) return "invalid_edge_sample";
  if (!["INSUFFICIENT", "PROVISIONAL", "ESTABLISHED"].includes(row.edge_confidence)) return "invalid_edge_confidence";
  if ((row.edge_sample_size < 30) !== (row.expected_edge_20d === null)) return "edge_sample_policy_mismatch";
  const expectedConfidence = row.edge_sample_size < 30
    ? "INSUFFICIENT"
    : row.edge_sample_size < 100 ? "PROVISIONAL" : "ESTABLISHED";
  if (row.edge_confidence !== expectedConfidence) return "edge_confidence_mismatch";
  if (row.stop_distance_pct !== null && row.stop_distance_pct < 0) return "invalid_stop_distance";
  if (row.unrealized_return !== null && row.unrealized_return <= -1) return "invalid_unrealized_return";
  if (!row.reason || row.reason.length > 240) return "invalid_trade_reason";

  const hasTrade = typeof row.trade_id === "string" && /^tv1-[a-f0-9]{24}$/.test(row.trade_id);
  if (row.state === "FLAT") {
    if (hasTrade || row.signal_date !== null || row.entry_date !== null || row.trailing_stop !== null) return "invalid_flat_trade_state";
  } else if (!hasTrade || !row.signal_run_id || !row.signal_date || !row.signal_score_bucket || !scoreBuckets.has(row.signal_score_bucket)) {
    return "incomplete_trade_signal";
  }
  if (row.state === "BUY_PENDING" && (row.entry_date !== null || row.entry_price !== null || row.trailing_stop !== null || row.exit_date !== null)) {
    return "invalid_pending_trade_state";
  }
  if (["OPEN", "NEAR_SELL"].includes(row.state) && (!row.entry_date || row.entry_price === null || row.peak_close === null || row.trailing_stop === null || row.exit_date !== null)) {
    return "incomplete_open_trade_state";
  }
  if (row.state === "CLOSED" && (!row.entry_date || !row.exit_date || row.entry_price === null || row.exit_price === null)) {
    return "incomplete_closed_trade_state";
  }
  if (row.signal_date && row.entry_date && row.signal_date >= row.entry_date) return "same_day_or_early_entry";
  if (row.entry_date && row.exit_date && row.exit_date < row.entry_date) return "exit_before_entry";
  if (["OPEN", "NEAR_SELL"].includes(row.state) && row.trailing_stop !== null && row.trailing_stop > row.last_close) {
    return "open_stop_above_close";
  }
  if (!isHash(row.row_hash)) return "invalid_trade_row_hash";
  return (await sha256Hex(canonicalTradeState(row as unknown as Record<string, unknown>))) === row.row_hash
    ? null
    : "trade_row_hash_mismatch";
}

export async function validateTradeEvent(row: TradeEventPayload): Promise<string | null> {
  if (!isHash(row.event_id) || !isHash(row.row_hash)) return "invalid_trade_event_hash";
  if (row.methodology_version !== TRADE_METHODOLOGY || !isIsoDate(row.market_date)) return "invalid_trade_event_methodology_or_date";
  if (!isValidBursaSymbol(row.symbol) || !/^tv1-[a-f0-9]{24}$/.test(row.trade_id)) return "invalid_trade_event_identity";
  if (!["SIGNAL", "ENTRY", "NEAR_SELL", "RECOVERED", "EXIT"].includes(row.event_type)) return "invalid_trade_event_type";
  if (!TRADE_STATES.includes(row.prior_state) || !TRADE_STATES.includes(row.new_state)) return "invalid_trade_event_state";
  if (!finiteOrNull(row.event_price) || !finiteOrNull(row.trailing_stop) || !Number.isFinite(row.quant_score)) return "invalid_trade_event_number";
  if (!row.reason || row.reason.length > 240) return "invalid_trade_event_reason";
  return (await sha256Hex(canonicalTradeEvent(row as unknown as Record<string, unknown>))) === row.row_hash
    ? null
    : "trade_event_hash_mismatch";
}
