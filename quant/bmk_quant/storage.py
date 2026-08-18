from __future__ import annotations

import hashlib
import json
import sqlite3
from pathlib import Path
from typing import Any, Iterable

import pandas as pd

from .pipeline import QuantResult


SCHEMA = """
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS raw_bar_versions (
  symbol TEXT NOT NULL,
  date TEXT NOT NULL,
  open REAL NOT NULL,
  high REAL NOT NULL,
  low REAL NOT NULL,
  close REAL NOT NULL,
  adjusted_close REAL NOT NULL,
  volume REAL NOT NULL,
  source_hash TEXT NOT NULL,
  provider TEXT NOT NULL,
  observed_run_id TEXT NOT NULL,
  PRIMARY KEY (symbol, date, source_hash)
);
CREATE INDEX IF NOT EXISTS raw_bar_versions_symbol_date_idx
  ON raw_bar_versions(symbol, date);
CREATE TABLE IF NOT EXISTS instrument_versions (
  symbol TEXT NOT NULL,
  observed_run_id TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  record_json TEXT NOT NULL,
  PRIMARY KEY (symbol, observed_run_id, source_hash)
);
CREATE TABLE IF NOT EXISTS benchmark_bar_versions (
  benchmark TEXT NOT NULL,
  date TEXT NOT NULL,
  close REAL NOT NULL,
  source_hash TEXT NOT NULL,
  provider TEXT NOT NULL,
  observed_run_id TEXT NOT NULL,
  PRIMARY KEY (benchmark, date, source_hash)
);
CREATE TABLE IF NOT EXISTS local_quant_runs (
  run_id TEXT PRIMARY KEY,
  market_date TEXT NOT NULL,
  model_version TEXT NOT NULL,
  provider TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  valid_symbols INTEGER NOT NULL,
  manifest_json TEXT NOT NULL,
  UNIQUE (market_date, model_version, payload_hash)
);
CREATE TABLE IF NOT EXISTS local_daily_scores (
  run_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  rank INTEGER NOT NULL,
  quant_score REAL NOT NULL,
  record_json TEXT NOT NULL,
  PRIMARY KEY (run_id, symbol),
  FOREIGN KEY (run_id) REFERENCES local_quant_runs(run_id)
);
"""


def _hash_fields(values: Iterable[Any]) -> str:
    content = "\x1f".join("" if value is None else str(value) for value in values)
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


class ResearchStore:
    """Append-only local research store used by the heavy Python workflow."""

    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def save(self, result: QuantResult) -> None:
        run_id = str(result.manifest["run_id"])
        with sqlite3.connect(self.path) as connection:
            connection.executescript(SCHEMA)
            conflict = connection.execute(
                "SELECT payload_hash FROM local_quant_runs WHERE market_date = ? AND model_version = ?",
                (result.validation.market_date, result.manifest["model_version"]),
            ).fetchone()
            if conflict and conflict[0] != result.manifest["payload_hash"]:
                raise RuntimeError("conflicting local payload for market date/model version")
            connection.execute(
                """INSERT OR IGNORE INTO local_quant_runs
                   (run_id, market_date, model_version, provider, payload_hash,
                    valid_symbols, manifest_json)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (
                    run_id,
                    result.validation.market_date,
                    result.manifest["model_version"],
                    result.bundle.provider,
                    result.manifest["payload_hash"],
                    len(result.records),
                    json.dumps(result.manifest, ensure_ascii=False, sort_keys=True),
                ),
            )
            bar_rows = []
            for row in result.bundle.bars.itertuples(index=False):
                values = (
                    row.symbol,
                    str(pd.Timestamp(row.date).date()),
                    float(row.open),
                    float(row.high),
                    float(row.low),
                    float(row.close),
                    float(row.adjusted_close),
                    float(row.volume),
                )
                bar_rows.append(
                    (*values, _hash_fields(values), result.bundle.provider, run_id)
                )
            connection.executemany(
                """INSERT OR IGNORE INTO raw_bar_versions
                   (symbol, date, open, high, low, close, adjusted_close, volume,
                    source_hash, provider, observed_run_id)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                bar_rows,
            )
            instrument_rows = []
            for record in result.bundle.instruments.to_dict(orient="records"):
                serializable = {
                    key: (
                        None
                        if pd.isna(value)
                        else str(value.date())
                        if isinstance(value, pd.Timestamp)
                        else bool(value)
                        if isinstance(value, (bool,))
                        else value
                    )
                    for key, value in record.items()
                }
                record_json = json.dumps(
                    serializable, ensure_ascii=False, sort_keys=True, default=str
                )
                instrument_rows.append(
                    (
                        str(record["symbol"]),
                        run_id,
                        hashlib.sha256(record_json.encode("utf-8")).hexdigest(),
                        record_json,
                    )
                )
            connection.executemany(
                """INSERT OR IGNORE INTO instrument_versions
                   (symbol, observed_run_id, source_hash, record_json)
                   VALUES (?, ?, ?, ?)""",
                instrument_rows,
            )
            benchmark_rows = []
            for row in result.bundle.benchmarks.itertuples(index=False):
                values = (
                    row.benchmark,
                    str(pd.Timestamp(row.date).date()),
                    float(row.close),
                )
                benchmark_rows.append(
                    (*values, _hash_fields(values), result.bundle.provider, run_id)
                )
            connection.executemany(
                """INSERT OR IGNORE INTO benchmark_bar_versions
                   (benchmark, date, close, source_hash, provider, observed_run_id)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                benchmark_rows,
            )
            connection.executemany(
                """INSERT OR IGNORE INTO local_daily_scores
                   (run_id, symbol, rank, quant_score, record_json)
                   VALUES (?, ?, ?, ?, ?)""",
                [
                    (
                        run_id,
                        record["symbol"],
                        record["rank"],
                        record["quant_score"],
                        json.dumps(record, ensure_ascii=False, sort_keys=True),
                    )
                    for record in result.records
                ],
            )
            connection.commit()
