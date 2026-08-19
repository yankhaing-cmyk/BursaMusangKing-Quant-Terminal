# BursaMusangKing Quant Terminal

Standalone quantitative ranking and evidence-collection platform for the full Bursa Malaysia equity universe.

## Current scope

Phases 1–4 are implemented; forward-outcome, market-regime and shadow trade-state collection is active:

- point-in-time daily OHLCV validation
- mandatory FBM KLCI benchmark alignment
- optional point-in-time sector benchmarks
- Trend, Momentum, Relative Strength, Volume, Volatility/Risk, Liquidity and Price Structure factors
- quantified Trending, Momentum Strategy and M.E.T.A. subscores
- fixed and versioned `quant-v1.0.0` ensemble
- Quant Score and rank for every eligible counter
- transparent liquidity caps for extremely illiquid counters
- immutable daily score records and auditable raw-data versions
- two-phase D1 publication that preserves the prior good run on failure
- next-session-open 5D, 10D, 20D and 60D forward-outcome collection
- immutable MAE/MFE observations with checksum-verified research publication
- score-bucket averages, medians, win rates, profit factors and 95% confidence intervals
- sample-size policy that hides estimates below 30 observations
- point-in-time Bursa regime classification using KLCI trend, breadth, sector participation, volume and volatility
- five market states from `STRONG RISK-ON` through `STRONG RISK-OFF`
- transparent regime-aware candidate thresholds, exposure ceilings, cash floors and size multipliers
- regime-specific forward-outcome statistics with the same sample-size controls
- immutable `FLAT`, `BUY_PENDING`, `OPEN`, `NEAR_SELL` and `CLOSED` daily trade states
- next-session-open entry, no same-day re-entry and gap-aware ATR stop execution
- prior stop checked before highest-close peak update, with Bursa tick-size rounding
- expected 20D edge attached only when the matching score/regime sample is at least 30
- checksum-verified trade-state and event publication that preserves the prior active run on failure
- mobile-first Today, Ranking, Open, Regime, Research, stock inspector and Health views
- dark/light mode and installable PWA shell

Phase 2 does **not** claim an expected edge until real forward observations mature and pass the stated sample thresholds. Phase 3 policy values do not alter the fixed Quant Score. Phase 4 is a shadow trade ledger: it never routes orders, never treats `BUY_PENDING` as a filled position, and keeps expected edge hidden below the minimum sample. Portfolio allocation and machine learning remain off.

## System boundary

```text
TradingView Malaysia scanner + anonymous daily history
        ↓
GitHub Actions + Python
validate → factors → Quant Score → market regime → trade states → forward outcomes → signed artifacts
        ↓
protected two-phase publish
        ↓
Cloudflare D1 + Worker APIs
        ↓
mobile browser / PWA
```

The repository has no code or runtime dependency on the existing Bursa Strategy Terminal. Its built-in `tradingview-free` adapter independently obtains the Bursa universe from TradingView's Malaysia scanner and daily history through an anonymous `tvDatafeed` session. No TradingView login or paid plan is required. The adapter is unofficial, throttled, cached, and fail-closed; it is intended for private shadow research until the operator confirms the applicable data-use and redistribution rights. A vendor-neutral bulk CSV/HTTPS contract remains available and is documented in [docs/DATA_CONTRACT.md](docs/DATA_CONTRACT.md).

## Score formula

```text
20% Trend
20% Momentum
20% Relative Strength
10% Volume
10% Volatility / Risk
10% Liquidity
10% Strategy Ensemble
```

`Strategy Ensemble` is the mean of the Trending, Momentum Strategy and M.E.T.A. subscores. Price Structure is visible and contributes inside Trending and M.E.T.A. to avoid double-counting it as an extra top-level weight.

The initial weights are hypotheses, not proof of edge. Phase 2 measures them without changing them; optimization remains prohibited until sufficient out-of-sample evidence exists.

## Repository map

- `app/` — browser UI, read APIs and protected ingestion endpoints
- `db/` and `drizzle/` — D1 schema and migrations
- `quant/bmk_quant/` — Python validation, scoring, research storage and publishing engine
- `quant/tests/` — deterministic, fail-closed and full-universe tests
- `.github/workflows/` — CI plus gated manual/weekday quant workflow
- `docs/PHASE1_ARCHITECTURE.md` — the complete 12-part architecture and acceptance criteria
- `docs/PHASE2_RESEARCH.md` — forward-outcome methodology and confidence policy
- `docs/PHASE3_REGIME.md` — market-regime formula, guidance matrix and validation gates
- `docs/PHASE4_TRADES.md` — shadow state machine, ATR execution and edge gates
- `docs/DATA_CONTRACT.md` — vendor-neutral source contract
- `docs/DEPLOYMENT.md` — sequential Cloudflare Dashboard and GitHub setup

## Verification

Python engine:

```bash
python -m pip install -e 'quant[tradingview]'
python -m unittest discover -s quant/tests -v
BMK_FULL_SMOKE=1 python -m unittest quant.tests.test_pipeline.FullUniverseSmokeTest -v
```

Run one local anonymous shadow screen with:

```bash
bmk-quant run \
  --source tradingview-free \
  --output artifacts/latest \
  --history-db artifacts/quant_history.sqlite \
  --min-universe 900
```

The initial download is intentionally sequential and can take several minutes for 1,000+ counters. Later runs reuse the cached 400-bar histories. Before 17:30 Malaysia time, an intraday Run ignores the still-forming daily candle and uses the prior completed session. A partial universe, missing FBM KLCI, stale dates, invalid OHLCV, or fewer than 900 valid counters rejects the entire run.

Browser application:

```bash
npm ci
npm run lint
npm test
```

`npm test` builds the Worker-compatible artifact, validates its structure, confirms fail-closed rendering without D1, and checks that Python and Worker canonical row hashes agree.

## Non-production fixture

Generate an explicitly labelled synthetic dataset for local testing:

```bash
bmk-quant fixture \
  --output /tmp/bmk-fixture \
  --symbols 905 \
  --days 270 \
  --explicitly-non-production

bmk-quant run \
  --source /tmp/bmk-fixture \
  --output artifacts/latest \
  --history-db artifacts/quant_history.sqlite \
  --min-universe 900 \
  --allow-fixture
```

Fixture data is marked and cannot silently become a live feed. The app shows an unmistakable **NOT LIVE** state until a verified D1 run is activated.

The header includes a protected **Run** button for full-universe screening. It calls the dedicated Cloudflare run gateway, which keeps the GitHub dispatch token encrypted, requires a separate manual-run key, and applies an origin allowlist and cooldown. The key is stored only on the operator's device after first use. Accepted runs publish with a short-lived GitHub Actions OIDC token that is restricted to this repository, workflow, branch, and environment. Browser pages and read/run APIs independently enforce the owner email after ChatGPT sign-in; anonymous and non-owner requests cannot read rankings or trade states. The D1 ingestion gate rejects incomplete, stale, conflicting, or malformed score/regime/trade snapshots together and preserves the previous verified run on failure. Automated weekday publication remains disabled until the full live acceptance checklist is complete.

## Deployment

Follow [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). The production workflow uses the Cloudflare Dashboard and GitHub integration; it does not require the operator to deploy from a command-line Cloudflare tool. Automated weekday publishing is disabled until the production acceptance checklist is completed.
