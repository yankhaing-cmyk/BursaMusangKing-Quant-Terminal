from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

from .models import MarketDataBundle


SECTORS = (
    "Technology",
    "Health Care",
    "Industrial Products",
    "Consumer Products",
    "Energy",
    "Transportation",
    "Construction",
    "REIT",
    "Plantation",
    "Financial Services",
)


def make_synthetic_bundle(
    symbols: int = 40,
    days: int = 300,
    market_date: str = "2026-08-14",
    seed: int = 731,
) -> MarketDataBundle:
    if symbols < 2 or days < 260:
        raise ValueError("synthetic smoke data requires >=2 symbols and >=260 days")
    random = np.random.default_rng(seed)
    dates = pd.bdate_range(end=market_date, periods=days)
    instrument_rows: list[dict[str, object]] = []
    bar_frames: list[pd.DataFrame] = []
    for index in range(symbols):
        symbol = f"Q{index + 1:04d}"
        sector_index = index % len(SECTORS)
        sector = SECTORS[sector_index]
        drift = -0.00025 + (index / max(symbols - 1, 1)) * 0.0013
        volatility = 0.009 + (index % 9) * 0.0015
        returns = random.normal(drift, volatility, days)
        close = (0.55 + index * 0.012) * np.exp(np.cumsum(returns))
        overnight = random.normal(0, volatility * 0.25, days)
        open_ = close * (1 + overnight)
        intraday = np.abs(random.normal(volatility * 0.7, volatility * 0.25, days))
        high = np.maximum(open_, close) * (1 + intraday)
        low = np.minimum(open_, close) * np.maximum(0.5, 1 - intraday)
        base_volume = 15_000 if index < 3 else 180_000 + index * 13_000
        volume = random.lognormal(np.log(base_volume), 0.45, days).round()
        bar_frames.append(
            pd.DataFrame(
                {
                    "symbol": symbol,
                    "date": dates,
                    "open": open_,
                    "high": high,
                    "low": low,
                    "close": close,
                    "adjusted_close": close,
                    "volume": volume,
                }
            )
        )
        instrument_rows.append(
            {
                "symbol": symbol,
                "name": f"Synthetic Counter {index + 1}",
                "sector": sector,
                "sector_benchmark": f"SECTOR{sector_index:02d}",
                "board": "MAIN" if index % 4 else "ACE",
                "security_type": "REIT" if sector == "REIT" else "EQUITY",
                "listing_date": "2015-01-02",
                "active": True,
                "suspended": False,
                "source_id": symbol,
            }
        )
    benchmark_rows: list[pd.DataFrame] = []
    market_returns = random.normal(0.0002, 0.0055, days)
    market_close = 1_500 * np.exp(np.cumsum(market_returns))
    benchmark_rows.append(
        pd.DataFrame({"benchmark": "FBMKLCI", "date": dates, "close": market_close})
    )
    for sector_index in range(len(SECTORS)):
        sector_returns = market_returns + random.normal(
            (sector_index - 4.5) * 0.00002, 0.0025, days
        )
        benchmark_rows.append(
            pd.DataFrame(
                {
                    "benchmark": f"SECTOR{sector_index:02d}",
                    "date": dates,
                    "close": 100 * np.exp(np.cumsum(sector_returns)),
                }
            )
        )
    return MarketDataBundle(
        instruments=pd.DataFrame(instrument_rows),
        bars=pd.concat(bar_frames, ignore_index=True),
        benchmarks=pd.concat(benchmark_rows, ignore_index=True),
        provider="SYNTHETIC_TEST_ONLY",
        source_market_date=market_date,
        metadata={"fixture": True, "production_blocked": False},
    )


def write_synthetic_directory(bundle: MarketDataBundle, directory: str | Path) -> None:
    path = Path(directory)
    path.mkdir(parents=True, exist_ok=True)
    bundle.instruments.to_csv(path / "instruments.csv", index=False)
    bundle.bars.to_csv(path / "bars.csv", index=False)
    bundle.benchmarks.to_csv(path / "benchmarks.csv", index=False)
    (path / "source.json").write_text(
        json.dumps(
            {
                "provider": bundle.provider,
                "market_date": bundle.source_market_date,
                "fixture": True,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

