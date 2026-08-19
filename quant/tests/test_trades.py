from __future__ import annotations

import tempfile
import unittest
from dataclasses import replace
from pathlib import Path

from bmk_quant.config import QuantConfig
from bmk_quant.pipeline import QuantPipeline
from bmk_quant.storage import ResearchStore
from bmk_quant.synthetic import make_synthetic_bundle
from bmk_quant.trades import (
    METHODOLOGY_VERSION,
    calculate_trade_snapshot,
    round_to_tick,
    state_hash,
    tick_size,
)


class TradeStateTests(unittest.TestCase):
    def setUp(self) -> None:
        self.config = QuantConfig(min_valid_universe=64, max_market_age_days=None)

    @staticmethod
    def _policy(result, *, minimum: int = 0, maximum: int = 2):
        regime = {
            **result.regime,
            "regime_label": "RISK-ON",
            "minimum_quant_score": minimum,
            "max_new_entries": maximum,
        }
        return replace(result, regime=regime)

    def test_bursa_tick_rounding(self) -> None:
        self.assertEqual(str(tick_size(0.88)), "0.005")
        self.assertEqual(str(tick_size(1.53)), "0.01")
        self.assertEqual(str(tick_size(12.34)), "0.02")
        self.assertEqual(str(tick_size(105.0)), "0.10")
        self.assertEqual(round_to_tick(0.887, floor=True), 0.885)
        self.assertEqual(round_to_tick(1.536, floor=True), 1.53)

    def test_signal_then_next_session_entry_is_deterministic(self) -> None:
        first = self._policy(
            QuantPipeline(self.config).run(
                make_synthetic_bundle(symbols=64, days=300, market_date="2026-08-19")
            )
        )
        second = self._policy(
            QuantPipeline(self.config).run(
                make_synthetic_bundle(symbols=64, days=300, market_date="2026-08-20")
            )
        )
        with tempfile.TemporaryDirectory() as directory:
            store = ResearchStore(Path(directory) / "history.sqlite")
            store.save(first)
            first_states, first_events, first_manifest = store.build_trade_artifacts(first)
            pending = [row for row in first_states if row["state"] == "BUY_PENDING"]
            self.assertEqual(len(pending), 2)
            self.assertEqual({row["event_type"] for row in first_events}, {"SIGNAL"})
            self.assertEqual(first_manifest["methodology_version"], METHODOLOGY_VERSION)
            self.assertFalse(first_manifest["automatic_execution"])

            store.save(second)
            second_states, second_events, _ = store.build_trade_artifacts(second)
            entered_symbols = {row["symbol"] for row in pending}
            entry_events = [row for row in second_events if row["event_type"] == "ENTRY"]
            self.assertEqual({row["symbol"] for row in entry_events}, entered_symbols)
            for symbol in entered_symbols:
                row = next(item for item in second_states if item["symbol"] == symbol)
                self.assertEqual(row["entry_date"], "2026-08-20")
                self.assertIn(row["state"], {"OPEN", "NEAR_SELL", "CLOSED"})

            repeated_states, repeated_events, repeated_manifest = store.build_trade_artifacts(second)
            self.assertEqual(repeated_states, second_states)
            self.assertEqual(repeated_events, second_events)
            self.assertEqual(repeated_manifest["state_payload_hash"], _["state_payload_hash"])

    def test_prior_stop_is_checked_before_peak_update(self) -> None:
        result = self._policy(
            QuantPipeline(self.config).run(
                make_synthetic_bundle(symbols=64, days=300, market_date="2026-08-20")
            ),
            maximum=0,
        )
        record = result.records[0]
        bars = result.bundle.bars
        current = bars[(bars["symbol"] == record["symbol"]) & (bars["date"].dt.strftime("%Y-%m-%d") == "2026-08-20")].iloc[0]
        stop = round_to_tick(float(current.low) + float(tick_size(float(current.low))))
        prior = {
            "run_id": "prior-run",
            "market_date": "2026-08-19",
            "methodology_version": METHODOLOGY_VERSION,
            "symbol": record["symbol"],
            "trade_id": "tv1-0123456789abcdef01234567",
            "state": "OPEN",
            "signal_run_id": "signal-run",
            "signal_date": "2026-08-18",
            "signal_score_bucket": "80-84",
            "entry_date": "2026-08-19",
            "exit_date": None,
            "entry_price": float(current.open),
            "exit_price": None,
            "peak_close": float(current.high) + 10,
            "last_close": float(current.open),
            "atr14": record["atr_14"],
            "trailing_stop": stop,
            "stop_distance_pct": 0.02,
            "unrealized_return": 0.01,
            "quant_score": record["quant_score"],
            "signal_quant_score": 82.0,
            "signal_rank": 1,
            "regime_label": "RISK-ON",
            "expected_edge_20d": None,
            "edge_sample_size": 0,
            "edge_confidence": "INSUFFICIENT",
            "reason": "TEST_OPEN",
        }
        prior["row_hash"] = state_hash(prior)
        states, events, _ = calculate_trade_snapshot(result, [prior], {})
        closed = next(row for row in states if row["symbol"] == record["symbol"])
        self.assertEqual(closed["state"], "CLOSED")
        self.assertEqual(closed["reason"], "PRIOR_STOP_TRIGGERED_BEFORE_PEAK_UPDATE")
        self.assertTrue(any(row["event_type"] == "EXIT" for row in events))


if __name__ == "__main__":
    unittest.main()
