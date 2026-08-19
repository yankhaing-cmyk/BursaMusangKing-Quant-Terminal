from __future__ import annotations

import hashlib
import json
import math
from typing import Any

import numpy as np
import pandas as pd

from .models import MarketDataBundle, ValidationReport


METHODOLOGY_VERSION = "regime-v1.0.0"
REGIME_LABELS = (
    "STRONG RISK-ON",
    "RISK-ON",
    "NEUTRAL",
    "RISK-OFF",
    "STRONG RISK-OFF",
)

POLICIES: dict[str, dict[str, float | int]] = {
    "STRONG RISK-ON": {
        "minimum_quant_score": 78,
        "max_equity_exposure": 0.90,
        "new_position_size_multiplier": 1.00,
        "minimum_cash_allocation": 0.10,
        "max_new_entries": 5,
        "trend_weight_multiplier": 1.15,
    },
    "RISK-ON": {
        "minimum_quant_score": 80,
        "max_equity_exposure": 0.85,
        "new_position_size_multiplier": 1.00,
        "minimum_cash_allocation": 0.15,
        "max_new_entries": 4,
        "trend_weight_multiplier": 1.10,
    },
    "NEUTRAL": {
        "minimum_quant_score": 84,
        "max_equity_exposure": 0.65,
        "new_position_size_multiplier": 0.75,
        "minimum_cash_allocation": 0.35,
        "max_new_entries": 2,
        "trend_weight_multiplier": 1.00,
    },
    "RISK-OFF": {
        "minimum_quant_score": 88,
        "max_equity_exposure": 0.45,
        "new_position_size_multiplier": 0.50,
        "minimum_cash_allocation": 0.55,
        "max_new_entries": 1,
        "trend_weight_multiplier": 0.90,
    },
    "STRONG RISK-OFF": {
        "minimum_quant_score": 92,
        "max_equity_exposure": 0.25,
        "new_position_size_multiplier": 0.25,
        "minimum_cash_allocation": 0.75,
        "max_new_entries": 0,
        "trend_weight_multiplier": 0.80,
    },
}


def _fixed(value: Any) -> str:
    numeric = float(value)
    if not math.isfinite(numeric):
        raise ValueError("non-finite number in canonical regime")
    return f"{numeric:.8f}"


def _canonical_explanation(value: Any) -> str:
    if not isinstance(value, dict):
        raise ValueError("regime explanation must be an object")
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def canonical_regime(record: dict[str, Any]) -> str:
    return "\x1f".join(
        [
            str(record["run_id"]).strip(),
            str(record["market_date"]),
            str(record["methodology_version"]),
            str(record["regime_label"]),
            _fixed(record["regime_score"]),
            _fixed(record["benchmark_close"]),
            _fixed(record["benchmark_sma50"]),
            _fixed(record["benchmark_sma200"]),
            _fixed(record["benchmark_sma50_slope20"]),
            _fixed(record["benchmark_sma200_slope20"]),
            _fixed(record["benchmark_return20"]),
            _fixed(record["benchmark_realized_volatility20"]),
            _fixed(record["breadth_above20"]),
            _fixed(record["breadth_above50"]),
            _fixed(record["breadth_above200"]),
            _fixed(record["breadth_momentum"]),
            _fixed(record["new_high_rate"]),
            _fixed(record["new_low_rate"]),
            _fixed(record["volume_participation_rate"]),
            _fixed(record["sector_positive_rate"]),
            _fixed(record["benchmark_trend_score"]),
            _fixed(record["breadth_score"]),
            _fixed(record["sector_breadth_score"]),
            _fixed(record["participation_score"]),
            _fixed(record["volatility_score"]),
            str(int(record["minimum_quant_score"])),
            _fixed(record["max_equity_exposure"]),
            _fixed(record["new_position_size_multiplier"]),
            _fixed(record["minimum_cash_allocation"]),
            str(int(record["max_new_entries"])),
            _fixed(record["trend_weight_multiplier"]),
            _canonical_explanation(record["explanation"]),
        ]
    )


