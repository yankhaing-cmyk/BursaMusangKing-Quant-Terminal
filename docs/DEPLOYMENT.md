# Quant Terminal deployment — Dashboard and GitHub only

No command-line Cloudflare deployment is required.

1. Use only [yankhaing-cmyk/BursaMusangKing-Quant-Terminal](https://github.com/yankhaing-cmyk/BursaMusangKing-Quant-Terminal). Public visibility is acceptable because the repository contains code, not credentials or stored market-data artifacts. Do not connect the existing Strategy Terminal repository.
2. In repository **Settings → Actions → General**, allow GitHub Actions. Keep repository variables `ENABLE_SCHEDULED_QUANT=false` and `ENABLE_LIVE_PUBLISH=false`.
3. Run **CI**. It must pass the 905-stock synthetic smoke test, Python checks, web checks, and production build.
4. In **Actions → Daily Quant Pipeline → Run workflow**, leave **Publish** unchecked. This first anonymous TradingView run needs no data-provider secret. Inspect `manifest.json`, `validation.json`, score samples, market date, valid-symbol count, and payload hash in the downloadable artifact.
5. Do not enable browser dispatch or publication if the workflow fails, returns fewer than 900 valid counters, or reports a stale/mismatched market date. The cached histories are retained between workflow runs to reduce repeated downloads.
6. In Cloudflare Dashboard, create a D1 database for this Quant Terminal and apply the SQL files in `drizzle/` in numeric order. Bind it to the application as `DB`.
7. Add `MIN_VALID_UNIVERSE=900` as a server setting. Verified publication uses a short-lived GitHub Actions OIDC token restricted to this repository, workflow, branch, and `quant-production` environment; no shared ingestion secret is required. A static `INGEST_TOKEN` remains an optional break-glass fallback and must never reach browser JavaScript.
8. Phases 2–5 restore and save the private research, regime, trade-state and portfolio-allocation SQLite database through GitHub Actions cache and retain each run artifact for 30 days. A private R2 archive remains the recommended later durability upgrade; never make raw histories or research databases public.
9. After one clean shadow run, configure the protected browser Run button as described below. Manual runs dispatch `publish=true`, but D1 promotion remains fail-closed and the terminal remains owner-only.
10. Complete the production acceptance checklist in `docs/PHASE1_ARCHITECTURE.md`. Enable live publication first; enable the weekday schedule only after at least ten clean shadow trading dates.

A dormant weekday trigger is defined for 19:47 Malaysia time (11:47 UTC), after Bursa closes and the user's preferred 19:45 review time. It does nothing while `ENABLE_SCHEDULED_QUANT` is not exactly `true`. Every triggered run still validates the actual Bursa trading date and fails closed on holidays, stale data, incomplete universes, or conflicting same-date payloads. A manual intraday Run uses the prior completed session rather than TradingView's still-forming daily candle.

## Secure browser Run button

The header Run button calls the dedicated Cloudflare Worker at `bursa-quant-run-gateway.yankhaing.workers.dev/run`. The complete auditable Worker source is `cloudflare/run-gateway/worker.js`. The GitHub token never reaches browser JavaScript.

Create a Workers KV namespace named `bursa-quant-run-state` and bind it to the Worker as `RUN_STATE`. Configure these Worker values in the Cloudflare Dashboard:

- Secret `GITHUB_ACTIONS_TOKEN` — restricted to the Quant Terminal repository and permitted to dispatch Actions.
- Secret `MANUAL_RUN_KEY` — an independent random value of at least 32 characters. It is entered into the owner-only app on first use and kept only on that device.
- `GITHUB_OWNER=yankhaing-cmyk` and `GITHUB_REPOSITORY=BursaMusangKing-Quant-Terminal`.
- `GITHUB_WORKFLOW=quant-daily.yml` and `GITHUB_REF=main`.
- `COOLDOWN_SECONDS=300`.

The approved owner-only Site origin is fixed in the auditable gateway source rather than accepted from runtime configuration. The gateway rejects all other origins and invalid run keys, stores its cooldown state in KV, and dispatches the validated quant workflow with `publish=true`. Publication is still gated by signed GitHub identity, universe/date/hash validation, and atomic D1 promotion. The gateway cannot activate scheduling, execution, or change trading semantics. If the key is rejected, the app deletes its local copy and asks the operator to enter it again.
