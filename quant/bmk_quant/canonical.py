from __future__ import annotations

import hashlib
import json
import math
from typing import Any


CANONICAL_FIELDS = (
    "symbol",
    "name",
    "sector",
    "close",
    "rank",
    "quant_score",
    "trend_score",
    "momentum_score",
    "relative_strength_score",
    "volume_score",
    "volatility_score",
    "liquidity_score",
    "price_structure_score",
    "trending_score",
    "momentum_strategy_score",
    "meta_score",
    "strategy_ensemble_score",
    "return_20",
    "return_60",
    "rs_20",
    "rs_60",
    "sector_rs_20",
    "atr_14",
    "atr_pct",
    "average_traded_value_20",
    "volume_ratio_20",
    "distance_52_week_high",
    "history_days",
    "sector_rs_available",
    "quality_flags",
    "factor_explanation",
)


def _fixed(value: Any) -> str:
    if value is None:
        return ""
    numeric = float(value)
    if not math.isfinite(numeric):
        raise ValueError("non-finite number in canonical score")
    return f"{numeric:.8f}"


def _stable_json(value: Any) -> str:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )


def canonical_score(record: dict[str, Any]) -> str:
    values = [
        str(record["symbol"]).strip().upper(),
        str(record["name"]).strip(),
        str(record["sector"]).strip(),
        _fixed(record["close"]),
        str(int(record["rank"])),
    ]
    values.extend(_fixed(record[field]) for field in CANONICAL_FIELDS[5:17])
    values.extend(_fixed(record[field]) for field in CANONICAL_FIELDS[17:27])
    values.extend(
        [
            str(int(record["history_days"])),
            "1" if bool(record["sector_rs_available"]) else "0",
            _stable_json(sorted(record["quality_flags"])),
            _stable_json(record["factor_explanation"]),
        ]
    )
    return "\x1f".join(values)


def row_hash(record: dict[str, Any]) -> str:
    return hashlib.sha256(canonical_score(record).encode("utf-8")).hexdigest()


def payload_hash(records: list[dict[str, Any]]) -> str:
    lines = [f"{record['symbol']}:{record['row_hash']}" for record in sorted(records, key=lambda row: row["symbol"])]
    return hashlib.sha256("\n".join(lines).encode("utf-8")).hexdigest()

