# Phase 1 market-data sources and contract

The quant engine does not depend on another BursaMusangKing repository. It supports the built-in anonymous TradingView adapter and a vendor-neutral bulk-data contract.

## Built-in free TradingView adapter

Use `--source tradingview-free`. The adapter:

- obtains the current MYX common-stock universe and sector labels from TradingView's Malaysia scanner;
- obtains 400 daily bars per counter and `MYX:FBMKLCI` through an anonymous `tvDatafeed` session;
- sends no username, password, cookie, or frontend token;
- fetches sequentially with retry, throttling, and a reusable per-symbol cache;
- excludes the current daily candle until 17:30 Malaysia time so an intraday Run cannot score incomplete OHLCV;
- refuses a truncated scanner response or missing/insufficient KLCI history;
- passes all collected data through the same Phase 1 validation gates before any score is accepted.

The free surface is unofficial and can change or become unavailable. It does not establish a right to redistribute TradingView data. Keep output private and in shadow mode unless the intended usage has been reviewed against the applicable terms. The initial adapter supplies sector classifications but no point-in-time Bursa sector-index histories, so market-relative strength is available while sector-relative strength is explicitly marked unavailable.

## Bulk feed contract

An alternative provider can deliver three checksum-pinned CSV files either in one local directory or through an HTTPS manifest.

## `instruments.csv`

Required: `symbol,name,sector`.

Supported: `sector_benchmark,board,security_type,listing_date,delisting_date,active,suspended,source_id`.

`security_type` may be `EQUITY`, `REIT`, or `ETF` in Phase 1. Warrants and structured products are excluded. Symbol and sector mappings must be point-in-time when used for historical research.

## `bars.csv`

Required: `symbol,date,open,high,low,close,volume`.

Supported: `adjusted_close`. If it is absent, `close` is used. When it differs from `close`, the engine applies the same adjustment ratio internally to open/high/low for return, trend, gap, structure and ATR calculations while retaining the raw close for display and traded value. The provider remains responsible for a consistent corporate-action policy. Dates are Bursa session dates in `YYYY-MM-DD`. Prices must be positive, volume non-negative, and OHLC relationships valid.

## `benchmarks.csv`

Required: `benchmark,date,close`.

`FBMKLCI` is mandatory. Sector benchmark identifiers must match `instruments.sector_benchmark`. All series used in one run must end on the identical trading date.

## HTTPS manifest

```json
{
  "provider": "Licensed Bursa EOD feed",
  "market_date": "2026-08-14",
  "licence": "internal-use",
  "files": {
    "instruments": {"url": "https://feed.example/instruments.csv", "sha256": "...64 hex..."},
    "bars": {"url": "https://feed.example/bars.csv", "sha256": "...64 hex..."},
    "benchmarks": {"url": "https://feed.example/benchmarks.csv", "sha256": "...64 hex..."}
  }
}
```

All file URLs must use HTTPS and the same host as the manifest. `BMK_DATA_FEED_TOKEN`, when present, is sent as a bearer token by the private GitHub Actions job. Synthetic fixtures are marked and are refused unless explicitly enabled for testing; they cannot be published by the live workflow.