def regime_hash(record: dict[str, Any]) -> str:
    return hashlib.sha256(canonical_regime(record).encode("utf-8")).hexdigest()


def _sma(values: np.ndarray, window: int, offset: int = 0) -> float:
    end = len(values) - offset
    start = end - window
    if start < 0 or end <= 0:
        raise ValueError(f"benchmark requires {window + offset} observations")
    return float(np.mean(values[start:end]))


def _rate(mask: pd.Series) -> float:
    if mask.empty:
        raise ValueError("regime breadth input is empty")
    return float(mask.astype(float).mean())


def _clip_score(value: float) -> float:
    return float(np.clip(value, 0.0, 100.0))


def _new_low_rate(bundle: MarketDataBundle, symbols: set[str]) -> float:
    lows: list[bool] = []
    bars = bundle.bars[bundle.bars["symbol"].isin(symbols)]
    for _, group in bars.groupby("symbol", sort=False):
        ordered = group.sort_values("date", kind="stable")
        values = ordered["adjusted_close"].to_numpy(dtype=float)
        if len(values) < 120:
            continue
        window = values[-min(252, len(values)) :]
        minimum = float(np.min(window))
        lows.append(minimum > 0 and float(values[-1]) <= minimum * 1.01)
    if len(lows) < max(20, int(len(symbols) * 0.80)):
        raise ValueError("insufficient 52-week-low breadth coverage")
    return float(np.mean(lows))


def _label(
    score: float,
    benchmark_close: float,
    sma50: float,
    sma200: float,
    breadth_above50: float,
) -> str:
    if (
        score >= 75
        and benchmark_close > sma50
        and benchmark_close > sma200
        and breadth_above50 >= 0.60
    ):
        return "STRONG RISK-ON"
    if score >= 60 and benchmark_close > sma200 and breadth_above50 >= 0.50:
        return "RISK-ON"
    if (
        score < 30
        and benchmark_close < sma50
        and benchmark_close < sma200
        and breadth_above50 <= 0.30
    ):
        return "STRONG RISK-OFF"
    if score < 45 or (benchmark_close < sma200 and breadth_above50 < 0.40):
        return "RISK-OFF"
    return "NEUTRAL"


