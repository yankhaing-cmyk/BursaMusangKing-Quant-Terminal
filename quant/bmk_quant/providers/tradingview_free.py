from __future__ import annotations

import hashlib
import logging
import re
import time
from pathlib import Path
from typing import Any, Callable

import pandas as pd

from ..models import MarketDataBundle


log = logging.getLogger("bmk_quant.tradingview")


class TradingViewFreeProvider:
    """Full Bursa daily data from TradingView's anonymous/free surfaces.

    The universe comes from TradingView's Malaysia scanner and daily history
    comes from an anonymous tvDatafeed session.  This is an unofficial adapter:
    it is deliberately fail-closed, sequential, throttled and suitable only
    for private research unless the operator separately confirms data rights.
    """

    SCANNER_URL = "https://scanner.tradingview.com/malaysia/scan"
    SCANNER_COLUMNS = (
        "name",
        "description",
        "sector",
        "industry",
        "type",
        "subtype",
        "close",
        "volume",
        "Value.Traded",
        "market_cap_basic",
    )

    def __init__(
        self,
        cache_dir: str | Path = ".cache/tradingview",
        *,
        n_bars: int = 400,
        incremental_bars: int = 40,
        request_delay: float = 0.12,
        maximum_attempts: int = 3,
        maximum_symbols: int = 3000,
        scanner_session: Any | None = None,
        tv_factory: Callable[[], Any] | None = None,
        daily_interval: Any | None = None,
        sleeper: Callable[[float], None] = time.sleep,
        clock: Callable[[], pd.Timestamp] | None = None,
    ):
        if n_bars < 260:
            raise ValueError("TradingView provider requires at least 260 bars")
        if incremental_bars < 5 or incremental_bars > n_bars:
            raise ValueError("incremental_bars must be between 5 and n_bars")
        if request_delay < 0 or request_delay > 5:
            raise ValueError("request_delay must be between 0 and 5 seconds")
        if maximum_attempts < 1 or maximum_attempts > 5:
            raise ValueError("maximum_attempts must be between 1 and 5")
        self.cache_dir = Path(cache_dir)
        self.n_bars = n_bars
        self.incremental_bars = incremental_bars
        self.request_delay = request_delay
        self.maximum_attempts = maximum_attempts
        self.maximum_symbols = maximum_symbols
        if scanner_session is None:
            import requests

            scanner_session = requests.Session()
        self.scanner_session = scanner_session
        self.tv_factory = tv_factory
        self.daily_interval = daily_interval
        self.sleeper = sleeper
        self.clock = clock or (lambda: pd.Timestamp.now(tz="Asia/Kuala_Lumpur"))
        self._tv: Any | None = None
        self._scanner_total = 0
        self._cache_hits = 0
        self._incremental_fetches = 0
        self._full_fetches = 0
        self._failures: list[str] = []

    def _scanner_payload(self) -> dict[str, Any]:
        return {
            "filter": [
                {"left": "type", "operation": "equal", "right": "stock"},
                {
                    "left": "subtype",
                    "operation": "in_range",
                    "right": ["common", ""],
                },
                {"left": "exchange", "operation": "equal", "right": "MYX"},
            ],
            "options": {"lang": "en"},
            "columns": list(self.SCANNER_COLUMNS),
            "sort": {"sortBy": "Value.Traded", "sortOrder": "desc"},
            "range": [0, self.maximum_symbols],
        }

    def _fetch_universe(self) -> pd.DataFrame:
        response = self.scanner_session.post(
            self.SCANNER_URL,
            json=self._scanner_payload(),
            timeout=30,
            headers={"User-Agent": "Mozilla/5.0 BursaMusangKing-Quant/1.0"},
        )
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, dict) or not isinstance(payload.get("data"), list):
            raise RuntimeError("TradingView scanner returned an invalid payload")
        total_count = int(payload.get("totalCount") or len(payload["data"]))
        self._scanner_total = total_count
        if total_count > self.maximum_symbols:
            raise RuntimeError(
                f"TradingView scanner universe {total_count} exceeds safety cap {self.maximum_symbols}"
            )
        if len(payload["data"]) != total_count:
            raise RuntimeError(
                f"TradingView scanner returned {len(payload['data'])} of {total_count} rows"
            )

        rows: list[dict[str, Any]] = []
        for item in payload["data"]:
            values = item.get("d") if isinstance(item, dict) else None
            if not isinstance(values, list) or len(values) != len(self.SCANNER_COLUMNS):
                raise RuntimeError("TradingView scanner row shape is inconsistent")
            raw = dict(zip(self.SCANNER_COLUMNS, values, strict=True))
            symbol = str(raw.get("name") or "").strip().upper()
            if not symbol:
                raise RuntimeError("TradingView scanner returned a blank symbol")
            name = str(raw.get("description") or symbol).strip()
            sector = str(raw.get("sector") or "").strip()
            rows.append(
                {
                    "symbol": symbol,
                    "name": name,
                    "sector": sector or "UNKNOWN",
                    "sector_benchmark": None,
                    "board": None,
                    "security_type": "EQUITY",
                    "listing_date": None,
                    "delisting_date": None,
                    "active": True,
                    "suspended": False,
                    "source_id": str(item.get("s") or f"MYX:{symbol}"),
                }
            )
        instruments = pd.DataFrame(rows)
        if instruments["symbol"].duplicated().any():
            duplicates = sorted(
                instruments.loc[instruments["symbol"].duplicated(False), "symbol"].unique()
            )
            raise RuntimeError(f"TradingView scanner returned duplicate symbols: {duplicates[:10]}")
        return instruments.sort_values("symbol", kind="stable").reset_index(drop=True)

    def _daily_interval(self) -> Any:
        if self.daily_interval is not None:
            return self.daily_interval
        from tvDatafeed import Interval

        self.daily_interval = Interval.in_daily
        return self.daily_interval

    def _tv_client(self) -> Any:
        if self._tv is None:
            if self.tv_factory is None:
                from tvDatafeed import TvDatafeed

                self.tv_factory = TvDatafeed
            self._tv = self.tv_factory()
        return self._tv

    @staticmethod
    def _normalize_history(frame: pd.DataFrame | None) -> pd.DataFrame | None:
        if frame is None or frame.empty:
            return None
        normalized = frame.copy()
        normalized.columns = [str(column).lower() for column in normalized.columns]
        required = ["open", "high", "low", "close", "volume"]
        if any(column not in normalized.columns for column in required):
            return None
        normalized = normalized[required]
        index = pd.DatetimeIndex(pd.to_datetime(normalized.index, errors="coerce"))
        if index.tz is not None:
            index = index.tz_convert("Asia/Kuala_Lumpur").tz_localize(None)
        normalized.insert(0, "date", index.normalize())
        normalized = normalized.dropna(subset=["date"])
        for column in required:
            normalized[column] = pd.to_numeric(normalized[column], errors="coerce")
        return (
            normalized.sort_values("date", kind="stable")
            .drop_duplicates("date", keep="last")
            .reset_index(drop=True)
        )

    def _fetch_remote(self, symbol: str, exchange: str, n_bars: int) -> pd.DataFrame | None:
        last_error: Exception | None = None
        for attempt in range(1, self.maximum_attempts + 1):
            try:
                frame = self._tv_client().get_hist(
                    symbol=symbol,
                    exchange=exchange,
                    interval=self._daily_interval(),
                    n_bars=n_bars,
                )
                normalized = self._normalize_history(frame)
                if normalized is not None and not normalized.empty:
                    return normalized
                last_error = RuntimeError("empty or malformed history")
            except Exception as error:  # tvDatafeed emits several untyped errors
                last_error = error
            self._tv = None
            if attempt < self.maximum_attempts:
                self.sleeper(min(2.0, 0.4 * (2 ** (attempt - 1))))
        log.warning("TradingView history failed for %s: %s", symbol, last_error)
        return None

    def _cache_path(self, symbol: str) -> Path:
        safe = re.sub(r"[^A-Z0-9._-]+", "_", symbol.upper())[:40] or "SYMBOL"
        digest = hashlib.sha256(symbol.encode("utf-8")).hexdigest()[:10]
        return self.cache_dir / f"{safe}-{digest}.csv"

    def _read_cache(self, symbol: str) -> pd.DataFrame | None:
        path = self._cache_path(symbol)
        if not path.is_file():
            return None
        try:
            frame = pd.read_csv(path)
            frame["date"] = pd.to_datetime(frame["date"], errors="coerce").dt.normalize()
            for column in ("open", "high", "low", "close", "volume"):
                frame[column] = pd.to_numeric(frame[column], errors="coerce")
            return frame.dropna(subset=["date"]).sort_values("date").reset_index(drop=True)
        except Exception as error:
            log.warning("Ignoring unreadable TradingView cache for %s: %s", symbol, error)
            return None

    def _write_cache(self, symbol: str, frame: pd.DataFrame) -> None:
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        destination = self._cache_path(symbol)
        temporary = destination.with_suffix(".tmp")
        frame.to_csv(temporary, index=False)
        temporary.replace(destination)

    def _stock_history(self, symbol: str, market_date: pd.Timestamp) -> pd.DataFrame | None:
        cached = self._read_cache(symbol)
        if cached is not None and len(cached) >= 260:
            cached_latest = cached["date"].max()
            if cached_latest == market_date:
                self._cache_hits += 1
                return cached.tail(self.n_bars).reset_index(drop=True)
            age = (market_date - cached_latest).days
            request_bars = self.incremental_bars if 0 < age <= 45 else self.n_bars
        else:
            request_bars = self.n_bars

        remote = self._fetch_remote(symbol, "MYX", request_bars)
        if remote is None:
            return cached
        if request_bars == self.n_bars:
            self._full_fetches += 1
        else:
            self._incremental_fetches += 1
        if cached is not None:
            remote = pd.concat([cached, remote], ignore_index=True)
        merged = (
            remote[remote["date"] <= market_date]
            .sort_values("date", kind="stable")
            .drop_duplicates("date", keep="last")
            .tail(self.n_bars)
            .reset_index(drop=True)
        )
        if not merged.empty:
            self._write_cache(symbol, merged)
        return merged

    def _completed_market_date(self, benchmark: pd.DataFrame) -> pd.Timestamp:
        latest = pd.Timestamp(benchmark["date"].max()).normalize()
        now = pd.Timestamp(self.clock())
        if now.tzinfo is None:
            now = now.tz_localize("Asia/Kuala_Lumpur")
        else:
            now = now.tz_convert("Asia/Kuala_Lumpur")
        today = now.normalize().tz_localize(None)
        session_ready = now.normalize() + pd.Timedelta(hours=17, minutes=30)
        if latest == today and now < session_ready:
            prior_dates = benchmark.loc[benchmark["date"] < today, "date"]
            if prior_dates.empty:
                raise RuntimeError("TradingView has no completed FBMKLCI session")
            return pd.Timestamp(prior_dates.max()).normalize()
        return latest

    def fetch(self) -> MarketDataBundle:
        instruments = self._fetch_universe()
        benchmark = self._fetch_remote("FBMKLCI", "MYX", self.n_bars)
        if benchmark is None or len(benchmark) < 260:
            raise RuntimeError("TradingView FBMKLCI history is missing or insufficient")
        market_date = self._completed_market_date(benchmark)
        benchmark = benchmark[benchmark["date"] <= market_date].tail(self.n_bars).reset_index(drop=True)
        if len(benchmark) < 260:
            raise RuntimeError("TradingView completed FBMKLCI history is insufficient")

        collected: list[pd.DataFrame] = []
        symbols = instruments["symbol"].tolist()
        for index, symbol in enumerate(symbols, 1):
            history = self._stock_history(symbol, market_date)
            if history is None or history.empty:
                self._failures.append(symbol)
            else:
                stock = history.copy()
                stock.insert(0, "symbol", symbol)
                collected.append(stock)
            if index % 50 == 0 or index == len(symbols):
                log.info(
                    "TradingView: %s/%s processed, %s histories available",
                    index,
                    len(symbols),
                    len(collected),
                )
            if index < len(symbols) and self.request_delay:
                self.sleeper(self.request_delay)

        bars = (
            pd.concat(collected, ignore_index=True)
            if collected
            else pd.DataFrame(columns=["symbol", "date", "open", "high", "low", "close", "volume"])
        )
        benchmarks = benchmark[["date", "close"]].copy()
        benchmarks.insert(0, "benchmark", "FBMKLCI")
        return MarketDataBundle(
            instruments=instruments,
            bars=bars,
            benchmarks=benchmarks,
            provider="TradingView free/no-login via tvDatafeed",
            source_market_date=str(market_date.date()),
            metadata={
                "fixture": False,
                "authentication": "anonymous",
                "source": "TradingView scanner + tvDatafeed",
                "data_rights_confirmed": False,
                "completed_session_cutoff": "17:30 Asia/Kuala_Lumpur",
                "scanner_total": self._scanner_total,
                "history_success": len(collected),
                "history_failures": len(self._failures),
                "failed_symbols_sample": self._failures[:50],
                "cache_hits": self._cache_hits,
                "incremental_fetches": self._incremental_fetches,
                "full_fetches": self._full_fetches,
            },
        )
