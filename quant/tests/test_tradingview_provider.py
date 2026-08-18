from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from typing import Callable

import numpy as np
import pandas as pd

from bmk_quant.providers import TradingViewFreeProvider


class FakeResponse:
    def __init__(self, payload: dict[str, object]):
        self.payload = payload

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict[str, object]:
        return self.payload


class FakeScannerSession:
    def __init__(self, payload: dict[str, object]):
        self.payload = payload
        self.requests: list[dict[str, object]] = []

    def post(self, url: str, **kwargs: object) -> FakeResponse:
        self.requests.append({"url": url, **kwargs})
        return FakeResponse(self.payload)


class FakeTvDatafeed:
    def __init__(self, histories: dict[str, pd.DataFrame | None]):
        self.histories = histories
        self.calls: list[tuple[str, str, object, int]] = []

    def get_hist(
        self,
        *,
        symbol: str,
        exchange: str,
        interval: object,
        n_bars: int,
    ) -> pd.DataFrame | None:
        self.calls.append((symbol, exchange, interval, n_bars))
        history = self.histories.get(symbol)
        return None if history is None else history.tail(n_bars).copy()


def history(days: int = 270) -> pd.DataFrame:
    dates = pd.bdate_range(end="2026-08-14", periods=days)
    close = np.linspace(1.0, 2.0, days)
    return pd.DataFrame(
        {
            "symbol": "unused",
            "open": close * 0.995,
            "high": close * 1.01,
            "low": close * 0.99,
            "close": close,
            "volume": np.linspace(100_000, 200_000, days),
        },
        index=dates,
    )


def scanner_payload(*, total_count: int = 2) -> dict[str, object]:
    return {
        "totalCount": total_count,
        "data": [
            {
                "s": "MYX:0001",
                "d": [
                    "0001",
                    "Alpha Berhad",
                    "Technology Services",
                    "Information Technology Services",
                    "stock",
                    "common",
                    2.0,
                    200_000,
                    400_000,
                    1_000_000_000,
                ],
            },
            {
                "s": "MYX:0002",
                "d": [
                    "0002",
                    "Beta Berhad",
                    "Producer Manufacturing",
                    "Industrial Machinery",
                    "stock",
                    "common",
                    2.0,
                    200_000,
                    400_000,
                    900_000_000,
                ],
            },
        ],
    }


class TradingViewFreeProviderTests(unittest.TestCase):
    def provider(
        self,
        cache_dir: Path,
        scanner: FakeScannerSession,
        client: FakeTvDatafeed,
        *,
        clock: Callable[[], pd.Timestamp] | None = None,
    ) -> TradingViewFreeProvider:
        return TradingViewFreeProvider(
            cache_dir=cache_dir,
            n_bars=270,
            request_delay=0,
            scanner_session=scanner,
            tv_factory=lambda: client,
            daily_interval="1D",
            sleeper=lambda _seconds: None,
            clock=clock,
        )

    def test_fetches_anonymous_full_universe_and_reuses_daily_cache(self) -> None:
        histories = {"FBMKLCI": history(), "0001": history(), "0002": history()}
        with tempfile.TemporaryDirectory() as directory:
            cache_dir = Path(directory)
            first_client = FakeTvDatafeed(histories)
            first_scanner = FakeScannerSession(scanner_payload())
            first = self.provider(cache_dir, first_scanner, first_client).fetch()

            self.assertEqual(len(first.instruments), 2)
            self.assertEqual(len(first.bars), 540)
            self.assertEqual(len(first.benchmarks), 270)
            self.assertEqual(first.source_market_date, "2026-08-14")
            self.assertEqual(first.provider, "TradingView free/no-login via tvDatafeed")
            self.assertEqual(first.metadata["authentication"], "anonymous")
            self.assertFalse(first.metadata["data_rights_confirmed"])
            self.assertEqual(first.metadata["history_success"], 2)
            self.assertEqual(first.metadata["full_fetches"], 2)
            self.assertEqual(
                [call[0] for call in first_client.calls],
                ["FBMKLCI", "0001", "0002"],
            )
            self.assertNotIn("Authorization", first_scanner.requests[0]["headers"])

            second_client = FakeTvDatafeed(histories)
            second_scanner = FakeScannerSession(scanner_payload())
            second = self.provider(cache_dir, second_scanner, second_client).fetch()

            self.assertEqual(second.metadata["cache_hits"], 2)
            self.assertEqual([call[0] for call in second_client.calls], ["FBMKLCI"])
            self.assertEqual(len(list(cache_dir.glob("*.csv"))), 2)

    def test_rejects_partial_scanner_response(self) -> None:
        scanner = FakeScannerSession(scanner_payload(total_count=3))
        with tempfile.TemporaryDirectory() as directory:
            provider = self.provider(
                Path(directory), scanner, FakeTvDatafeed({"FBMKLCI": history()})
            )
            with self.assertRaisesRegex(RuntimeError, "returned 2 of 3 rows"):
                provider.fetch()

    def test_rejects_missing_klci_history_before_stock_screening(self) -> None:
        scanner = FakeScannerSession(scanner_payload())
        client = FakeTvDatafeed({"FBMKLCI": None, "0001": history(), "0002": history()})
        with tempfile.TemporaryDirectory() as directory:
            provider = self.provider(Path(directory), scanner, client)
            with self.assertRaisesRegex(RuntimeError, "FBMKLCI history"):
                provider.fetch()
        self.assertEqual({call[0] for call in client.calls}, {"FBMKLCI"})

    def test_intraday_run_uses_only_the_prior_completed_session(self) -> None:
        live_history = history(days=272)
        live_history.index = pd.bdate_range(end="2026-08-18", periods=272)
        histories = {
            "FBMKLCI": live_history,
            "0001": live_history,
            "0002": live_history,
        }
        scanner = FakeScannerSession(scanner_payload())
        client = FakeTvDatafeed(histories)
        with tempfile.TemporaryDirectory() as directory:
            provider = self.provider(
                Path(directory),
                scanner,
                client,
                clock=lambda: pd.Timestamp("2026-08-18 12:45", tz="Asia/Kuala_Lumpur"),
            )
            bundle = provider.fetch()

        self.assertEqual(bundle.source_market_date, "2026-08-17")
        self.assertEqual(str(bundle.bars["date"].max().date()), "2026-08-17")
        self.assertEqual(str(bundle.benchmarks["date"].max().date()), "2026-08-17")


if __name__ == "__main__":
    unittest.main()
