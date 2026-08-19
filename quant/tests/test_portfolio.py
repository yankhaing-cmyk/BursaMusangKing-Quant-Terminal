from __future__ import annotations

import tempfile
import unittest
from dataclasses import replace
from pathlib import Path

from bmk_quant.config import QuantConfig
from bmk_quant.pipeline import QuantPipeline
from bmk_quant.portfolio import (
    CORRELATION_THRESHOLD,
    METHODOLOGY_VERSION,
    POSITION_CAP,
    SECTOR_CAP,
    calculate_portfolio_snapshot,
)
from bmk_quant.storage import ResearchStore
from bmk_quant.synthetic import make_synthetic_bundle


class PortfolioQuantTests(unittest.TestCase):
    def setUp(self) -> None:
        self.config = QuantConfig(min_valid_universe=64, max_market_age_days=None)

    @staticmethod
    def _risk_on(result):
        return replace(
            result,
            regime={
                **result.regime,
                "regime_label": "RISK-ON",
                "minimum_quant_score": 0,
                "max_new_entries": 5,
                "max_equity_exposure": 0.85,
                "minimum_cash_allocation": 0.15,
                "new_position_size_multiplier": 1.0,
            },
        )

    def test_shadow_allocations_obey_all_caps_and_are_deterministic(self) -> None:
        result = self._risk_on(
            QuantPipeline(self.config).run(
                make_synthetic_bundle(symbols=64, days=300, market_date="2026-08-20")
            )
        )
        with tempfile.TemporaryDirectory() as directory:
            store = ResearchStore(Path(directory) / "history.sqlite")
            store.save(result)
            states, _, _ = store.build_trade_artifacts(result)
            allocations, summary, manifest = store.build_portfolio_artifacts(result, states)
            repeated = store.build_portfolio_artifacts(result, states)

        self.assertEqual((allocations, summary, manifest), repeated)
        self.assertEqual(manifest["methodology_version"], METHODOLOGY_VERSION)
        self.assertFalse(manifest["automatic_execution"])
        self.assertEqual(manifest["expected_allocations"], 5)
        self.assertLessEqual(summary["capital_deployed"], 0.85)
        self.assertGreaterEqual(summary["cash_allocation"], 0.15)
        self.assertLessEqual(summary["portfolio_risk"], summary["max_portfolio_risk"])
        self.assertLessEqual(summary["largest_position"], POSITION_CAP)
        self.assertEqual(summary["sector_cap"], SECTOR_CAP)
        self.assertEqual(summary["correlation_threshold"], CORRELATION_THRESHOLD)
        self.assertTrue(all(row["target_weight"] <= POSITION_CAP for row in allocations))
        self.assertTrue(all(row["risk_contribution"] >= 0 for row in allocations))
        self.assertTrue(all(row["correlation_cluster"].startswith("C") for row in allocations))

    def test_missing_active_liquidity_fails_closed(self) -> None:
        result = self._risk_on(
            QuantPipeline(self.config).run(
                make_synthetic_bundle(symbols=64, days=300, market_date="2026-08-20")
            )
        )
        with tempfile.TemporaryDirectory() as directory:
            store = ResearchStore(Path(directory) / "history.sqlite")
            store.save(result)
            states, _, _ = store.build_trade_artifacts(result)
        active = next(row for row in states if row["state"] == "BUY_PENDING")
        records = [dict(row) for row in result.records]
        target = next(row for row in records if row["symbol"] == active["symbol"])
        target["average_traded_value_20"] = None
        broken = replace(result, records=tuple(records))
        with self.assertRaisesRegex(RuntimeError, "liquidity"):
            calculate_portfolio_snapshot(broken, states)


if __name__ == "__main__":
    unittest.main()
