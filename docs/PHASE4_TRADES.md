# Phase 4 — shadow trade-state layer

Phase 4 adds an auditable trade-state machine without enabling brokerage execution or changing the fixed Quant Score. Every verified daily run produces one immutable trade-state record per valid stock plus immutable transition events.

## State machine

- `FLAT` — no tracked trade.
- `BUY_PENDING` — a regime-eligible top-ranked candidate; not yet owned and no entry price is shown.
- `OPEN` — entry confirmed at the next Bursa session open.
- `NEAR_SELL` — the closing price is within one current ATR of the trailing stop.
- `CLOSED` — the prior stop was touched; this state is retained for that daily snapshot and the event remains immutable.

New `BUY_PENDING` records require the Quant Score to meet the current regime minimum, a positive ATR14, at least RM100,000 average 20-day traded value, and no illiquidity/intermittent-trading flag. Candidates are selected in rank order and capped by the regime's existing `max_new_entries` policy. `STRONG RISK-OFF` therefore permits no new signals.

## Frozen execution sequence

1. A qualifying close creates `BUY_PENDING`.
2. Entry is the next available Bursa session open. The signal date can never be the entry date.
3. The initial stop is entry less `3.0 × ATR14`, rounded down to a valid Bursa tick.
4. On every later session, the prior stop is checked against the daily low before the peak is updated.
5. A gap below the stop exits at the session open; otherwise an intraday touch exits at the stop.
6. Only after no stop is touched is the peak updated using the highest close.
7. The stop can rise but never fall: `max(prior stop, highest close − 3.0 × current ATR14)`.
8. A stopped stock cannot receive a new signal on the same trading date.

The free TradingView daily feed does not provide intraday event order. Checking the already-established stop before changing the peak is deliberately conservative and prevents look-ahead. A possible corporate-action gap or missing active-position bar rejects the trade layer rather than silently creating an exit.

## Expected edge

The signal freezes the matching 20-day score-bucket and market-regime estimate. The value is hidden when the point-in-time sample is below 30, marked provisional for 30–99 observations, and established at 100 or more. Sample size is always displayed. Price returns exclude dividends.

## Publication controls

Trade states and events use a separate `trade-v1.0.0` canonical hash contract. D1 promotion requires:

- exactly one state for every valid scored stock;
- state and event counts matching the manifest;
- canonical state/event hashes matching the Python publisher;
- score, closing price, market date and regime anchors matching the same pending run;
- `automatic_execution=false`;
- all score, regime and trade validations to pass in one promotion.

Any mismatch rejects the candidate run and preserves the prior verified daily snapshot. The browser `Open` view is owner-only and explicitly labelled as a shadow ledger. Phase 5 consumes these immutable states without changing their entry, stop or exit semantics.

The GitHub history cache is advanced only after the score/regime/trade snapshot is confirmed active. Dry runs and rejected publications cannot become the parent state for a later entry.
