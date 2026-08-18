from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

from ..models import MarketDataBundle


class DirectoryProvider:
    """Read the documented three-file market-data contract from a directory."""

    def __init__(self, directory: str | Path):
        self.directory = Path(directory)

    def fetch(self) -> MarketDataBundle:
        required = {
            "instruments": self.directory / "instruments.csv",
            "bars": self.directory / "bars.csv",
            "benchmarks": self.directory / "benchmarks.csv",
        }
        missing = [str(path) for path in required.values() if not path.is_file()]
        if missing:
            raise FileNotFoundError(f"missing provider files: {', '.join(missing)}")
        metadata_path = self.directory / "source.json"
        metadata = (
            json.loads(metadata_path.read_text(encoding="utf-8"))
            if metadata_path.is_file()
            else {}
        )
        if metadata.get("fixture") is True:
            # Only the CLI's explicit --allow-fixture path may clear this marker.
            metadata["production_blocked"] = True
        return MarketDataBundle(
            instruments=pd.read_csv(required["instruments"]),
            bars=pd.read_csv(required["bars"]),
            benchmarks=pd.read_csv(required["benchmarks"]),
            provider=str(metadata.get("provider") or f"directory:{self.directory.name}"),
            source_market_date=metadata.get("market_date"),
            metadata=metadata,
        )
