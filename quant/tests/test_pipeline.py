from __future__ import annotations

import os
import tempfile
import unittest
import sqlite3
from dataclasses import replace
from pathlib import Path

import numpy as np

from bmk_quant.canonical import payload_hash, row_hash
from bmk_quant.config import QuantConfig
from bmk_quant.models import ValidationError
from bmk_quant.pipeline import QuantPipeline
from bmk_quant.storage import ResearchStore
from bmk_quant.synthetic import make_synthetic_bundle


class QuantPipelineTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.bundle = make_synthetic_bundle(symbols=32, days=285)
        cls.config = QuantConfig(min_valid_universe=32, max_market_age_days=None)

    def test_all_symbols_receive_transparent_scores(self) -> None:
        result = QuantPipeline(self.config).run(self.bundle)
        self.assertEqual(len(result.records), 32)
        self.assertEqual({row["rank"] for row in result.records}, set(range(1, 33)))
        for record in result.records:
            for field in (
                "quant_score",
                "trend_score",
                "momentum_score",
                "relative_strength_score",
                "volume_score",
                "volatility_score",
                "liquidity_score",
                "trending_score",
                "momentum_strategy_score",
                "meta_score",
            ):
                self.assertTrue(0 <= record[field] <= 100, (record["symbol"], field))
            self.assertEqual(record["row_hash"], row_hash(record))
        self.assertEqual(
            result.manifest["payload_hash"], payload_hash(list(result.records))
        )

    def test_canonical_hash_matches_worker_golden_value(self) -> None:
        record = {
            "symbol": "0001", "name": "Syarikat Émas", "sector": "Technology",
            "close": 1.23, "rank": 7, "quant_score": 88.5, "trend_score": 90.0,
            "momentum_score": 87.0, "relative_strength_score": 86.0,
            "volume_score": 70.0, "volatility_score": 65.0, "liquidity_score": 80.0,
            "price_structure_score": 84.0, "trending_score": 88.0,
            "momentum_strategy_score": 85.0, "meta_score": 86.0,
            "strategy_ensemble_score": 86.333333, "return_20": 0.123,
            "return_60": 0.2, "rs_20": 0.05, "rs_60": 0.08,
            "sector_rs_20": None, "atr_14": 0.0345, "atr_pct": 0.028,
            "average_traded_value_20": 1234567.89, "volume_ratio_20": 1.5,
            "distance_52_week_high": -0.04, "history_days": 300,
            "sector_rs_available": False, "quality_flags": ["SECTOR_RS_UNAVAILABLE"],
            "factor_explanation": {"trend": "Transparent", "momentum": "Measured"},
        }
        self.assertEqual(
            row_hash(record),
            "8f4fff8282c0e612521cc79d1aeeb56a159004efd6f51cbab8e76718140dc12c",
        )

    def test_same_input_is_deterministic(self) -> None:
        first = QuantPipeline(self.config).run(self.bundle)
        second = QuantPipeline(self.config).run(self.bundle)
        self.assertEqual(first.manifest["payload_hash"], second.manifest["payload_hash"])
        self.assertEqual(first.manifest["run_id"], second.manifest["run_id"])

    def test_low_universe_fails_closed(self) -> None:
        with self.assertRaises(ValidationError) as captured:
            QuantPipeline(QuantConfig(min_valid_universe=33, max_market_age_days=None)).run(self.bundle)
        codes = {issue.code for issue in captured.exception.report.issues}
        self.assertIn("UNIVERSE_BELOW_MINIMUM", codes)

    def test_bad_ohlc_fails_closed(self) -> None:
        bars = self.bundle.bars.copy()
        bars.loc[0, "high"] = bars.loc[0, "low"] * 0.5
        broken = replace(self.bundle, bars=bars)
        with self.assertRaises(ValidationError) as captured:
            QuantPipeline(self.config).run(broken)
        self.assertIn(
            "INVALID_OHLCV", {issue.code for issue in captured.exception.report.issues}
        )

    def test_missing_klci_fails_closed(self) -> None:
        benchmarks = self.bundle.benchmarks[
            self.bundle.benchmarks["benchmark"] != "FBMKLCI"
        ].copy()
        broken = replace(self.bundle, benchmarks=benchmarks)
        with self.assertRaises(ValidationError) as captured:
            QuantPipeline(self.config).run(broken)
        self.assertIn(
            "MISSING_BENCHMARK", {issue.code for issue in captured.exception.report.issues}
        )

    def test_future_mutation_cannot_change_prior_cutoff(self) -> None:
        bars = self.bundle.bars.copy()
        benchmarks = self.bundle.benchmarks.copy()
        cutoff = bars["date"].sort_values().unique()[-21]
        prefix = replace(
            self.bundle,
            bars=bars[bars["date"] <= cutoff].copy(),
            benchmarks=benchmarks[benchmarks["date"] <= cutoff].copy(),
            source_market_date=str(np.datetime64(cutoff, "D")),
        )
        mutated = bars.copy()
        mutated.loc[mutated["date"] > cutoff, ["open", "high", "low", "close", "adjusted_close"]] *= 50
        prefix_after_mutation = replace(
            self.bundle,
            bars=mutated[mutated["date"] <= cutoff].copy(),
            benchmarks=benchmarks[benchmarks["date"] <= cutoff].copy(),
            source_market_date=str(np.datetime64(cutoff, "D")),
        )
        first = QuantPipeline(self.config).run(prefix)
        second = QuantPipeline(self.config).run(prefix_after_mutation)
        self.assertEqual(first.manifest["payload_hash"], second.manifest["payload_hash"])

    def test_local_store_is_idempotent_and_rejects_conflict(self) -> None:
        result = QuantPipeline(self.config).run(self.bundle)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "history.sqlite"
            store = ResearchStore(path)
            store.save(result)
            store.save(result)
            with sqlite3.connect(path) as connection:
                self.assertEqual(
                    connection.execute("SELECT COUNT(*) FROM instrument_versions").fetchone()[0],
                    len(result.bundle.instruments),
                )
            conflicting_manifest = {**result.manifest, "payload_hash": "f" * 64}
            conflict = replace(result, manifest=conflicting_manifest)
            with self.assertRaises(RuntimeError):
                store.save(conflict)


@unittest.skipUnless(os.environ.get("BMK_FULL_SMOKE") == "1", "set BMK_FULL_SMOKE=1")
class FullUniverseSmokeTest(unittest.TestCase):
    def test_905_symbol_universe(self) -> None:
        bundle = make_synthetic_bundle(symbols=905, days=270)
        result = QuantPipeline(
            QuantConfig(min_valid_universe=900, max_market_age_days=None)
        ).run(bundle)
        self.assertEqual(len(result.records), 905)
        self.assertEqual(result.records[0]["rank"], 1)
        self.assertEqual(result.records[-1]["rank"], 905)


if __name__ == "__main__":
    unittest.main()
