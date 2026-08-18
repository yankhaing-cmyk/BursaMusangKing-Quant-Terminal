from __future__ import annotations

from dataclasses import dataclass, field


MODEL_VERSION = "quant-v1.0.0"


@dataclass(frozen=True)
class QuantConfig:
    """Versioned Phase 1 scoring and validation configuration."""

    min_valid_universe: int = 900
    min_full_history: int = 260
    min_recent_ipo_history: int = 120
    recent_ipo_max_age_days: int = 550
    max_market_age_days: int | None = 7
    benchmark_symbol: str = "FBMKLCI"
    maximum_warning_rows: int = 2_000
    accepted_security_types: tuple[str, ...] = ("EQUITY", "REIT", "ETF")
    weights: dict[str, float] = field(
        default_factory=lambda: {
            "trend_score": 0.20,
            "momentum_score": 0.20,
            "relative_strength_score": 0.20,
            "volume_score": 0.10,
            "volatility_score": 0.10,
            "liquidity_score": 0.10,
            "strategy_ensemble_score": 0.10,
        }
    )

    def validate(self) -> None:
        if self.min_valid_universe < 1:
            raise ValueError("min_valid_universe must be positive")
        if self.min_recent_ipo_history < 60:
            raise ValueError("min_recent_ipo_history must be at least 60")
        if self.min_full_history < 252:
            raise ValueError("min_full_history must be at least 252")
        if self.max_market_age_days is not None and self.max_market_age_days < 1:
            raise ValueError("max_market_age_days must be positive or None")
        if abs(sum(self.weights.values()) - 1.0) > 1e-12:
            raise ValueError("quant weights must sum exactly to 1.0")
        if any(weight < 0 for weight in self.weights.values()):
            raise ValueError("quant weights cannot be negative")
