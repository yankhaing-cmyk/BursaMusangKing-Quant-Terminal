# BursaMusangKing Quant Terminal

Standalone Phase 1 quantitative ranking platform for the full Bursa Malaysia equity universe.

## Current scope

Phase 1 is implemented:

- point-in-time daily OHLCV validation
- mandatory FBM KLCI benchmark alignment
- optional point-in-time sector benchmarks
- Trend, Momentum, Relative Strength, Volume, Volatility/Risk, Liquidity and Price Structure factors
- quantified Trending, Momentum Strategy and M.E.T.A. subscores
- fixed and versioned `quant-v1.0.0` ensemble
- Quant Score and rank for every eligible counter
- transparent liquidity caps for extremely illiquid counters
- immutable daily score records and auditable raw-data versions with private R2 checkpoints
- two-phase D1 publication that preserves the prior good run on failure
- mobile-first Today, Ranking, stock inspector and Health views
- dark/light mode and installable PWA shell

Phase 1 does **not** produce buy/sell orders, expected-edge claims, position sizes, portfolio allocations or machine-learning predictions. Those remain later phases and are deliberately not faked in the interface.

## System boundary

```text
TradingView Malaysia scanner + anonymous daily history
        ↓
GitHub Actions + Python
validate → factors → subscores → Quant Score → signed artifacts
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

The initial weights are hypotheses, not proof of edge. They remain fixed until Phase 2 builds score histories, forward-return buckets and out-of-sample evidence.

## Repository map

- `app/` — browser UI, read APIs and protected ingestion endpoints
- `db/` and `drizzle/` — D1 schema and migrations
- `quant/bmk_quant/` — Python validation, factor, scoring, storage and publishing engine
- `quant/tests/` — deterministic, fail-closed and full-universe tests
- `.github/workflows/` — CI plus gated manual/weekday quant workflow
- `docs/PHASE1_ARCHITECTURE.md` — the complete 12-part architecture and acceptance criteria
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

The header includes a protected **Run** button for full-universe shadow screening. The server dispatches the GitHub Actions workflow without exposing the token, applies an owner-authentication check and cooldown, and always sends `publish=false`. `RUN_ENABLED` must remain false until at least one complete free-TradingView shadow run passes review.

## Deployment

Follow [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). The production workflow uses the Cloudflare Dashboard and GitHub integration; it does not require the operator to deploy from a command-line Cloudflare tool. Automated weekday publishing is disabled until the production acceptance checklist is completed.
