# BursaMusangKing Quant Terminal — Phase 1 Architecture

Status: frozen for Phase 1 implementation  
Scope: daily cross-sectional scoring and inspection only; no live order execution or changed trading semantics

## 1. Repository and file structure

```text
.
├── app/                         # Mobile-first web application and read APIs
│   ├── api/                     # health, ranking, stock detail, ingestion
│   ├── components/              # compact reusable UI components
│   ├── lib/                     # D1 access, validation, demo fallback
│   ├── health/                  # Health view
│   ├── ranking/                 # Full-universe ranking view
│   └── stock/[symbol]/          # Transparent stock score inspection
├── db/
│   ├── schema.ts                # Drizzle source of truth
│   └── migrations/              # inspected SQL migrations
├── quant/
│   ├── bmk_quant/               # Python package
│   │   ├── cli.py               # validate, score, export, publish
│   │   ├── config.py            # versioned weights and thresholds
│   │   ├── factors.py           # point-in-time raw factors
│   │   ├── scoring.py           # cross-sectional 0–100 scores
│   │   ├── validation.py        # fail-closed gates
│   │   ├── storage.py           # immutable local research store
│   │   └── providers/           # pluggable full-universe feed contract
│   ├── tests/                   # deterministic unit/integration tests
│   ├── fixtures/                # synthetic, clearly labelled test data
│   └── pyproject.toml
├── worker/                      # Cloudflare-compatible server entry
├── public/                      # PWA manifest and static assets
├── .github/workflows/           # CI and daily/manual quant jobs
├── docs/                        # architecture, runbook, data contract
└── README.md
```

The repository is standalone. It does not import, clone, mutate, or publish to the existing Bursa Strategy Terminal.

## 2. Data flow

1. The initial anonymous TradingView provider downloads the current MYX common-stock universe, sector labels, FBM KLCI bars, and daily Bursa OHLCV. A later authorized feed may additionally supply point-in-time sector mappings, sector benchmarks, and adjusted histories.
2. Raw inputs are normalized to `Asia/Kuala_Lumpur` trading dates and validated before calculation.
3. The Python engine computes raw point-in-time factors using data available at that close only.
4. Raw factors are winsorized cross-sectionally and converted to percentile subscores.
5. Fixed, versioned weights produce a 0–100 Quant Score for every eligible stock.
6. A run manifest records source, market date, counts, model version, validation results, and a canonical SHA-256 payload hash.
7. The publisher uploads a pending run and score batches. D1 keeps the run invisible until a final validation/commit request succeeds.
8. Commit atomically changes `active_run_id`; failed or partial runs never replace the previous good date.
9. Browser APIs read only the active run. The UI shows market date, freshness, coverage, score components, and warnings.

## 3. Database schema

### `instruments`

- `symbol` primary key; Bursa code/name; sector; board; listing/delisting dates; active/suspended flags; source identifiers; last-seen date.

### `quant_runs`

- immutable run ID, market date, status (`PENDING`, `ACTIVE`, `REJECTED`, `SUPERSEDED`), provider, model version, payload hash, coverage counts, benchmark date, timestamps, and validation report.
- unique `(market_date, payload_hash)` makes identical retries idempotent.
- only one active run is referenced by `app_state`.

### `daily_scores`

- composite primary key `(run_id, symbol)`.
- close, sector, rank, Quant Score, seven family scores, three strategy subscores, key raw diagnostics, history length, quality flags, and factor explanation JSON.
- records are immutable after a run is committed.

### `factor_values`

- optional normalized long-form research table keyed by `(run_id, symbol, factor_name)` for raw value, normalized value, and score. Phase 1 stores primary fields in `daily_scores`; the schema reserves this table for auditability.

### `data_issues`

- run, severity, code, symbol, field, and human-readable detail.

### `app_state`

- single-row pointer to the active verified run. Publication changes this pointer only after all server-side checks pass.

Raw OHLCV remains in an append-only Python-side SQLite research store because numerical research is a GitHub Actions responsibility, not a Worker responsibility. Each accepted run restores the verified latest database from private R2, adds raw bar versions and immutable scores, runs an integrity check, and writes both a dated R2 checkpoint and a verified latest pointer. D1 daily scores are never overwritten.

## 4. Factor definitions

All returns use adjusted close. Rolling operations require complete observations and are shifted correctly during historical replay.

### Trend

- close/20DMA, close/50DMA, close/200DMA distance
- 20-day slopes of the 20DMA and 50DMA, and 40-day slope of the 200DMA, normalized by price
- 20-day higher-high/higher-low structure
- distance from 252-day high
- breakout distance above the prior 55-day high (the current day is excluded from the prior high)

