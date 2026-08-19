# Phase 2 research methodology

Phase 2 measures whether the unchanged `quant-v1.0.0` score has historically useful forward outcomes. It does not optimize factor weights or introduce machine learning.

## Observation contract

Each eligible daily score is a point-in-time anchor. Outcomes are calculated only after future Bursa sessions exist:

- entry: next trading session open
- exits: the closing price on the 5th, 10th, 20th and 60th later sessions
- forward return: exit close divided by entry open, less one
- MAE: worst intraperiod low relative to entry open
- MFE: best intraperiod high relative to entry open
- signal-close return: diagnostic close-to-close return
- return type: price return; dividends excluded

Every observation is hashed, published through a separate two-phase research gate and immutable once accepted. A partial or conflicting research payload cannot replace the last verified research state.

## Score buckets

`0–49`, `50–59`, `60–69`, `70–79`, `80–84`, `85–89`, `90–94`, and `95–100`.

The research cache stores sample size, average and median return, win rate, average MAE/MFE, profit factor, standard error and a 95% confidence interval for every matured bucket/horizon cell.

## Confidence policy

- fewer than 30 observations: estimate hidden; collection only
- 30–99 observations: provisional and explicitly labelled
- at least 100 observations: established descriptive evidence

“Established” is not automatic proof of tradable edge. Promotion of any rule still requires walk-forward and out-of-sample tests, trading costs, liquidity constraints and survivorship-bias review.

## Persistence

D1 remains the authoritative immutable score and published-outcome database. The heavy Python research store is restored and saved between GitHub Actions runs and is included in retained workflow artifacts. Losing the Python cache cannot create an estimate; it only delays additional observations until the research history is restored.
