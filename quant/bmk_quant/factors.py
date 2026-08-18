from __future__ import annotations

import math

import numpy as np
import pandas as pd

from .config import QuantConfig
from .models import MarketDataBundle, ValidationReport


def _return(values: np.ndarray, periods: int) -> float:
    if len(values) <= periods or values[-periods - 1] <= 0:
        return math.nan
    return float(values[-1] / values[-periods - 1] - 1.0)


def _moving_average_distance(values: np.ndarray, window: int) -> float:
    if len(values) < window:
        return math.nan
    average = float(np.mean(values[-window:]))
    return float(values[-1] / average - 1.0) if average > 0 else math.nan


def _moving_average_slope(values: np.ndarray, window: int, lag: int) -> float:
    if len(values) < window + lag:
        return math.nan
    latest = float(np.mean(values[-window:]))
    prior = float(np.mean(values[-window - lag : -lag]))
    return (latest / prior - 1.0) / lag if prior > 0 else math.nan


def _wilder_atr(high: np.ndarray, low: np.ndarray, close: np.ndarray, period: int = 14) -> float:
    if len(close) < period + 1:
        return math.nan
    previous = np.roll(close, 1)
    previous[0] = close[0]
    true_range = np.maximum(high - low, np.maximum(np.abs(high - previous), np.abs(low - previous)))
    atr = float(np.mean(true_range[:period]))
    for value in true_range[period:]:
        atr = ((period - 1) * atr + float(value)) / period
    return atr


def _maximum_drawdown(values: np.ndarray) -> float:
    if len(values) < 2:
        return math.nan
    peaks = np.maximum.accumulate(values)
    return float(np.min(values / peaks - 1.0))


def _benchmark_returns(benchmarks: pd.DataFrame) -> dict[str, dict[int, float]]:
    output: dict[str, dict[int, float]] = {}
    for benchmark, group in benchmarks.groupby("benchmark", sort=False):
        close = group.sort_values("date")["close"].to_numpy(dtype=float)
        output[str(benchmark)] = {
            periods: _return(close, periods) for periods in (20, 60, 120, 252)
        }
    return output


