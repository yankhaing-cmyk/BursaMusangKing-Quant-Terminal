from __future__ import annotations

import hashlib
import json
import math
import sqlite3
from pathlib import Path
from typing import Any, Iterable

import pandas as pd

from .pipeline import QuantResult
from .portfolio import calculate_portfolio_snapshot
from .research import HORIZONS, METHODOLOGY_VERSION, outcome_hash, score_bucket
from .trades import calculate_trade_snapshot


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
CREATE TABLE IF NOT EXISTS local_market_regimes (
  run_id TEXT PRIMARY KEY,
  market_date TEXT NOT NULL,
  methodology_version TEXT NOT NULL,
  regime_label TEXT NOT NULL,
  regime_score REAL NOT NULL,
  row_hash TEXT NOT NULL,
  record_json TEXT NOT NULL,
  UNIQUE (market_date, methodology_version),
  FOREIGN KEY (run_id) REFERENCES local_quant_runs(run_id)
);
CREATE TABLE IF NOT EXISTS local_forward_outcomes (
  signal_run_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  signal_date TEXT NOT NULL,
  score_bucket TEXT NOT NULL,
  horizon INTEGER NOT NULL,
  entry_date TEXT NOT NULL,
  exit_date TEXT NOT NULL,
  quant_score REAL NOT NULL,
  entry_open REAL NOT NULL,
  exit_close REAL NOT NULL,
  signal_close REAL NOT NULL,
  forward_return REAL NOT NULL,
  signal_close_return REAL NOT NULL,
  mae REAL NOT NULL,
  mfe REAL NOT NULL,
  computed_run_id TEXT NOT NULL,
  methodology_version TEXT NOT NULL,
  observation_hash TEXT NOT NULL,
  PRIMARY KEY (signal_run_id, symbol, horizon),
  FOREIGN KEY (signal_run_id) REFERENCES local_quant_runs(run_id),
  FOREIGN KEY (computed_run_id) REFERENCES local_quant_runs(run_id)
);
CREATE INDEX IF NOT EXISTS local_forward_outcomes_computed_run_idx
  ON local_forward_outcomes(computed_run_id);
CREATE TABLE IF NOT EXISTS local_trade_publications (
  run_id TEXT PRIMARY KEY,
  methodology_version TEXT NOT NULL,
  expected_states INTEGER NOT NULL,
  state_payload_hash TEXT NOT NULL,
  expected_events INTEGER NOT NULL,
  event_payload_hash TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES local_quant_runs(run_id)
);
CREATE TABLE IF NOT EXISTS local_trade_state_snapshots (
  run_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  state TEXT NOT NULL,
  trade_id TEXT,
  row_hash TEXT NOT NULL,
  record_json TEXT NOT NULL,
  PRIMARY KEY (run_id, symbol),
  FOREIGN KEY (run_id) REFERENCES local_quant_runs(run_id)
);
CREATE TABLE IF NOT EXISTS local_trade_events (
  event_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  trade_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  row_hash TEXT NOT NULL,
  record_json TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES local_quant_runs(run_id)
);
CREATE INDEX IF NOT EXISTS local_trade_events_run_idx
  ON local_trade_events(run_id, event_type);
