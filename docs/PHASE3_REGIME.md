# Phase 3 market-regime methodology

Phase 3 classifies one point-in-time Bursa market state for every accepted daily Quant run. It does not change `quant-v1.0.0`, enter trades, or optimize weights.

## Required inputs

The regime record is calculated only after the normal Phase 1 validation gate passes. It requires:

- FBM KLCI with at least 220 aligned daily closes
- the same valid stock universe used for the daily ranking
- price position versus 20DMA, 50DMA and 200DMA for every valid stock
- 52-week high/low participation
- 20-day volume participation
- at least five eligible Bursa sectors for breadth measurement

Missing, inconsistent or non-finite regime inputs reject the entire candidate run. The previous active score and regime remain visible.

## Regime Score

The versioned `regime-v1.0.0` score is 0–100:

| Component | Weight | Definition |
|---|---:|---|
| KLCI trend | 35% | KLCI versus 50/200DMA, 50/200DMA slopes, 50DMA versus 200DMA and 20D return |
| Market breadth | 35% | Shares above 20/50/200DMA plus new-high versus new-low balance |
| Sector breadth | 10% | Share of eligible sectors with at least half their stocks above 50DMA |
| Participation | 10% | Share of valid stocks trading at or above 20D average volume |
| Volatility | 10% | KLCI 20D annualized realized volatility; 100 at 12% or below, 0 at 35% or above |

Labels include confirmation rules so a high aggregate score cannot be called risk-on while the KLCI and breadth disagree:

- `STRONG RISK-ON`: score at least 75, KLCI above 50/200DMA, and at least 60% above 50DMA
- `RISK-ON`: score at least 60, KLCI above 200DMA, and at least 50% above 50DMA
- `STRONG RISK-OFF`: score below 30, KLCI below 50/200DMA, and no more than 30% above 50DMA
- `RISK-OFF`: score below 45, or KLCI below 200DMA with breadth below 40%
- `NEUTRAL`: all remaining mixed states

## Transparent guidance matrix

| Regime | Min Quant Score | Max equity | New size | Cash floor | Max new entries |
|---|---:|---:|---:|---:|---:|
| Strong Risk-On | 78 | 90% | 1.00× | 10% | 5 |
| Risk-On | 80 | 85% | 1.00× | 15% | 4 |
| Neutral | 84 | 65% | 0.75× | 35% | 2 |
| Risk-Off | 88 | 45% | 0.50× | 55% | 1 |
| Strong Risk-Off | 92 | 25% | 0.25× | 75% | 0 |

These are explicit research hypotheses, not live portfolio instructions. Phase 5 must validate sizing, concentration and correlation before any allocation engine can use them.

## Persistence and research

Every regime record is canonicalized, SHA-256 hashed, and stored against its immutable Quant run. The main publication cannot activate without a valid matching regime. Forward outcomes are later joined to their signal-date regime and summarized for 5D, 10D, 20D and 60D horizons. As in Phase 2, estimates remain hidden below 30 observations, provisional from 30–99, and established at 100 or more.
