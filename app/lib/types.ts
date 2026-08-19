export type RuntimeMode = "LIVE" | "DEMO";

export type QuantRow = {
  symbol: string;
  name: string;
  sector: string;
  close: number;
  rank: number;
  quantScore: number;
  trendScore: number;
  momentumScore: number;
  relativeStrengthScore: number;
  volumeScore: number;
  volatilityScore: number;
  liquidityScore: number;
  priceStructureScore: number;
  trendingScore: number;
  momentumStrategyScore: number;
  metaScore: number;
  strategyEnsembleScore: number;
  return20: number | null;
  return60: number | null;
  rs20: number | null;
  rs60: number | null;
  sectorRs20: number | null;
  atr14: number | null;
  atrPct: number | null;
  averageTradedValue20: number | null;
  volumeRatio20: number | null;
  distance52WeekHigh: number | null;
  historyDays: number;
  sectorRsAvailable: boolean;
  qualityFlags: string[];
  factorExplanation: Record<string, string>;
};

export type QuantRun = {
  id: string;
  marketDate: string | null;
  status: "ACTIVE" | "NOT_CONNECTED" | "BLOCKED";
  provider: string;
  modelVersion: string;
  payloadHash: string | null;
  validSymbols: number;
  totalInstruments: number;
  benchmarkDate: string | null;
  committedAt: string | null;
};

export type DataIssue = {
  severity: "WARNING" | "CRITICAL";
  code: string;
  symbol: string | null;
  detail: string;
};

export type DashboardSnapshot = {
  mode: RuntimeMode;
  run: QuantRun;
  rows: QuantRow[];
  totalRows: number;
  sectors: string[];
  universeMeanScore: number | null;
  highScoreCount: number;
  issues: DataIssue[];
};

export type RankingQuery = {
  search?: string;
  sector?: string;
  minimumScore?: number;
  sort?: "score" | "trend" | "momentum" | "rs" | "liquidity" | "symbol";
  direction?: "asc" | "desc";
  page?: number;
  pageSize?: number;
};

export type ResearchBucketStatistic = {
  scoreBucket: string;
  horizon: number;
  sampleSize: number;
  averageReturn: number;
  medianReturn: number;
  winRate: number;
  averageMae: number;
  averageMfe: number;
  standardError: number | null;
  confidenceLow: number | null;
  confidenceHigh: number | null;
  profitFactor: number | null;
  firstSignalDate: string;
  lastExitDate: string;
  updatedAt: string;
};

export type ResearchSnapshot = {
  methodologyVersion: string;
  scoreDates: number;
  observationCount: number;
  latestResearchRunId: string | null;
  latestResearchAt: string | null;
  minimumSample: number;
  establishedSample: number;
  statistics: ResearchBucketStatistic[];
};