CREATE TABLE IF NOT EXISTS local_portfolio_publications (
  run_id TEXT PRIMARY KEY,
  methodology_version TEXT NOT NULL,
  expected_allocations INTEGER NOT NULL,
  allocation_payload_hash TEXT NOT NULL,
  summary_hash TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES local_quant_runs(run_id)
);
CREATE TABLE IF NOT EXISTS local_portfolio_allocations (
  run_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  row_hash TEXT NOT NULL,
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

    def save(self, result: QuantResult) -> list[dict[str, Any]]:
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
            regime_json = json.dumps(
                result.regime, ensure_ascii=False, sort_keys=True, separators=(",", ":")
            )
            connection.execute(
                """INSERT OR IGNORE INTO local_market_regimes
                   (run_id, market_date, methodology_version, regime_label,
                    regime_score, row_hash, record_json)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (
                    run_id,
                    result.validation.market_date,
                    result.regime["methodology_version"],
                    result.regime["regime_label"],
                    result.regime["regime_score"],
                    result.regime["row_hash"],
                    regime_json,
                ),
            )
            stored_regime = connection.execute(
                "SELECT row_hash FROM local_market_regimes WHERE run_id = ?",
                (run_id,),
            ).fetchone()
            if not stored_regime or stored_regime[0] != result.regime["row_hash"]:
                raise RuntimeError("conflicting immutable market regime")
            outcomes = self._materialize_forward_outcomes(connection, result)
            connection.commit()
            return outcomes

    def build_trade_artifacts(
        self,
        result: QuantResult,
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
        run_id = str(result.manifest["run_id"])
        with sqlite3.connect(self.path) as connection:
            connection.executescript(SCHEMA)
            stored_run = connection.execute(
                "SELECT payload_hash FROM local_quant_runs WHERE run_id = ?",
                (run_id,),
            ).fetchone()
            if not stored_run or stored_run[0] != result.manifest["payload_hash"]:
                raise RuntimeError("trade layer requires the matching immutable quant run")

            prior_run = connection.execute(
                """SELECT run_id FROM local_quant_runs
                   WHERE market_date < ? ORDER BY market_date DESC LIMIT 1""",
                (result.validation.market_date,),
            ).fetchone()
            prior_states: list[dict[str, Any]] = []
            if prior_run:
                prior_states = [
                    json.loads(str(row[0]))
                    for row in connection.execute(
                        """SELECT record_json FROM local_trade_state_snapshots
                           WHERE run_id = ? ORDER BY symbol""",
                        (prior_run[0],),
                    )
                ]

            expected_edges = {
                (str(row[0]), str(row[1])): (int(row[2]), float(row[3]))
                for row in connection.execute(
                    """SELECT outcomes.score_bucket, regimes.regime_label,
                              COUNT(*) AS sample_size,
                              AVG(outcomes.forward_return) AS average_return
                       FROM local_forward_outcomes outcomes
                       JOIN local_market_regimes regimes
                         ON regimes.run_id = outcomes.signal_run_id
                       WHERE outcomes.horizon = 20
                       GROUP BY outcomes.score_bucket, regimes.regime_label"""
                )
            }
            states, events, manifest = calculate_trade_snapshot(
                result,
                prior_states,
                expected_edges,
            )
            connection.execute(
                """INSERT OR IGNORE INTO local_trade_publications
                   (run_id, methodology_version, expected_states,
                    state_payload_hash, expected_events, event_payload_hash,
                    manifest_json)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (
                    run_id,
                    manifest["methodology_version"],
                    manifest["expected_states"],
                    manifest["state_payload_hash"],
                    manifest["expected_events"],
                    manifest["event_payload_hash"],
                    json.dumps(manifest, ensure_ascii=False, sort_keys=True),
                ),
            )
            connection.executemany(
                """INSERT OR IGNORE INTO local_trade_state_snapshots
                   (run_id, symbol, state, trade_id, row_hash, record_json)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                [
                    (
                        run_id,
                        row["symbol"],
                        row["state"],
                        row["trade_id"],
                        row["row_hash"],
                        json.dumps(row, ensure_ascii=False, sort_keys=True),
                    )
                    for row in states
                ],
            )
            connection.executemany(
                """INSERT OR IGNORE INTO local_trade_events
                   (event_id, run_id, symbol, trade_id, event_type, row_hash,
                    record_json)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                [
                    (
                        row["event_id"],
                        run_id,
                        row["symbol"],
                        row["trade_id"],
                        row["event_type"],
                        row["row_hash"],
                        json.dumps(row, ensure_ascii=False, sort_keys=True),
                    )
                    for row in events
                ],
            )
            stored_publication = connection.execute(
                """SELECT methodology_version, expected_states,
                          state_payload_hash, expected_events, event_payload_hash
                   FROM local_trade_publications WHERE run_id = ?""",
                (run_id,),
            ).fetchone()
            expected_publication = (
                manifest["methodology_version"],
                manifest["expected_states"],
                manifest["state_payload_hash"],
                manifest["expected_events"],
                manifest["event_payload_hash"],
            )
            if stored_publication != expected_publication:
                raise RuntimeError("conflicting immutable trade publication")
            for row in states:
                stored = connection.execute(
                    """SELECT row_hash FROM local_trade_state_snapshots
                       WHERE run_id = ? AND symbol = ?""",
                    (run_id, row["symbol"]),
                ).fetchone()
                if not stored or stored[0] != row["row_hash"]:
                    raise RuntimeError("conflicting immutable trade state")
            for row in events:
                stored = connection.execute(
                    "SELECT row_hash FROM local_trade_events WHERE event_id = ?",
                    (row["event_id"],),
                ).fetchone()
                if not stored or stored[0] != row["row_hash"]:
                    raise RuntimeError("conflicting immutable trade event")
            connection.commit()
            return states, events, manifest

    def build_portfolio_artifacts(
        self,
        result: QuantResult,
        trade_states: list[dict[str, Any]],
    ) -> tuple[list[dict[str, Any]], dict[str, Any], dict[str, Any]]:
        run_id = str(result.manifest["run_id"])
        with sqlite3.connect(self.path) as connection:
            connection.executescript(SCHEMA)
            allocations, summary, manifest = calculate_portfolio_snapshot(result, trade_states)
            connection.execute(
                """INSERT OR IGNORE INTO local_portfolio_publications
                   (run_id, methodology_version, expected_allocations,
                    allocation_payload_hash, summary_hash, summary_json, manifest_json)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (
                    run_id,
                    manifest["methodology_version"],
                    manifest["expected_allocations"],
                    manifest["allocation_payload_hash"],
                    manifest["summary_hash"],
                    json.dumps(summary, ensure_ascii=False, sort_keys=True),
                    json.dumps(manifest, ensure_ascii=False, sort_keys=True),
                ),
            )
            connection.executemany(
                """INSERT OR IGNORE INTO local_portfolio_allocations
                   (run_id, symbol, row_hash, record_json) VALUES (?, ?, ?, ?)""",
                [
                    (
                        run_id,
                        row["symbol"],
                        row["row_hash"],
                        json.dumps(row, ensure_ascii=False, sort_keys=True),
                    )
                    for row in allocations
                ],
            )
            stored = connection.execute(
                """SELECT methodology_version, expected_allocations,
                          allocation_payload_hash, summary_hash
                   FROM local_portfolio_publications WHERE run_id = ?""",
                (run_id,),
            ).fetchone()
            expected = (
                manifest["methodology_version"],
                manifest["expected_allocations"],
                manifest["allocation_payload_hash"],
                manifest["summary_hash"],
            )
            if stored != expected:
                raise RuntimeError("conflicting immutable portfolio publication")
            for row in allocations:
                stored_row = connection.execute(
                    """SELECT row_hash FROM local_portfolio_allocations
                       WHERE run_id = ? AND symbol = ?""",
                    (run_id, row["symbol"]),
                ).fetchone()
                if not stored_row or stored_row[0] != row["row_hash"]:
                    raise RuntimeError("conflicting immutable portfolio allocation")
            connection.commit()
            return allocations, summary, manifest

    @staticmethod
    def _materialize_forward_outcomes(
        connection: sqlite3.Connection,
        result: QuantResult,
    ) -> list[dict[str, Any]]:
        computed_run_id = str(result.manifest["run_id"])
        current_market_date = str(result.validation.market_date)
        prior_scores = connection.execute(
            """SELECT scores.run_id, scores.symbol, scores.quant_score,
                      scores.record_json, runs.market_date
               FROM local_daily_scores scores
               JOIN local_quant_runs runs ON runs.run_id = scores.run_id
               WHERE runs.market_date < ?
               ORDER BY runs.market_date, scores.symbol""",
            (current_market_date,),
        ).fetchall()
        if not prior_scores:
            return []

        existing = {
            (str(row[0]), str(row[1]), int(row[2])): str(row[3])
            for row in connection.execute(
                """SELECT signal_run_id, symbol, horizon, observation_hash
                   FROM local_forward_outcomes"""
            )
        }
        bars = result.bundle.bars.copy()
        bars["date"] = pd.to_datetime(bars["date"], utc=False).dt.normalize()
        bars = bars.sort_values(["symbol", "date"], kind="mergesort")
        grouped = {
            str(symbol): frame.reset_index(drop=True)
            for symbol, frame in bars.groupby("symbol", sort=False)
        }

        materialized: list[dict[str, Any]] = []
        for signal_run_id, symbol, quant_score, record_json, signal_date in prior_scores:
            history = grouped.get(str(symbol))
            if history is None or history.empty:
                continue
            signal_timestamp = pd.Timestamp(str(signal_date))
            future = history[history["date"] > signal_timestamp].reset_index(drop=True)
            if future.empty:
                continue
            record = json.loads(str(record_json))
            signal_close = float(record["close"])
            for horizon in HORIZONS:
                key = (str(signal_run_id), str(symbol), horizon)
                if key in existing or len(future) < horizon:
                    continue
                window = future.iloc[:horizon]
                entry = window.iloc[0]
                exit_row = window.iloc[-1]
                entry_open = float(entry["open"])
                exit_close = float(exit_row["close"])
                if not all(
                    math.isfinite(value) and value > 0
                    for value in (entry_open, exit_close, signal_close)
                ):
                    continue
                low_returns = window["low"].astype(float) / entry_open - 1.0
                high_returns = window["high"].astype(float) / entry_open - 1.0
                outcome = {
                    "signal_run_id": str(signal_run_id),
                    "symbol": str(symbol),
                    "signal_date": str(signal_date),
                    "score_bucket": score_bucket(float(quant_score)),
                    "horizon": horizon,
                    "entry_date": str(pd.Timestamp(entry["date"]).date()),
                    "exit_date": str(pd.Timestamp(exit_row["date"]).date()),
                    "quant_score": float(quant_score),
                    "entry_open": entry_open,
                    "exit_close": exit_close,
                    "signal_close": signal_close,
                    "forward_return": exit_close / entry_open - 1.0,
                    "signal_close_return": exit_close / signal_close - 1.0,
                    "mae": min(0.0, float(low_returns.min())),
                    "mfe": max(0.0, float(high_returns.max())),
                    "computed_run_id": computed_run_id,
                    "methodology_version": METHODOLOGY_VERSION,
                }
                outcome["observation_hash"] = outcome_hash(outcome)
                materialized.append(outcome)

        if not materialized:
            return []
        connection.executemany(
            """INSERT OR IGNORE INTO local_forward_outcomes
               (signal_run_id, symbol, signal_date, score_bucket, horizon,
                entry_date, exit_date, quant_score, entry_open, exit_close,
                signal_close, forward_return, signal_close_return, mae, mfe,
                computed_run_id, methodology_version, observation_hash)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            [
                (
                    row["signal_run_id"], row["symbol"], row["signal_date"],
                    row["score_bucket"], row["horizon"], row["entry_date"],
                    row["exit_date"], row["quant_score"], row["entry_open"],
                    row["exit_close"], row["signal_close"], row["forward_return"],
                    row["signal_close_return"], row["mae"], row["mfe"],
                    row["computed_run_id"], row["methodology_version"],
                    row["observation_hash"],
                )
                for row in materialized
            ],
        )
        for row in materialized:
            stored = connection.execute(
                """SELECT observation_hash FROM local_forward_outcomes
                   WHERE signal_run_id = ? AND symbol = ? AND horizon = ?""",
                (row["signal_run_id"], row["symbol"], row["horizon"]),
            ).fetchone()
            if not stored or stored[0] != row["observation_hash"]:
                raise RuntimeError("conflicting immutable forward outcome")
        return materialized
