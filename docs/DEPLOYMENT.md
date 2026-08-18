# Phase 1 deployment — Dashboard and GitHub only

No command-line Cloudflare deployment is required.

1. Use only [yankhaing-cmyk/BursaMusangKing-Quant-Terminal](https://github.com/yankhaing-cmyk/BursaMusangKing-Quant-Terminal). Public visibility is acceptable because the repository contains code, not credentials or stored market-data artifacts. Do not connect the existing Strategy Terminal repository.
2. In repository **Settings → Actions → General**, allow GitHub Actions. Keep repository variables `ENABLE_SCHEDULED_QUANT=false` and `ENABLE_LIVE_PUBLISH=false`.
3. Run **CI**. It must pass the 905-stock synthetic smoke test, Python checks, web checks, and production build.
4. In **Actions → Daily Quant Pipeline → Run workflow**, leave **Publish** unchecked. This first anonymous TradingView run needs no data-provider secret. Inspect `manifest.json`, `validation.json`, score samples, market date, valid-symbol count, and payload hash in the downloadable artifact.
5. Do not enable browser dispatch or publication if the workflow fails, returns fewer than 900 valid counters, or reports a stale/mismatched market date. The cached histories are retained between workflow runs to reduce repeated downloads.
6. In Cloudflare Dashboard, create a D1 database for this Quant Terminal and apply the SQL files in `drizzle/` in numeric order. Bind it to the application as `DB`.
7. Add the Worker secret `INGEST_TOKEN` with a random value of at least 32 characters and add `MIN_VALID_UNIVERSE=900` as a server setting. In GitHub, add matching `BMK_INGEST_TOKEN` plus `BMK_QUANT_API_BASE` only when live publication is ready for acceptance testing.
8. A private R2 bucket for append-only research-history checkpoints is optional during the first shadow run. Configure it before relying on cross-run historical research; never make the raw cache or research database public.
9. After one clean shadow run, configure the protected browser Run button as described below. It will still dispatch only `publish=false`.
10. Complete the production acceptance checklist in `docs/PHASE1_ARCHITECTURE.md`. Enable live publication first; enable the weekday schedule only after at least ten clean shadow trading dates.

A dormant weekday trigger is defined for 19:07 Malaysia time (11:07 UTC), after Bursa closes. It does nothing while `ENABLE_SCHEDULED_QUANT` is not exactly `true`. Every triggered run still validates the actual Bursa trading date and fails closed on holidays, stale data, incomplete universes, or conflicting same-date payloads. A manual intraday Run uses the prior completed session rather than TradingView's still-forming daily candle.

## Secure browser Run button

The header Run button calls the server-side `/api/run` endpoint. It never receives or stores the GitHub token in browser JavaScript. Configure these values only in the hosted environment:

- `GITHUB_ACTIONS_TOKEN` — a fine-grained personal access token kept only as a server secret, restricted to this repository with **Actions: write** permission.
- `GITHUB_OWNER=yankhaing-cmyk` and `GITHUB_REPOSITORY=BursaMusangKing-Quant-Terminal`.
- `GITHUB_WORKFLOW=quant-daily.yml` and `GITHUB_REF=main`.
- `RUN_ENABLED=false` until the first complete free-TradingView shadow run passes. Change it to `true` only after reviewing that run.

The endpoint requires the authenticated Site owner, rejects cross-origin requests, enforces a default five-minute cooldown, and always dispatches with `publish=false`. It cannot activate live publication or change the accepted trading semantics.
