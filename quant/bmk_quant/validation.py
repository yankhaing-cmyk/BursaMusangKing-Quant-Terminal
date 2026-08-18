from __future__ import annotations

from dataclasses import replace

import numpy as np
import pandas as pd

from .config import QuantConfig
from .models import DataIssue, MarketDataBundle, ValidationReport


INSTRUMENT_REQUIRED = {"symbol", "name", "sector"}
BARS_REQUIRED = {"symbol", "date", "open", "high", "low", "close", "volume"}
BENCHMARK_REQUIRED = {"benchmark", "date", "close"}


def _missing_columns(frame: pd.DataFrame, required: set[str]) -> list[str]:
    return sorted(required - set(frame.columns))


def normalize_bundle(bundle: MarketDataBundle) -> MarketDataBundle:
    instruments = bundle.instruments.copy()
    bars = bundle.bars.copy()
    benchmarks = bundle.benchmarks.copy()

    for frame, required, label in (
        (instruments, INSTRUMENT_REQUIRED, "instruments"),
        (bars, BARS_REQUIRED, "bars"),
        (benchmarks, BENCHMARK_REQUIRED, "benchmarks"),
    ):
        missing = _missing_columns(frame, required)
        if missing:
            raise ValueError(f"{label} missing columns: {', '.join(missing)}")

    instruments["symbol"] = instruments["symbol"].astype(str).str.strip().str.upper()
    instruments["name"] = instruments["name"].astype(str).str.strip()
    instruments["sector"] = instruments["sector"].fillna("UNKNOWN").astype(str).str.strip()
    defaults = {
        "sector_benchmark": None,
        "board": None,
        "security_type": "EQUITY",
        "listing_date": None,
        "delisting_date": None,
        "active": True,
        "suspended": False,
        "source_id": None,
    }
    for column, default in defaults.items():
        if column not in instruments:
            instruments[column] = default
    instruments["security_type"] = (
        instruments["security_type"].fillna("EQUITY").astype(str).str.upper()
    )
    def boolean_column(column: str, default: bool) -> pd.Series:
        values = instruments[column]
        if pd.api.types.is_bool_dtype(values):
            return values.fillna(default).astype(bool)
        normalized = values.fillna(default).astype(str).str.strip().str.lower()
        mapping = {
            "true": True,
            "1": True,
            "yes": True,
            "y": True,
            "false": False,
            "0": False,
            "no": False,
            "n": False,
        }
        invalid = ~normalized.isin(mapping)
        if invalid.any():
            raise ValueError(f"{column} contains invalid Boolean values")
        return normalized.map(mapping).astype(bool)

    instruments["active"] = boolean_column("active", True)
    instruments["suspended"] = boolean_column("suspended", False)
    instruments["listing_date"] = pd.to_datetime(
        instruments["listing_date"], errors="coerce"
    )

    bars["symbol"] = bars["symbol"].astype(str).str.strip().str.upper()
    bars["date"] = pd.to_datetime(bars["date"], errors="coerce").dt.normalize()
    for column in ("open", "high", "low", "close", "volume"):
        bars[column] = pd.to_numeric(bars[column], errors="coerce")
    if "adjusted_close" not in bars:
        bars["adjusted_close"] = bars["close"]
    bars["adjusted_close"] = pd.to_numeric(bars["adjusted_close"], errors="coerce")
    bars = bars.sort_values(["symbol", "date"], kind="stable").reset_index(drop=True)

    benchmarks["benchmark"] = (
        benchmarks["benchmark"].astype(str).str.strip().str.upper()
    )
    benchmarks["date"] = pd.to_datetime(
        benchmarks["date"], errors="coerce"
    ).dt.normalize()
    benchmarks["close"] = pd.to_numeric(benchmarks["close"], errors="coerce")
    benchmarks = benchmarks.sort_values(["benchmark", "date"], kind="stable").reset_index(
        drop=True
    )
    return replace(bundle, instruments=instruments, bars=bars, benchmarks=benchmarks)


