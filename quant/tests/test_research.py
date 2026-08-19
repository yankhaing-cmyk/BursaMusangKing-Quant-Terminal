from __future__ import annotations

import unittest

from bmk_quant.research import outcome_hash, research_payload_hash, score_bucket


class ResearchTests(unittest.TestCase):
    def test_score_bucket_boundaries(self) -> None:
        expected = {
            0: "0-49",
            49.999: "0-49",
            50: "50-59",
            60: "60-69",
            70: "70-79",
            80: "80-84",
            85: "85-89",
            90: "90-94",
            95: "95-100",
            100: "95-100",
        }
        for score, bucket in expected.items():
            self.assertEqual(score_bucket(score), bucket)

    def test_outcome_hash_matches_worker_golden_value(self) -> None:
        outcome = {
            "signal_run_id": "qv1-20260818-example",
            "symbol": "L&G",
            "signal_date": "2026-08-18",
            "score_bucket": "85-89",
            "horizon": 5,
            "entry_date": "2026-08-19",
            "exit_date": "2026-08-25",
            "quant_score": 87.25,
            "entry_open": 1.2,
            "exit_close": 1.32,
            "signal_close": 1.18,
            "forward_return": 0.1,
            "signal_close_return": 0.1186440678,
            "mae": -0.0416666667,
            "mfe": 0.125,
            "computed_run_id": "qv1-20260825-example",
            "methodology_version": "next-open-v1.0.0",
        }
        outcome["observation_hash"] = outcome_hash(outcome)
        self.assertEqual(
            outcome["observation_hash"],
            "0d9833c6148c875c28941dc49e577f14bf763f3bc64b888877da1a0ed130dd55",
        )
        self.assertEqual(len(research_payload_hash([outcome])), 64)


if __name__ == "__main__":
    unittest.main()
