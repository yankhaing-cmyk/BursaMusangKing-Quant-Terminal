from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

import numpy as np
import pandas as pd

from .canonical import payload_hash, row_hash
from .config import MODEL_VERSION, QuantConfig
from .factors import calculate_raw_factors
from .models import MarketDataBundle, ValidationError, ValidationReport
from .regime import calculate_market_regime
from .scoring import calculate_scores, validate_scores
from .validation import normalize_bundle, validate_bundle


EXPLANATION = {
    "trend": "MA alignment, slopes, higher-high/higher-low structure, 52-week-high proximity and breakout strength.",
    "momentum": "20D, 60D, 120D and 252D returns, acceleration and consistency.",
    "relative_strength": "Stock returns less FBM KLCI and, where available, its point-in-time sector benchmark.",
    "volume": "Relative participation, volume acceleration, up/down volume and breakout confirmation.",
    "volatility": "ATR, realized/downside volatility, drawdown and gap behavior; lower risk scores higher.",
    "liquidity": "Average traded value/volume, zero-volume days and an Amihud-style spread proxy.",
    "ensemble": "Mean of transparent Trending, Momentum Strategy and M.E.T.A. subscores.",
}


@dataclass(frozen=True)
class QuantResult:
    bundle: MarketDataBundle
    validation: ValidationReport
    raw_factors: pd.DataFrame
    scores: pd.DataFrame
    regime: dict[str, Any]
    instruments: tuple[dict[str, Any], ...]
    records: tuple[dict[str, Any], ...]
    manifest: dict[str, Any]


def _nullable(value: Any) -> float | None:
    if value is None or not np.isfinite(value):
        return None
    return round(float(value), 8)


def _record(row: pd.Series) -> dict[str, Any]:
    flags: list[str] = []
    if int(row["history_days"]) < 260:
        flags.append("SHORT_HISTORY")
    if not bool(row["sector_rs_available"]):
        flags.append("SECTOR_RS_UNAVAILABLE")
    if float(row["average_traded_value_20"]) < 100_000:
        flags.append("ILLIQUID_SCORE_CAP")
    if float(row["zero_volume_rate_60"]) > 0.10:
        flags.append("INTERMITTENT_TRADING")
    record: dict[str, Any] = {
        "symbol": str(row["symbol"]),
        "name": str(row["name"]),
        "sector": str(row["sector"]),
        "close": round(float(row["close"]), 8),
        "rank": int(row["rank"]),
        "quant_score": round(float(row["quant_score"]), 6),
        "trend_score": round(float(row["trend_score"]), 6),
        "momentum_score": round(float(row["momentum_score"]), 6),
        "relative_strength_score": round(float(row["relative_strength_score"]), 6),
        "volume_score": round(float(row["volume_score"]), 6),
        "volatility_score": round(float(row["volatility_score"]), 6),
        "liquidity_score": round(float(row["liquidity_score"]), 6),
        "price_structure_score": round(float(row["price_structure_score"]), 6),
        "trending_score": round(float(row["trending_score"]), 6),
        "momentum_strategy_score": round(float(row["momentum_strategy_score"]), 6),
        "meta_score": round(float(row["meta_score"]), 6),
        "strategy_ensemble_score": round(float(row["strategy_ensemble_score"]), 6),
        "return_20": _nullable(row["return_20"]),
        "return_60": _nullable(row["return_60"]),
        "rs_20": _nullable(row["rs_20"]),
        "rs_60": _nullable(row["rs_60"]),
        "sector_rs_20": _nullable(row["sector_rs_20"]),
        "atr_14": _nullable(row["atr_14"]),
        "atr_pct": _nullable(row["atr_pct"]),
        "average_traded_value_20": _nullable(row["average_traded_value_20"]),
        "volume_ratio_20": _nullable(row["volume_ratio_20"]),
        "distance_52_week_high": _nullable(row["distance_52_week_high"]),
        "history_days": int(row["history_days"]),
        "sector_rs_available": bool(row["sector_rs_available"]),
        "quality_flags": sorted(flags),
        "factor_explanation": EXPLANATION,
    }
    record["row_hash"] = row_hash(record)
    return record


def _instrument_records(bundle: MarketDataBundle, symbols: tuple[str, ...], market_date: str) -> tuple[dict[str, Any], ...]:
    rows = bundle.instruments[bundle.instruments["symbol"].isin(symbols)].copy()
    rows = rows.sort_values("symbol", kind="stable")
    records: list[dict[str, Any]] = []
    for row in rows.itertuples(index=False):
        listing_date = None if pd.isna(row.listing_date) else str(row.listing_date.date())
        delisting = getattr(row, "delisting_date", None)
        records.append(
            {
                "symbol": str(row.symbol),
                "name": str(row.name),
                "sector": str(row.sector),
                "sector_benchmark": (
                    None
                    if pd.isna(row.sector_benchmark) or not str(row.sector_benchmark).strip()
                    else str(row.sector_benchmark).strip().upper()
                ),
                "board": None if pd.isna(row.board) else str(row.board),
                "security_type": str(row.security_type),
                "listing_date": listing_date,
                "delisting_date": None if pd.isna(delisting) else str(pd.Timestamp(delisting).date()),
                "active": bool(row.active),
                "suspended": bool(row.suspended),
                "source_id": None if pd.isna(row.source_id) else str(row.source_id),
                "last_seen_date": market_date,
            }
        )
    return tuple(records)


class QuantPipeline:
    def __init__(self, config: QuantConfig | None = None):
        self.config = config or QuantConfig()

    def run(self, bundle: MarketDataBundle) -> QuantResult:
        normalized = normalize_bundle(bundle)
        report = validate_bundle(normalized, self.config)
        if not report.ok:
            raise ValidationError(report)
        raw = calculate_raw_factors(normalized, report, self.config)
        scores = calculate_scores(raw, self.config)
        validate_scores(scores)
        if len(scores) != len(report.valid_symbols):
            raise RuntimeError(
                f"score count {len(scores)} does not match valid universe {len(report.valid_symbols)}"
            )
        records = tuple(_record(row) for _, row in scores.iterrows())
        digest = payload_hash(list(records))
        run_id = f"qv1-{report.market_date.replace('-', '')}-{digest[:16]}"
        regime = calculate_market_regime(normalized, report, raw, run_id)
        instruments = _instrument_records(normalized, report.valid_symbols, report.market_date)
        warnings = [issue.as_dict() for issue in report.issues if issue.severity == "WARNING"]
        manifest: dict[str, Any] = {
            "run_id": run_id,
            "market_date": report.market_date,
            "provider": normalized.provider,
            "model_version": MODEL_VERSION,
            "payload_hash": digest,
            "expected_symbols": len(records),
            "valid_symbols": len(records),
            "total_instruments": report.total_instruments,
            "benchmark_date": report.benchmark_date,
            "validation": {
                "critical_count": 0,
                "warning_count": report.warning_count,
                "checks": list(report.checks),
            },
            "issues": warnings[:100],
            "issue_count_total": len(warnings),
            "weights": self.config.weights,
            "regime": regime,
            "automated_publication_approved": False,
        }
        return QuantResult(
            bundle=normalized,
            validation=report,
            raw_factors=raw,
            scores=scores,
            regime=regime,
            instruments=instruments,
            records=records,
            manifest=manifest,
        )
