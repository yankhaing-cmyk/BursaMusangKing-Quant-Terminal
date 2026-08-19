from __future__ import annotations

import hashlib
import math
from typing import Any


HORIZONS = (5, 10, 20, 60)
METHODOLOGY_VERSION = "next-open-v1.0.0"


def score_bucket(score: float) -> str:
    if score < 50:
        return "0-49"
    if score < 60:
        return "50-59"
    if score < 70:
        return "60-69"
    if score < 80:
        return "70-79"
    if score < 85:
        return "80-84"
    if score < 90:
        return "85-89"
    if score < 95:
        return "90-94"
    return "95-100"


def _fixed(value: Any) -> str:
    numeric = float(value)
    if not math.isfinite(numeric):
        raise ValueError("non-finite number in canonical outcome")
    return f"{numeric:.8f}"


def canonical_outcome(record: dict[str, Any]) -> str:
    return "\x1f".join(
        [
            str(record["signal_run_id"]).strip(),
            str(record["symbol"]).strip().upper(),
            str(record["signal_date"]),
            str(record["score_bucket"]),
            str(int(record["horizon"])),
            str(record["entry_date"]),
            str(record["exit_date"]),
            _fixed(record["quant_score"]),
            _fixed(record["entry_open"]),
            _fixed(record["exit_close"]),
            _fixed(record["signal_close"]),
            _fixed(record["forward_return"]),
            _fixed(record["signal_close_return"]),
            _fixed(record["mae"]),
            _fixed(record["mfe"]),
            str(record["computed_run_id"]).strip(),
            str(record["methodology_version"]),
        ]
    )


def outcome_hash(record: dict[str, Any]) -> str:
    return hashlib.sha256(canonical_outcome(record).encode("utf-8")).hexdigest()


def research_payload_hash(records: list[dict[str, Any]]) -> str:
    lines = [
        f"{row['signal_run_id']}:{row['symbol']}:{int(row['horizon'])}:{row['observation_hash']}"
        for row in sorted(
            records,
            key=lambda item: (
                str(item["signal_run_id"]),
                str(item["symbol"]),
                int(item["horizon"]),
            ),
        )
    ]
    return hashlib.sha256("\n".join(lines).encode("utf-8")).hexdigest()
