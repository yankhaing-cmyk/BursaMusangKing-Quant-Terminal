from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from .config import QuantConfig


@dataclass(frozen=True)
class FactorSpec:
    name: str
    weight: float
    higher_is_better: bool = True


FAMILIES: dict[str, tuple[FactorSpec, ...]] = {
    "trend_score": (
        FactorSpec("close_vs_sma20", 0.12),
        FactorSpec("close_vs_sma50", 0.16),
        FactorSpec("close_vs_sma200", 0.18),
        FactorSpec("sma20_slope", 0.10),
        FactorSpec("sma50_slope", 0.10),
        FactorSpec("sma200_slope", 0.08),
        FactorSpec("higher_high_low", 0.10),
        FactorSpec("distance_52_week_high", 0.08),
        FactorSpec("breakout_strength", 0.08),
    ),
    "momentum_score": (
        FactorSpec("return_20", 0.20),
        FactorSpec("return_60", 0.25),
        FactorSpec("return_120", 0.25),
        FactorSpec("return_252", 0.15),
        FactorSpec("momentum_acceleration", 0.10),
        FactorSpec("momentum_consistency", 0.05),
    ),
    "relative_strength_score": (
        FactorSpec("rs_20", 0.30),
        FactorSpec("rs_60", 0.35),
        FactorSpec("rs_120", 0.25),
        FactorSpec("sector_rs_20", 0.05),
        FactorSpec("sector_rs_60", 0.05),
    ),
    "volume_score": (
        FactorSpec("volume_ratio_20", 0.25),
        FactorSpec("volume_ratio_50", 0.15),
        FactorSpec("volume_acceleration", 0.15),
        FactorSpec("up_down_volume_ratio", 0.25),
        FactorSpec("breakout_volume_confirmation", 0.20),
    ),
    "volatility_score": (
        FactorSpec("atr_pct", 0.25, False),
        FactorSpec("realized_volatility_20", 0.20, False),
        FactorSpec("downside_volatility_60", 0.25, False),
        FactorSpec("maximum_drawdown_120", 0.20, True),
        FactorSpec("gap_p95_60", 0.10, False),
    ),
    "liquidity_score": (
        FactorSpec("average_traded_value_20", 0.30),
        FactorSpec("average_traded_value_60", 0.20),
        FactorSpec("average_volume_20", 0.10),
        FactorSpec("zero_volume_rate_60", 0.15, False),
        FactorSpec("amihud_60", 0.25, False),
    ),
    "price_structure_score": (
        FactorSpec("support_proximity", 0.20),
        FactorSpec("breakout_distance_55", 0.30),
        FactorSpec("compression_20", 0.20, False),
        FactorSpec("base_quality_40", 0.30),
    ),
}


def _percentile_score(series: pd.Series, higher_is_better: bool) -> pd.Series:
    numeric = pd.to_numeric(series, errors="coerce").replace([np.inf, -np.inf], np.nan)
    valid = numeric.dropna()
    if valid.empty:
        return pd.Series(np.nan, index=series.index, dtype=float)
    lower, upper = valid.quantile([0.025, 0.975])
    clipped = numeric.clip(lower=lower, upper=upper)
    rank = clipped.rank(method="average", pct=True) * 100.0
    return rank if higher_is_better else 100.0 - rank


def _family_score(raw: pd.DataFrame, specs: tuple[FactorSpec, ...]) -> pd.Series:
    numerator = pd.Series(0.0, index=raw.index)
    denominator = pd.Series(0.0, index=raw.index)
    for spec in specs:
        score = _percentile_score(raw[spec.name], spec.higher_is_better)
        available = score.notna()
        numerator = numerator.add(score.fillna(0.0) * spec.weight)
        denominator = denominator.add(available.astype(float) * spec.weight)
    return numerator.div(denominator.replace(0.0, np.nan)).clip(0.0, 100.0)


def calculate_scores(raw: pd.DataFrame, config: QuantConfig) -> pd.DataFrame:
    scored = raw.copy()
    for family, specs in FAMILIES.items():
        scored[family] = _family_score(scored, specs)

    scored["trending_score"] = (
        scored["trend_score"] * 0.65
        + scored["price_structure_score"] * 0.20
        + scored["relative_strength_score"] * 0.15
    )
    scored["momentum_strategy_score"] = (
        scored["momentum_score"] * 0.55
        + scored["relative_strength_score"] * 0.30
        + scored["volume_score"] * 0.15
    )
    scored["meta_score"] = (
        scored["momentum_score"] * 0.35
        + scored["volume_score"] * 0.25
        + scored["trend_score"] * 0.25
        + scored["liquidity_score"] * 0.15
    )
    scored["strategy_ensemble_score"] = scored[
        ["trending_score", "momentum_strategy_score", "meta_score"]
    ].mean(axis=1)

    quant = pd.Series(0.0, index=scored.index)
    for family, weight in config.weights.items():
        quant = quant.add(scored[family] * weight)
    # Transparent risk gate: a high technical score cannot disguise an almost
    # untradeable counter. The uncapped weighted score remains reconstructable
    # from the displayed components.
    adv = scored["average_traded_value_20"]
    cap = pd.Series(100.0, index=scored.index)
    cap = cap.mask(adv < 100_000, 69.9).mask(adv < 20_000, 55.0)
    scored["quant_score_uncapped"] = quant
    scored["quant_score"] = np.minimum(quant, cap).clip(0.0, 100.0)
    scored["liquidity_cap"] = cap
    scored = scored.reset_index(drop=True)
    scored = scored.sort_values(
        ["quant_score", "liquidity_score", "symbol"],
        ascending=[False, False, True],
        kind="stable",
    )
    scored["rank"] = np.arange(1, len(scored) + 1, dtype=int)
    return scored


def validate_scores(scored: pd.DataFrame) -> None:
    required = [
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
    ]
    values = scored[required].to_numpy(dtype=float)
    if not np.isfinite(values).all():
        raise ValueError("non-finite required score produced")
    if (values < 0).any() or (values > 100).any():
        raise ValueError("score outside 0–100")
    if scored["symbol"].duplicated().any() or scored["rank"].duplicated().any():
        raise ValueError("duplicate score symbol or rank")