def _symbol_factors(group: pd.DataFrame) -> dict[str, float]:
    group = group.sort_values("date", kind="stable")
    raw_close = group["close"].to_numpy(dtype=float)
    close = group["adjusted_close"].to_numpy(dtype=float)
    adjustment = close / raw_close
    high = group["high"].to_numpy(dtype=float) * adjustment
    low = group["low"].to_numpy(dtype=float) * adjustment
    open_ = group["open"].to_numpy(dtype=float) * adjustment
    volume = group["volume"].to_numpy(dtype=float)
    returns = np.divide(close[1:], close[:-1], out=np.ones(len(close) - 1), where=close[:-1] != 0) - 1
    traded_value = raw_close * volume
    prior_55_high = float(np.max(high[-56:-1])) if len(high) >= 56 else float(np.max(high[:-1]))
    prior_20_low = float(np.min(low[-21:-1])) if len(low) >= 21 else float(np.min(low[:-1]))
    recent_high = float(np.max(high[-20:]))
    recent_low = float(np.min(low[-20:]))
    prior_high = float(np.max(high[-40:-20])) if len(high) >= 40 else math.nan
    prior_low = float(np.min(low[-40:-20])) if len(low) >= 40 else math.nan
    hh_hl = (
        ((recent_high / prior_high - 1.0) + (recent_low / prior_low - 1.0)) / 2.0
        if prior_high > 0 and prior_low > 0
        else math.nan
    )
    lookback_high = float(np.max(high[-min(252, len(high)) :]))
    return_20_series = (
        pd.Series(close).pct_change(20).tail(min(120, len(close))).dropna().to_numpy()
    )
    recent_returns = returns[-20:]
    up_volume = float(volume[-20:][recent_returns > 0].sum())
    down_volume = float(volume[-20:][recent_returns < 0].sum())
    volume_ratio_20 = float(volume[-1] / np.mean(volume[-20:]))
    breakout = float(close[-1] / prior_55_high - 1.0)
    adjusted_atr = _wilder_atr(high, low, close)
    atr = adjusted_atr / adjustment[-1]
    realized = float(np.std(returns[-20:], ddof=1) * math.sqrt(252))
    downside = returns[-60:][returns[-60:] < 0]
    downside_volatility = (
        float(np.sqrt(np.mean(np.square(downside))) * math.sqrt(252))
        if len(downside)
        else 0.0
    )
    gaps = np.abs(open_[1:] / raw_close[:-1] - 1.0)
    amihud_window = np.divide(
        np.abs(returns[-60:]),
        traded_value[-60:] / 1_000_000,
        out=np.full(min(60, len(returns)), np.nan),
        where=traded_value[-60:] > 0,
    )
    bandwidth = (
        4.0 * float(np.std(close[-20:], ddof=1)) / float(np.mean(close[-20:]))
    )
    base_returns = returns[-40:]
    volume_mean_40 = float(np.mean(volume[-40:]))
    volume_cv = (
        float(np.std(volume[-40:], ddof=1) / volume_mean_40)
        if volume_mean_40 > 0
        else math.inf
    )
    base_quality = -(
        abs(_maximum_drawdown(close[-40:]))
        + float(np.std(base_returns, ddof=1)) * 2.0
        + min(volume_cv, 5.0) * 0.03
    )
    support_distance = float(close[-1] / prior_20_low - 1.0)
    support_proximity = -abs(support_distance - 0.05)
    return {
        "close": float(raw_close[-1]),
        "history_days": float(len(group)),
        "close_vs_sma20": _moving_average_distance(close, 20),
        "close_vs_sma50": _moving_average_distance(close, 50),
        "close_vs_sma200": _moving_average_distance(close, 200),
        "sma20_slope": _moving_average_slope(close, 20, 20),
        "sma50_slope": _moving_average_slope(close, 50, 20),
        "sma200_slope": _moving_average_slope(close, 200, 40),
        "higher_high_low": hh_hl,
        "distance_52_week_high": float(close[-1] / lookback_high - 1.0),
        "breakout_strength": breakout,
        "return_20": _return(close, 20),
        "return_60": _return(close, 60),
        "return_120": _return(close, 120),
        "return_252": _return(close, 252),
        "momentum_acceleration": _return(close, 20) - _return(close, 60) / 3.0,
        "momentum_consistency": float(np.mean(return_20_series > 0)) if len(return_20_series) else math.nan,
        "volume_ratio_20": volume_ratio_20,
        "volume_ratio_50": float(volume[-1] / np.mean(volume[-50:])),
        "volume_acceleration": float(np.mean(volume[-20:]) / np.mean(volume[-50:]) - 1.0),
        "up_down_volume_ratio": min(up_volume / max(down_volume, 1.0), 20.0),
        "breakout_volume_confirmation": volume_ratio_20 if breakout > 0 else 0.0,
        "atr_14": atr,
        "atr_pct": adjusted_atr / close[-1],
        "realized_volatility_20": realized,
        "downside_volatility_60": downside_volatility,
        "maximum_drawdown_120": _maximum_drawdown(close[-120:]),
        "gap_p95_60": float(np.quantile(gaps[-60:], 0.95)),
        "average_traded_value_20": float(np.mean(traded_value[-20:])),
        "average_traded_value_60": float(np.mean(traded_value[-60:])),
        "average_volume_20": float(np.mean(volume[-20:])),
        "zero_volume_rate_60": float(np.mean(volume[-60:] == 0)),
        "amihud_60": float(np.nanmean(amihud_window)),
        "support_distance_20": support_distance,
        "support_proximity": support_proximity,
        "breakout_distance_55": breakout,
        "compression_20": bandwidth,
        "base_quality_40": base_quality,
    }


def calculate_raw_factors(
    bundle: MarketDataBundle,
    report: ValidationReport,
    config: QuantConfig,
) -> pd.DataFrame:
    bars = bundle.bars[bundle.bars["symbol"].isin(report.valid_symbols)]
    instrument_map = bundle.instruments.set_index("symbol")
    eligible_benchmarks = bundle.benchmarks.groupby("benchmark", group_keys=False).filter(
        lambda group: len(group) >= 121
        and str(group["date"].max().date()) == report.market_date
    )
    benchmark_returns = _benchmark_returns(eligible_benchmarks)
    market_returns = benchmark_returns[config.benchmark_symbol]
    records: list[dict[str, object]] = []
    for symbol, group in bars.groupby("symbol", sort=True):
        values = _symbol_factors(group)
        instrument = instrument_map.loc[symbol]
        sector_benchmark = instrument.get("sector_benchmark")
        sector_key = (
            str(sector_benchmark).strip().upper()
            if pd.notna(sector_benchmark) and str(sector_benchmark).strip()
            else None
        )
        sector_returns = benchmark_returns.get(sector_key or "")
        values.update(
            {
                "symbol": symbol,
                "name": str(instrument["name"]),
                "sector": str(instrument["sector"]),
                "sector_benchmark": sector_key,
                "rs_20": values["return_20"] - market_returns[20],
                "rs_60": values["return_60"] - market_returns[60],
                "rs_120": values["return_120"] - market_returns[120],
                "sector_rs_20": (
                    values["return_20"] - sector_returns[20]
                    if sector_returns and np.isfinite(sector_returns[20])
                    else math.nan
                ),
                "sector_rs_60": (
                    values["return_60"] - sector_returns[60]
                    if sector_returns and np.isfinite(sector_returns[60])
                    else math.nan
                ),
                "sector_rs_available": bool(sector_returns),
            }
        )
        records.append(values)
    raw = pd.DataFrame.from_records(records).set_index("symbol", drop=False)
    return raw.replace([np.inf, -np.inf], np.nan)