def validate_bundle(bundle: MarketDataBundle, config: QuantConfig) -> ValidationReport:
    config.validate()
    issues: list[DataIssue] = []
    checks: list[dict[str, object]] = []
    instruments, bars, benchmarks = bundle.instruments, bundle.bars, bundle.benchmarks

    def critical(code: str, detail: str, symbol: str | None = None, field: str | None = None) -> None:
        issues.append(DataIssue("CRITICAL", code, detail, symbol, field))

    def warning(code: str, detail: str, symbol: str | None = None, field: str | None = None) -> None:
        if len(issues) < config.maximum_warning_rows:
            issues.append(DataIssue("WARNING", code, detail, symbol, field))

    duplicate_instruments = instruments[instruments.duplicated("symbol", keep=False)]
    duplicate_bars = bars[bars.duplicated(["symbol", "date"], keep=False)]
    duplicate_benchmarks = benchmarks[
        benchmarks.duplicated(["benchmark", "date"], keep=False)
    ]
    if not duplicate_instruments.empty:
        critical("DUPLICATE_INSTRUMENT", "duplicate normalized instrument symbols")
    if not duplicate_bars.empty:
        critical("DUPLICATE_BAR", "duplicate symbol/date observations")
    if not duplicate_benchmarks.empty:
        critical("DUPLICATE_BENCHMARK_BAR", "duplicate benchmark/date observations")

    invalid_dates = bars["date"].isna().sum() + benchmarks["date"].isna().sum()
    if invalid_dates:
        critical("INVALID_DATE", f"{invalid_dates} rows have invalid dates", field="date")

    finite_prices = np.isfinite(bars[["open", "high", "low", "close", "adjusted_close"]]).all(
        axis=1
    )
    invalid_ohlc = (
        ~finite_prices
        | (bars[["open", "high", "low", "close", "adjusted_close"]] <= 0).any(axis=1)
        | (bars["volume"].isna())
        | (bars["volume"] < 0)
        | (bars["high"] < bars[["open", "close", "low"]].max(axis=1))
        | (bars["low"] > bars[["open", "close", "high"]].min(axis=1))
    )
    if invalid_ohlc.any():
        critical("INVALID_OHLCV", f"{int(invalid_ohlc.sum())} rows violate OHLCV rules")

    benchmark = benchmarks[benchmarks["benchmark"] == config.benchmark_symbol]
    if benchmark.empty:
        critical("MISSING_BENCHMARK", f"{config.benchmark_symbol} is missing")
        benchmark_date = pd.Timestamp("1970-01-01")
    else:
        benchmark_date = benchmark["date"].max()
        if len(benchmark) < config.min_full_history:
            critical(
                "INSUFFICIENT_BENCHMARK_HISTORY",
                f"benchmark has {len(benchmark)} rows; {config.min_full_history} required",
            )
        if (benchmark["close"] <= 0).any() or not np.isfinite(benchmark["close"]).all():
            critical("INVALID_BENCHMARK_PRICE", "benchmark contains invalid closes")

    latest_bar_date = bars["date"].max()
    market_date = benchmark_date if pd.notna(benchmark_date) else latest_bar_date
    if pd.isna(market_date):
        market_date = pd.Timestamp("1970-01-01")
        critical("MISSING_MARKET_DATE", "no usable market date")
    if pd.notna(latest_bar_date) and latest_bar_date != market_date:
        critical(
            "BENCHMARK_STOCK_DATE_MISMATCH",
            f"benchmark={benchmark_date.date()} stocks={latest_bar_date.date()}",
        )
    if market_date.weekday() >= 5:
        critical("WEEKEND_MARKET_DATE", f"{market_date.date()} is not a Bursa weekday")
    today = pd.Timestamp.now(tz="Asia/Kuala_Lumpur").tz_localize(None).normalize()
    if market_date > today + pd.Timedelta(days=1):
        critical("FUTURE_MARKET_DATE", f"{market_date.date()} is in the future")
    if (
        config.max_market_age_days is not None
        and (today - market_date).days > config.max_market_age_days
    ):
        critical(
            "STALE_MARKET_DATE",
            f"{market_date.date()} is more than {config.max_market_age_days} calendar days old",
        )
    if bundle.source_market_date and str(market_date.date()) != str(bundle.source_market_date):
        critical(
            "SOURCE_DATE_MISMATCH",
            f"source declares {bundle.source_market_date}, calculated {market_date.date()}",
        )
    if bundle.metadata.get("production_blocked"):
        critical("FIXTURE_NOT_PRODUCTION", "synthetic fixture cannot be published as live data")
    if not bundle.metadata.get("licence") and not bundle.metadata.get("fixture"):
        warning(
            "SOURCE_LICENCE_UNDECLARED",
            "source manifest does not declare data-use or redistribution rights",
        )

    if instruments["symbol"].eq("").any() or instruments["name"].eq("").any():
        critical("MISSING_INSTRUMENT_IDENTITY", "instrument symbol/name is blank")
    unknown_sector_rate = instruments["sector"].isin(["", "UNKNOWN", "NAN"]).mean()
    if unknown_sector_rate > 0.05:
        critical(
            "SECTOR_MASTER_INCOMPLETE",
            f"{unknown_sector_rate:.1%} of instruments lack a sector",
        )

    history = bars.groupby("symbol", sort=False).agg(
        history_days=("date", "size"), latest_date=("date", "max")
    )
    valid_symbols: list[str] = []
    accepted_types = set(config.accepted_security_types)
    for row in instruments.itertuples(index=False):
        symbol = str(row.symbol)
        if not bool(row.active):
            continue
        if str(row.security_type) not in accepted_types:
            continue
        if bool(row.suspended):
            warning("SUSPENDED_EXCLUDED", "suspended counter excluded", symbol)
            continue
        if symbol not in history.index:
            warning("MISSING_SYMBOL_BARS", "no OHLCV history", symbol)
            continue
        stats = history.loc[symbol]
        if stats.latest_date != market_date:
            warning(
                "STALE_SYMBOL_EXCLUDED",
                f"latest bar is {stats.latest_date.date()}",
                symbol,
            )
            continue
        listing_date = row.listing_date
        recent_ipo = pd.notna(listing_date) and (
            market_date - listing_date
        ).days <= config.recent_ipo_max_age_days
        minimum_history = (
            config.min_recent_ipo_history if recent_ipo else config.min_full_history
        )
        if int(stats.history_days) < minimum_history:
            warning(
                "INSUFFICIENT_HISTORY_EXCLUDED",
                f"{int(stats.history_days)} bars; {minimum_history} required",
                symbol,
            )
            continue
        valid_symbols.append(symbol)

    if len(valid_symbols) < config.min_valid_universe:
        critical(
            "UNIVERSE_BELOW_MINIMUM",
            f"{len(valid_symbols)} valid stocks; {config.min_valid_universe} required",
        )
    checks.extend(
        [
            {"name": "unique_symbols", "passed": duplicate_instruments.empty},
            {"name": "valid_ohlcv", "passed": not invalid_ohlc.any()},
            {"name": "benchmark_present", "passed": not benchmark.empty},
            {
                "name": "benchmark_date_matches",
                "passed": pd.notna(latest_bar_date) and latest_bar_date == benchmark_date,
            },
            {
                "name": "minimum_universe",
                "passed": len(valid_symbols) >= config.min_valid_universe,
                "actual": len(valid_symbols),
                "minimum": config.min_valid_universe,
            },
        ]
    )
    return ValidationReport(
        market_date=str(market_date.date()),
        benchmark_date=str(benchmark_date.date()),
        total_instruments=len(instruments),
        valid_symbols=tuple(sorted(valid_symbols)),
        issues=tuple(issues),
        checks=tuple(checks),
    )
