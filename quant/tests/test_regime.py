from __future__ import annotations

import unittest
from dataclasses import replace

from bmk_quant.config import QuantConfig
from bmk_quant.pipeline import QuantPipeline
from bmk_quant.regime import METHODOLOGY_VERSION, POLICIES, REGIME_LABELS, regime_hash
from bmk_quant.synthetic import make_synthetic_bundle


class MarketRegimeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.bundle = make_synthetic_bundle(symbols=64, days=285)
        cls.config = QuantConfig(min_valid_universe=64, max_market_age_days=None)

    def test_regime_is_complete_deterministic_and_policy_bound(self) -> None:
        first = QuantPipeline(self.config).run(self.bundle)
        second = QuantPipeline(self.config).run(self.bundle)
        regime = first.regime
        self.assertEqual(regime, second.regime)
        self.assertEqual(regime["methodology_version"], METHODOLOGY_VERSION)
        self.assertIn(regime["regime_label"], REGIME_LABELS)
        self.assertEqual(regime["row_hash"], regime_hash(regime))
        self.assertEqual(
            {key: regime[key] for key in POLICIES[regime["regime_label"]]},
            POLICIES[regime["regime_label"]],
        )
        self.assertAlmostEqual(
            regime["max_equity_exposure"] + regime["minimum_cash_allocation"],
            1.0,
        )
        for field in (
            "regime_score",
            "benchmark_trend_score",
            "breadth_score",
            "sector_breadth_score",
            "participation_score",
            "volatility_score",
        ):
            self.assertGreaterEqual(regime[field], 0)
            self.assertLessEqual(regime[field], 100)

    def test_insufficient_sector_breadth_fails_closed(self) -> None:
        instruments = self.bundle.instruments.copy()
        instruments["sector"] = "Undiversified"
        broken = replace(self.bundle, instruments=instruments)
        with self.assertRaisesRegex(ValueError, "sector breadth"):
            QuantPipeline(self.config).run(broken)


if __name__ == "__main__":
    unittest.main()
