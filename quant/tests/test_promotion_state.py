from __future__ import annotations

import sqlite3
import tempfile
import unittest
from pathlib import Path


PROMOTE = """UPDATE quant_runs
SET status = 'ACTIVE', received_symbols = ?, committed_at = ?
WHERE id = ? AND status = 'PENDING'
  AND NOT EXISTS (
    SELECT 1 FROM quant_runs active
    WHERE active.status = 'ACTIVE'
      AND active.market_date >= quant_runs.market_date
  )"""

SUPERSEDE_OLDER = """UPDATE quant_runs
SET status = 'SUPERSEDED'
WHERE status = 'ACTIVE' AND id <> ?
  AND market_date < (
    SELECT market_date FROM quant_runs promoted
    WHERE promoted.id = ? AND promoted.status = 'ACTIVE'
  )"""

POINT_APP = """INSERT INTO app_state (key, value, updated_at)
SELECT 'active_run_id', id, ? FROM quant_runs
WHERE id = ? AND status = 'ACTIVE'
  AND NOT EXISTS (
    SELECT 1 FROM quant_runs newer
    WHERE newer.status = 'ACTIVE'
      AND newer.market_date > quant_runs.market_date
  )
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"""


class PromotionStateTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.connection = sqlite3.connect(Path(self.temporary.name) / "state.sqlite")
        root = Path(__file__).resolve().parents[2]
        for migration in sorted((root / "drizzle").glob("*.sql")):
            self.connection.executescript(migration.read_text(encoding="utf-8"))

    def tearDown(self) -> None:
        self.connection.close()
        self.temporary.cleanup()

    def add_run(self, run_id: str, market_date: str, status: str) -> None:
        self.connection.execute(
            """INSERT INTO quant_runs
               (id, market_date, status, provider, model_version, payload_hash,
                expected_symbols, received_symbols, valid_symbols, total_instruments,
                benchmark_date, validation_json, started_at)
               VALUES (?, ?, ?, 'test', 'quant-v1.0.0', ?, 900, 900, 900, 900, ?, '{}', 'now')""",
            (run_id, market_date, status, (run_id * 64)[:64], market_date),
        )

    def promote(self, run_id: str) -> None:
        with self.connection:
            self.connection.execute(PROMOTE, (900, "later", run_id))
            self.connection.execute(SUPERSEDE_OLDER, (run_id, run_id))
            self.connection.execute(POINT_APP, ("later", run_id))

    def test_newer_verified_run_replaces_older_run(self) -> None:
        self.add_run("old", "2026-08-14", "ACTIVE")
        self.add_run("new", "2026-08-15", "PENDING")
        self.connection.execute(
            "INSERT INTO app_state VALUES ('active_run_id', 'old', 'now')"
        )
        self.promote("new")
        states = dict(self.connection.execute("SELECT id, status FROM quant_runs"))
        pointer = self.connection.execute(
            "SELECT value FROM app_state WHERE key = 'active_run_id'"
        ).fetchone()[0]
        self.assertEqual(states, {"old": "SUPERSEDED", "new": "ACTIVE"})
        self.assertEqual(pointer, "new")

    def test_older_run_cannot_replace_newer_active_date(self) -> None:
        self.add_run("active", "2026-08-15", "ACTIVE")
        self.add_run("stale", "2026-08-14", "PENDING")
        self.connection.execute(
            "INSERT INTO app_state VALUES ('active_run_id', 'active', 'now')"
        )
        self.promote("stale")
        status = self.connection.execute(
            "SELECT status FROM quant_runs WHERE id = 'stale'"
        ).fetchone()[0]
        pointer = self.connection.execute(
            "SELECT value FROM app_state WHERE key = 'active_run_id'"
        ).fetchone()[0]
        self.assertEqual(status, "PENDING")
        self.assertEqual(pointer, "active")

    def test_same_date_conflict_cannot_replace_active_payload(self) -> None:
        self.add_run("active", "2026-08-15", "ACTIVE")
        self.add_run("conflict", "2026-08-15", "PENDING")
        self.connection.execute(
            "INSERT INTO app_state VALUES ('active_run_id', 'active', 'now')"
        )
        self.promote("conflict")
        self.assertEqual(
            self.connection.execute(
                "SELECT status FROM quant_runs WHERE id = 'conflict'"
            ).fetchone()[0],
            "PENDING",
        )
        self.assertEqual(
            self.connection.execute(
                "SELECT value FROM app_state WHERE key = 'active_run_id'"
            ).fetchone()[0],
            "active",
        )


if __name__ == "__main__":
    unittest.main()