### Momentum

- 20D, 60D, 120D, and 252D total returns
- acceleration: 20D return minus one third of 60D return
- consistency: share of positive 20-day returns inside the last 120 days

### Relative strength

- `RS20 = stock_20D_return − KLCI_20D_return`
- corresponding RS60 and RS120
- sector RS20/60 when an eligible sector benchmark exists
- benchmark and stock returns must end on the identical market date

### Volume / participation

- current volume / 20D and 50D average volume
- 20D average / 50D average volume acceleration
- 20D up-volume / down-volume ratio
- breakout-volume confirmation on a prior-55D-high break

### Volatility / risk

- Wilder ATR14 and ATR as a percentage of close
- annualized 20D realized volatility
- annualized 60D downside deviation
- worst 20D drawdown in the trailing 120 days
- 60D absolute overnight-gap percentile

Low/moderate risk receives a higher score, but extremely low volatility is not automatically rewarded when liquidity is poor.

### Liquidity

- 20D and 60D average traded value
- 20D average volume
- zero-volume-day rate
- Amihud-style absolute-return/traded-value spread proxy
- hard ineligibility or penalty for extremely illiquid counters

### Price structure

- distance to 20D support (prior rolling low)
- distance to 55D breakout level
- Bollinger bandwidth compression percentile
- base quality: tight closes, contained drawdown, and stable volume over 40 days

### Strategy subscores

- Trending: MA alignment, slopes, 52-week-high proximity, and higher-high/higher-low structure.
- Momentum: multi-horizon momentum, acceleration, consistency, and RS confirmation.
- M.E.T.A.: transparent composite of momentum, expansion/breakout, trend alignment, and activity/volume confirmation.

These are scores, not Boolean signals. Phase 1 does not create trades.

## 5. Initial Quant Score formula

```text
Strategy Ensemble = mean(Trending, Momentum Strategy, M.E.T.A.)

Quant Score =
  0.20 × Trend
+ 0.20 × Momentum
+ 0.20 × Relative Strength
+ 0.10 × Volume
+ 0.10 × Volatility/Risk
+ 0.10 × Liquidity
+ 0.10 × Strategy Ensemble
```

Price Structure is visible as a diagnostic subscore and contributes inside Trend and M.E.T.A. in v1 to avoid silently exceeding 100% total weight. Each component and the final score is clipped to `[0,100]` and rounded only for display. Missing required families make a stock ineligible; missing optional sector RS reduces confidence and is disclosed, never silently replaced with zero.

After the weighted score, a transparent liquidity gate caps counters with 20-day average traded value below RM100,000 at 69.9 and below RM20,000 at 55.0. The uncapped weighted score remains stored for audit. This prevents an almost untradeable counter from ranking as an elite candidate solely because other technical factors are strong.

Version `quant-v1.0.0` freezes formulas, weights, thresholds, and normalization. A formula change requires a new model version.

## 6. Benchmark and sector-relative-strength design

- FBM KLCI is mandatory and is the common market benchmark.
- Sector benchmark mapping is versioned and point-in-time dated.
- A sector comparison is calculated only when the sector benchmark has the identical final date and sufficient history.
- If no valid sector index is available, market RS remains valid, `sector_rs_available=false`, and the UI discloses the limitation.
- The initial TradingView adapter has sector labels but no point-in-time sector benchmark series, so it discloses `sector_rs_available=false`; it never invents a sector comparison.
- A configurable provider symbol map isolates vendor-specific identifiers from the factor engine.
- The engine never substitutes a sector ETF or current sector mapping retrospectively without an effective date.

## 7. Fail-closed validation rules

A run cannot become active when any critical rule fails:

- fewer than `MIN_VALID_UNIVERSE` stocks (production default 900)
- missing/late FBM KLCI or benchmark date different from stock market date
- duplicate normalized symbols
- non-positive open/high/low/close, negative volume, or broken OHLC relationships
- future date, weekend date, mixed latest dates, or a stale market date beyond the configured trading-calendar tolerance
- fewer than 260 bars for production eligibility, unless explicitly classified as a recent IPO and scored only on supported families
- missing required score family, non-finite value, or score outside 0–100
- invalid/unknown model version or weights not summing to one
- materially incomplete sector/security master
- payload count/hash mismatch during upload
- same market date with a different already-active payload hash
- partial batch, server-side row-count mismatch, or any critical `data_issues` row

Warnings (for example, unavailable sector index) remain visible but do not pass as complete data.

## 8. GitHub Actions architecture

### `ci.yml`

- on pull request and push
- installs locked Python and Node dependencies
- runs Python tests, type/syntax checks, deterministic fixture pipeline, frontend lint/tests, production build, and artifact validation

