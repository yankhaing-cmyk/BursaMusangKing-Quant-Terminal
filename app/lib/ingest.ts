import { canonicalScore as canonicalScoreShared } from "@/shared/canonical-score.mjs";

type RuntimeEnv = {
  DB?: D1Database;
  INGEST_TOKEN?: string;
  MIN_VALID_UNIVERSE?: string;
};

export type InstrumentPayload = {
  symbol: string;
  name: string;
  sector: string;
  sector_benchmark?: string | null;
  board?: string | null;
  security_type?: string;
  listing_date?: string | null;
  delisting_date?: string | null;
  active?: boolean;
  suspended?: boolean;
  source_id?: string | null;
  last_seen_date: string;
};

export type ScorePayload = {
  symbol: string;
  name: string;
  sector: string;
  close: number;
  rank: number;
  quant_score: number;
  trend_score: number;
  momentum_score: number;
  relative_strength_score: number;
  volume_score: number;
  volatility_score: number;
  liquidity_score: number;
  price_structure_score: number;
  trending_score: number;
  momentum_strategy_score: number;
  meta_score: number;
  strategy_ensemble_score: number;
  return_20: number | null;
  return_60: number | null;
  rs_20: number | null;
  rs_60: number | null;
  sector_rs_20: number | null;
  atr_14: number | null;
  atr_pct: number | null;
  average_traded_value_20: number | null;
  volume_ratio_20: number | null;
  distance_52_week_high: number | null;
  history_days: number;
  sector_rs_available: boolean;
  quality_flags: string[];
  factor_explanation: Record<string, string>;
  row_hash: string;
};

export async function runtimeEnv(): Promise<RuntimeEnv> {
  try {
    const cloudflare = await import("cloudflare:workers");
    return cloudflare.env as unknown as RuntimeEnv;
  } catch {
    return {};
  }
}

export async function requiredDatabase(): Promise<D1Database> {
  const db = (await runtimeEnv()).DB;
  if (!db) throw new Error("D1 binding unavailable");
  return db;
}

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
}

export async function sha256Hex(value: string): Promise<string> {
  return [...(await digest(value))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function authorized(request: Request): Promise<boolean> {
  const expected = (await runtimeEnv()).INGEST_TOKEN;
  if (!expected || expected.length < 24) return false;
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const supplied = bearer ?? request.headers.get("x-ingest-token") ?? "";
  const [left, right] = await Promise.all([digest(expected), digest(supplied)]);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

export async function readJson<T>(request: Request): Promise<T> {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > 900_000) throw new Error("request_too_large");
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > 900_000) {
    throw new Error("request_too_large");
  }
  return JSON.parse(text) as T;
}

export async function minimumUniverse(): Promise<number> {
  const configured = Number((await runtimeEnv()).MIN_VALID_UNIVERSE ?? "900");
  return Number.isInteger(configured) && configured >= 100 ? configured : 900;
}

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) && timestamp <= Date.now() + 86_400_000;
}

export function isFreshMarketDate(value: string, maximumAgeDays = 7): boolean {
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  const ageDays = (Date.now() - timestamp) / 86_400_000;
  return Number.isFinite(ageDays) && ageDays >= -1 && ageDays <= maximumAgeDays;
}

export function isHash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

export function canonicalScore(row: ScorePayload): string {
  return canonicalScoreShared(row as unknown as Record<string, unknown>);
}

export async function validateScore(row: ScorePayload): Promise<string | null> {
  if (!/^[A-Z0-9.-]{1,20}$/.test(row.symbol.trim().toUpperCase())) {
    return "invalid_symbol";
  }
  if (!row.name?.trim() || !row.sector?.trim()) return "missing_identity";
  const scores = [
    row.quant_score,
    row.trend_score,
    row.momentum_score,
    row.relative_strength_score,
    row.volume_score,
    row.volatility_score,
    row.liquidity_score,
    row.price_structure_score,
    row.trending_score,
    row.momentum_strategy_score,
    row.meta_score,
    row.strategy_ensemble_score,
  ];
  if (scores.some((value) => !Number.isFinite(value) || value < 0 || value > 100)) {
    return "score_out_of_range";
  }
  if (!Number.isFinite(row.close) || row.close <= 0) return "invalid_close";
  if (!Number.isInteger(row.rank) || row.rank < 1) return "invalid_rank";
  if (!Number.isInteger(row.history_days) || row.history_days < 120) {
    return "insufficient_history";
  }
  const optionalNumbers = [
    row.return_20,
    row.return_60,
    row.rs_20,
    row.rs_60,
    row.sector_rs_20,
    row.atr_14,
    row.atr_pct,
    row.average_traded_value_20,
    row.volume_ratio_20,
    row.distance_52_week_high,
  ];
  if (optionalNumbers.some((value) => value !== null && !Number.isFinite(value))) {
    return "non_finite_diagnostic";
  }
  if (!Array.isArray(row.quality_flags) || row.quality_flags.length > 20) {
    return "invalid_quality_flags";
  }
  if (!isHash(row.row_hash)) return "invalid_row_hash";
  return (await sha256Hex(canonicalScore(row))) === row.row_hash
    ? null
    : "row_hash_mismatch";
}

export function errorResponse(error: string, status = 400): Response {
  return Response.json({ ok: false, error }, { status });
}
