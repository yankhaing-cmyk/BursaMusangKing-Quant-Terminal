import type { DashboardSnapshot, QuantRow } from "./types";

const seed = [
  ["DEMO01", "Meranti Systems", "Technology", 3.24, 91.4, 94, 89, 92, 81, 72, 83],
  ["DEMO02", "Selat Healthcare", "Health Care", 6.18, 88.7, 90, 86, 91, 74, 79, 88],
  ["DEMO03", "Borneo Industrial", "Industrial Products", 1.52, 86.2, 89, 84, 87, 82, 68, 77],
  ["DEMO04", "Saujana Consumer", "Consumer Products", 4.76, 83.9, 84, 85, 82, 78, 76, 80],
  ["DEMO05", "Langkasuka Energy", "Energy", 2.08, 81.3, 87, 78, 80, 73, 65, 75],
  ["DEMO06", "Kinabalu Logistics", "Transportation", 0.845, 78.8, 77, 82, 79, 88, 61, 70],
  ["DEMO07", "Tanjung Materials", "Construction", 1.17, 75.6, 80, 72, 77, 69, 71, 74],
  ["DEMO08", "Mutiara REIT", "REIT", 1.46, 72.4, 71, 68, 74, 61, 90, 86],
  ["DEMO09", "Rimba Plantations", "Plantation", 5.92, 69.8, 67, 71, 66, 59, 82, 79],
  ["DEMO10", "Wira Financial", "Financial Services", 2.63, 66.1, 64, 69, 62, 70, 84, 91],
  ["DEMO11", "Permai Properties", "Property", 0.72, 61.7, 63, 58, 64, 55, 73, 62],
  ["DEMO12", "Nusantara Media", "Telecommunications", 1.91, 57.5, 55, 61, 56, 63, 60, 67],
] as const;

export const demoRows: QuantRow[] = seed.map((item, index) => {
  const [symbol, name, sector, close, quant, trend, momentum, rs, volume, volatility, liquidity] = item;
  const trending = trend * 0.75 + rs * 0.25;
  const momentumStrategy = momentum * 0.55 + rs * 0.3 + volume * 0.15;
  const meta = momentum * 0.35 + volume * 0.25 + trend * 0.25 + liquidity * 0.15;
  return {
    symbol,
    name,
    sector,
    close,
    rank: index + 1,
    quantScore: quant,
    trendScore: trend,
    momentumScore: momentum,
    relativeStrengthScore: rs,
    volumeScore: volume,
    volatilityScore: volatility,
    liquidityScore: liquidity,
    priceStructureScore: Math.round((trend * 0.6 + volume * 0.4) * 10) / 10,
    trendingScore: Math.round(trending * 10) / 10,
    momentumStrategyScore: Math.round(momentumStrategy * 10) / 10,
    metaScore: Math.round(meta * 10) / 10,
    strategyEnsembleScore: Math.round(((trending + momentumStrategy + meta) / 3) * 10) / 10,
    return20: (12 - index) / 100,
    return60: (20 - index) / 100,
    rs20: (8 - index * 0.6) / 100,
    rs60: (11 - index * 0.7) / 100,
    sectorRs20: index % 4 === 0 ? null : (5 - index * 0.35) / 100,
    atr14: close * (0.018 + index * 0.001),
    atrPct: 0.018 + index * 0.001,
    averageTradedValue20: 18_000_000 - index * 850_000,
    volumeRatio20: 1.6 - index * 0.05,
    distance52WeekHigh: -(index * 0.012),
    historyDays: 320,
    sectorRsAvailable: index % 4 !== 0,
    qualityFlags: index % 4 === 0 ? ["SECTOR_RS_UNAVAILABLE"] : [],
    factorExplanation: {
      trend: "MA alignment, slopes, price structure and 52-week-high proximity.",
      momentum: "20D, 60D, 120D and 252D returns, acceleration and consistency.",
      relativeStrength: "Stock returns less FBM KLCI and, when available, sector returns.",
    },
  };
});

export const demoSnapshot: DashboardSnapshot = {
  mode: "DEMO",
  run: {
    id: "demo-not-published",
    marketDate: null,
    status: "NOT_CONNECTED",
    provider: "Illustrative fixture",
    modelVersion: "quant-v1.0.0",
    payloadHash: null,
    validSymbols: 0,
    totalInstruments: 0,
    benchmarkDate: null,
    committedAt: null,
  },
  rows: demoRows,
  totalRows: demoRows.length,
  sectors: [...new Set(demoRows.map((row) => row.sector))].sort(),
  universeMeanScore: null,
  highScoreCount: 0,
  issues: [
    {
      severity: "WARNING",
      code: "DEMO_MODE",
      symbol: null,
      detail: "No verified D1 run is active. Rows are illustrative and are not market data or trade signals.",
    },
  ],
};