def calculate_market_regime(
    bundle: MarketDataBundle,
    report: ValidationReport,
    raw_factors: pd.DataFrame,
    run_id: str,
) -> dict[str, Any]:
    benchmark = bundle.benchmarks[
        bundle.benchmarks["benchmark"] == "FBMKLCI"
    ].sort_values("date", kind="stable")
    closes = benchmark["close"].to_numpy(dtype=float)
    if len(closes) < 220:
        raise ValueError("market regime requires at least 220 FBM KLCI bars")

    benchmark_close = float(closes[-1])
    sma50 = _sma(closes, 50)
    sma200 = _sma(closes, 200)
    sma50_prior = _sma(closes, 50, 20)
    sma200_prior = _sma(closes, 200, 20)
    sma50_slope = sma50 / sma50_prior - 1.0
    sma200_slope = sma200 / sma200_prior - 1.0
    benchmark_return20 = benchmark_close / float(closes[-21]) - 1.0
    daily_returns = closes[-21:][1:] / closes[-21:][:-1] - 1.0
    realized_volatility = float(np.std(daily_returns, ddof=1) * math.sqrt(252))

    valid = raw_factors[raw_factors["symbol"].isin(report.valid_symbols)].copy()
    if len(valid) != len(report.valid_symbols) or len(valid) < 20:
        raise ValueError("regime breadth coverage does not match valid universe")
    above20 = _rate(valid["close_vs_sma20"] > 0)
    above50 = _rate(valid["close_vs_sma50"] > 0)
    above200 = _rate(valid["close_vs_sma200"] > 0)
    breadth_momentum = above20 - above50
    new_high_rate = _rate(valid["distance_52_week_high"] >= -0.01)
    new_low_rate = _new_low_rate(bundle, set(report.valid_symbols))

    volume_ratios = pd.to_numeric(valid["volume_ratio_20"], errors="coerce").dropna()
    if len(volume_ratios) < int(len(valid) * 0.80):
        raise ValueError("insufficient volume participation coverage")
    volume_participation = _rate(volume_ratios >= 1.0)

    eligible_sectors: list[float] = []
    for _, sector in valid.groupby("sector", sort=True):
        values = pd.to_numeric(sector["close_vs_sma50"], errors="coerce").dropna()
        if len(values) >= 3:
            eligible_sectors.append(float((values > 0).mean()))
    if len(eligible_sectors) < 5:
        raise ValueError("insufficient sector breadth coverage")
    sector_positive_rate = float(np.mean(np.asarray(eligible_sectors) >= 0.50))

    benchmark_trend_score = float(
        20 * (benchmark_close > sma50)
        + 20 * (benchmark_close > sma200)
        + 15 * (sma50 > sma200)
        + 15 * (sma50_slope > 0)
        + 15 * (sma200_slope > 0)
        + 15 * (benchmark_return20 > 0)
    )
    high_low_balance = float(np.clip((new_high_rate - new_low_rate + 1.0) / 2.0, 0.0, 1.0))
    breadth_score = 100.0 * (
        0.25 * above20
        + 0.30 * above50
        + 0.35 * above200
        + 0.10 * high_low_balance
    )
    sector_breadth_score = 100.0 * sector_positive_rate
    participation_score = 100.0 * volume_participation
    volatility_score = _clip_score(100.0 * (0.35 - realized_volatility) / 0.23)
    regime_score = _clip_score(
        0.35 * benchmark_trend_score
        + 0.35 * breadth_score
        + 0.10 * sector_breadth_score
        + 0.10 * participation_score
        + 0.10 * volatility_score
    )
    regime_label = _label(regime_score, benchmark_close, sma50, sma200, above50)
    policy = POLICIES[regime_label]
    record: dict[str, Any] = {
        "run_id": run_id,
        "market_date": report.market_date,
        "methodology_version": METHODOLOGY_VERSION,
        "regime_label": regime_label,
        "regime_score": round(regime_score, 6),
        "benchmark_close": round(benchmark_close, 8),
        "benchmark_sma50": round(sma50, 8),
        "benchmark_sma200": round(sma200, 8),
        "benchmark_sma50_slope20": round(sma50_slope, 8),
        "benchmark_sma200_slope20": round(sma200_slope, 8),
        "benchmark_return20": round(benchmark_return20, 8),
        "benchmark_realized_volatility20": round(realized_volatility, 8),
        "breadth_above20": round(above20, 8),
        "breadth_above50": round(above50, 8),
        "breadth_above200": round(above200, 8),
        "breadth_momentum": round(breadth_momentum, 8),
        "new_high_rate": round(new_high_rate, 8),
        "new_low_rate": round(new_low_rate, 8),
        "volume_participation_rate": round(volume_participation, 8),
        "sector_positive_rate": round(sector_positive_rate, 8),
        "benchmark_trend_score": round(benchmark_trend_score, 6),
        "breadth_score": round(breadth_score, 6),
        "sector_breadth_score": round(sector_breadth_score, 6),
        "participation_score": round(participation_score, 6),
        "volatility_score": round(volatility_score, 6),
        **policy,
        "explanation": {
            "benchmark_trend": "35%: KLCI versus 50/200DMA, MA slopes and 20D return.",
            "market_breadth": "35%: valid-universe shares above 20/50/200DMA and 52-week high-low balance.",
            "sector_breadth": "10%: share of eligible sectors with at least half their stocks above 50DMA.",
            "participation": "10%: share of valid stocks trading at or above their 20D average volume.",
            "volatility": "10%: KLCI 20D realized volatility, scoring from 100 at 12% or lower to 0 at 35% or higher.",
            "policy": "Guidance only. It does not place trades or change the fixed Quant Score weights.",
        },
    }
    record["row_hash"] = regime_hash(record)
    return record
