# Phase 5 — shadow portfolio quant

Phase 5 converts the active Phase 4 shadow ledger into a normalized model portfolio. It recommends percentages of a hypothetical 100% portfolio; it does not know the operator's capital, current holdings, cost basis or broker balance and never places an order.

## Fixed sizing policy

Each `BUY_PENDING`, `OPEN` or `NEAR_SELL` state receives a risk budget starting from 0.60% of portfolio capital. The budget is multiplied by:

- the Phase 3 regime size multiplier;
- a transparent Quant Score multiplier from 0.50× to 1.25×;
- an ATR% volatility multiplier from 1.00× to 0.45×;
- an average-20-day-traded-value multiplier from 1.00× to 0.45×; and
- a correlation multiplier of 1.00×, 0.75× or 0.50× inside each high-correlation cluster.

Target weight is `risk budget ÷ effective stop distance`, capped at 6% per stock. For `BUY_PENDING`, effective stop distance is `3 × ATR%`. For an entered position it uses the Phase 4 trailing-stop distance, floored at one ATR to retain gap-risk allowance. `NEAR_SELL` records are marked `NO ADD`; Phase 5 does not change the Phase 4 exit rule.

## Portfolio limits

- single stock: 6%
- one sector: 25%
- high-correlation cluster: detected at 0.75 or higher over 60 aligned Bursa sessions
- total equity exposure and minimum cash: inherited unchanged from the active Phase 3 regime
- maximum stop risk: 6% Strong Risk-On, 5% Risk-On, 4% Neutral, 3% Risk-Off and 2% Strong Risk-Off

If a sector, exposure or total-risk cap is breached, weights are scaled down; the engine never scales positions up to consume unused cash.

## Portfolio diagnostics

The daily immutable snapshot records deployed capital, cash, total stop risk, largest position, top-five concentration, weighted Portfolio Quant Score, 60-day annualised volatility, beta versus FBM KLCI, sector exposures, correlation clusters and per-position risk/volatility contributions.

Expected drawdown is not invented. Stop risk is shown as the transparent current downside budget; a statistically estimated drawdown remains unavailable until sufficient model-portfolio history exists.

## Fail-closed publication

Phase 5 requires aligned 60-session stock/KLCI histories, positive ATR%, at least RM100,000 average daily traded value, valid sectors, active Phase 4 anchors, canonical hashes and `automatic_execution=false`. D1 promotes scores, regime, trade states and portfolio allocations together. Any count, date, score, price, trade ID, state, sector, risk-limit or hash mismatch rejects the candidate and preserves the previous verified run.

The owner-only browser `Portfolio` view presents normalized recommendations and concentration diagnostics. It is research and risk-management software, not a brokerage interface.