### `quant-daily.yml`

- `workflow_dispatch` in Phase 1
- optional weekday trigger at 11:07 UTC / 19:07 Malaysia time, guarded by repository variable `ENABLE_SCHEDULED_QUANT == 'true'`
- installs a commit-pinned anonymous `tvdatafeed` adapter, restores a private Actions cache, fetches the full universe sequentially, validates, scores, and exports
- ignores the current daily candle until 17:30 Malaysia time, preventing an intraday Run from scoring incomplete OHLCV
- publishes through the protected ingestion API only when separately and explicitly enabled
- stores the manifest, validation report, and compact logs as workflow artifacts
- uses environment protection for production
- concurrency lock prevents overlapping market-date publications

No GitHub token or data-provider credential is placed in the browser bundle. The workflow uses GitHub secrets.

## 9. Cloudflare architecture

- Cloudflare Pages/static assets are linked to GitHub through the Dashboard.
- One Worker-compatible server handles ranking, health, stock-detail, and protected ingestion routes.
- D1 binding name: `DB`; created and bound in the Dashboard.
- `INGEST_TOKEN` is a Cloudflare secret and a corresponding GitHub Actions secret; it never reaches client JavaScript.
- API responses use tight cache headers: ranking pages can be cached briefly; health/active-run metadata remains fresh.
- ingestion is two phase (`PENDING` → `ACTIVE`) with body limits, batch limits, constant-time token comparison, rate limiting at the edge where available, and idempotency.
- Deployment/runbook uses the Cloudflare Dashboard and GitHub integration; users are not required to install or operate Wrangler.

## 10. Mobile browser UI layout

The first viewport is risk/freshness first:

- compact header: product name, market date, last verified time, light/dark toggle
- health strip: active/blocked status, valid/expected universe, benchmark freshness
- four compact cards: regime placeholder (Phase 3), valid stocks, median score, ≥80 count
- ranking controls: search, sector, minimum score, sort
- dense but touch-safe rows: rank, code/name, close, Quant Score, score change placeholder, Trend/Momentum/RS, liquidity flag
- tap a row for an inspector showing weighted score bridge, factor definitions, raw diagnostics, data quality, and timestamp
- bottom phone navigation exposes Today, Ranking, and Health; later-phase tabs are labelled but not faked
- numbers use tabular figures; color is redundant with labels/icons; light and dark themes meet contrast targets

## 11. Testing strategy

- unit: each rolling formula, Wilder ATR, return alignment, scoring direction, winsorization, weights, and eligibility
- property/invariant: score range, deterministic ordering, no non-finite results, high-is-better direction, duplicate rejection
- look-ahead: perturb future bars and assert earlier scores are unchanged
- integration: synthetic full pipeline → manifest → batch publish contract → API responses
- golden fixture: fixed symbols and expected subscores/hash
- failure tests: low universe, missing KLCI, bad OHLC, mixed dates, stale date, conflicting retry, incomplete publish
- provider tests: complete scanner response, anonymous history shape, same-date cache reuse, truncated scanner rejection, and missing-KLCI rejection
- database: migration applies to a clean D1-compatible SQLite database; constraints and indexes are inspected
- web: API schema tests, rendered-content test, keyboard/touch target checks, theme persistence, responsive screenshots
- CI production build and artifact validation

Synthetic fixtures prove behavior, not live-data readiness. A separate full-universe shadow run is mandatory before production acceptance.

## 12. Production acceptance criteria

Phase 1 is accepted only after all of the following are evidenced:

1. At least ten consecutive Bursa trading dates run successfully in shadow mode.
2. Each accepted date has at least 900 valid stocks and an exact-date FBM KLCI benchmark.
3. Random samples across price, sector, and liquidity bands reconcile OHLCV and key indicators to the source.
4. Re-running a date is deterministic; same input produces the same payload hash and ranks.
5. A deliberately corrupt, stale, partial, or conflicting payload is rejected and the prior active date remains visible.
6. All eligible stocks have finite 0–100 Quant Scores and transparent subscores; exclusions have explicit reason codes.
7. Ranking/search/filter/detail and Health work on a representative Android viewport in light and dark modes.
8. P95 cached ranking API latency is below 500 ms and the page remains usable on a typical mobile connection.
9. No secret appears in repository history, generated JavaScript, browser requests, logs, or artifacts.
10. CI is green, D1 backup/export is tested, monitoring identifies a missed run, and rollback to the prior active run is rehearsed.
11. The source licence and redistribution rights permit the intended use.
12. Automated weekday publication stays disabled until these gates pass.
