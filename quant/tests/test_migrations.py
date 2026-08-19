from __future__ import annotations

import sqlite3
import tempfile
import unittest
from pathlib import Path


class MigrationTests(unittest.TestCase):
    def test_migrations_apply_to_clean_database(self) -> None:
        root = Path(__file__).resolve().parents[2]
        migrations = sorted((root / "drizzle").glob("*.sql"))
        self.assertGreaterEqual(len(migrations), 1)
        with tempfile.TemporaryDirectory() as directory:
            connection = sqlite3.connect(Path(directory) / "schema.sqlite")
            try:
                for migration in migrations:
                    connection.executescript(migration.read_text(encoding="utf-8"))
                columns = {
                    row[1]
                    for row in connection.execute("PRAGMA table_info(daily_scores)").fetchall()
                }
                self.assertIn("row_hash", columns)
                self.assertIn("quant_score", columns)
                tables = {
                    row[0]
                    for row in connection.execute(
                        "SELECT name FROM sqlite_master WHERE type='table'"
                    ).fetchall()
                }
                self.assertTrue(
                    {
                        "quant_runs",
                        "daily_scores",
                        "instruments",
                        "app_state",
                        "market_regimes",
                        "research_regime_stats",
                    }
                    <= tables
                )
            finally:
                connection.close()


if __name__ == "__main__":
    unittest.main()
