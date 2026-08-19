import {
  authorized,
  errorResponse,
  isHash,
  isFreshMarketDate,
  isIsoDate,
  minimumUniverse,
  readJson,
  requiredDatabase,
} from "@/app/lib/ingest";
import { validateRegime, type RegimePayload } from "@/app/lib/regime-ingest";

type StartPayload = {
  run_id: string;
  market_date: string;
  provider: string;
  model_version: string;
  payload_hash: string;
  expected_symbols: number;
  valid_symbols: number;
  total_instruments: number;
  benchmark_date: string;
  validation: { critical_count: number; warning_count: number; checks: unknown[] };
  issues?: Array<{
    severity: "WARNING" | "CRITICAL";
    code: string;
    symbol?: string | null;
    field?: string | null;
    detail: string;
  }>;
  regime: RegimePayload;
};

export async function POST(request: Request) {
  if (!(await authorized(request))) return errorResponse("unauthorized", 401);
  try {
    const body = await readJson<StartPayload>(request);
    const minimum = await minimumUniverse();
    if (!/^[A-Za-z0-9._:-]{8,100}$/.test(body.run_id ?? "")) {
      return errorResponse("invalid_run_id");
    }
    if (!isIsoDate(body.market_date) || !isIsoDate(body.benchmark_date)) {
      return errorResponse("invalid_market_date");
    }
    if (!isFreshMarketDate(body.market_date)) {
      return errorResponse("stale_market_date", 422);
    }
    if (body.market_date !== body.benchmark_date) {
      return errorResponse("benchmark_date_mismatch", 422);
    }
    if (body.model_version !== "quant-v1.0.0") {
      return errorResponse("unsupported_model_version", 422);
    }
    if (!isHash(body.payload_hash)) return errorResponse("invalid_payload_hash");
    if (
      !Number.isInteger(body.expected_symbols) ||
      body.expected_symbols < minimum ||
      body.valid_symbols !== body.expected_symbols ||
      body.total_instruments < body.valid_symbols
    ) {
      return errorResponse("universe_below_minimum_or_inconsistent", 422);
    }
    if (!body.provider?.trim() || body.provider.length > 120) {
      return errorResponse("invalid_provider");
    }
    if (body.validation?.critical_count !== 0) {
      return errorResponse("critical_validation_issue", 422);
    }
    if (
      !body.regime ||
      body.regime.run_id !== body.run_id ||
      body.regime.market_date !== body.market_date
    ) {
      return errorResponse("regime_run_or_date_mismatch", 422);
    }
    const regimeError = await validateRegime(body.regime);
    if (regimeError) return errorResponse(regimeError, 422);
    const issues = body.issues ?? [];
    if (issues.length > 100 || issues.some((issue) => issue.severity === "CRITICAL")) {
      return errorResponse("critical_or_excessive_issues", 422);
    }

    const db = await requiredDatabase();
    const latestActive = await db
      .prepare(
        "SELECT id, market_date, payload_hash FROM quant_runs WHERE status = 'ACTIVE' ORDER BY market_date DESC LIMIT 1",
      )
      .first<{ id: string; market_date: string; payload_hash: string }>();
    if (latestActive && body.market_date < latestActive.market_date) {
      return errorResponse("market_date_older_than_active_run", 409);
    }
    if (latestActive?.market_date === body.market_date) {
      if (latestActive.payload_hash === body.payload_hash) {
        const activeRegime = await db
          .prepare("SELECT row_hash FROM market_regimes WHERE run_id = ? LIMIT 1")
          .bind(latestActive.id)
          .first<{ row_hash: string }>();
        if (activeRegime?.row_hash !== body.regime.row_hash) {
          return errorResponse("active_run_missing_or_conflicting_regime", 409);
        }
        return Response.json({
          ok: true,
          status: "already_active",
          run_id: latestActive.id,
        });
      }
      return errorResponse("conflicting_active_payload_for_market_date", 409);
    }

    await db
      .prepare(
        `INSERT INTO quant_runs
         (id, market_date, status, provider, model_version, payload_hash,
          expected_symbols, received_symbols, valid_symbols, total_instruments,
          benchmark_date, validation_json, started_at)
         VALUES (?, ?, 'PENDING', ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO NOTHING`,
      )
      .bind(
        body.run_id,
        body.market_date,
        body.provider.trim(),
        body.model_version,
        body.payload_hash,
        body.expected_symbols,
        body.valid_symbols,
        body.total_instruments,
        body.benchmark_date,
        JSON.stringify(body.validation),
        new Date().toISOString(),
      )
      .run();

    await db
      .prepare(
        `INSERT INTO market_regimes
         (run_id, market_date, methodology_version, regime_label, regime_score,
          benchmark_close, benchmark_sma50, benchmark_sma200,
          benchmark_sma50_slope20, benchmark_sma200_slope20,
          benchmark_return20, benchmark_realized_volatility20,
          breadth_above20, breadth_above50, breadth_above200, breadth_momentum,
          new_high_rate, new_low_rate, volume_participation_rate,
          sector_positive_rate, benchmark_trend_score, breadth_score,
          sector_breadth_score, participation_score, volatility_score,
          minimum_quant_score, max_equity_exposure,
          new_position_size_multiplier, minimum_cash_allocation,
          max_new_entries, trend_weight_multiplier, explanation_json,
          row_hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                 ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(run_id) DO NOTHING`,
      )
      .bind(
        body.regime.run_id,
        body.regime.market_date,
        body.regime.methodology_version,
        body.regime.regime_label,
        body.regime.regime_score,
        body.regime.benchmark_close,
        body.regime.benchmark_sma50,
        body.regime.benchmark_sma200,
        body.regime.benchmark_sma50_slope20,
        body.regime.benchmark_sma200_slope20,
        body.regime.benchmark_return20,
        body.regime.benchmark_realized_volatility20,
        body.regime.breadth_above20,
        body.regime.breadth_above50,
        body.regime.breadth_above200,
        body.regime.breadth_momentum,
        body.regime.new_high_rate,
        body.regime.new_low_rate,
        body.regime.volume_participation_rate,
        body.regime.sector_positive_rate,
        body.regime.benchmark_trend_score,
        body.regime.breadth_score,
        body.regime.sector_breadth_score,
        body.regime.participation_score,
        body.regime.volatility_score,
        body.regime.minimum_quant_score,
        body.regime.max_equity_exposure,
        body.regime.new_position_size_multiplier,
        body.regime.minimum_cash_allocation,
        body.regime.max_new_entries,
        body.regime.trend_weight_multiplier,
        JSON.stringify(body.regime.explanation),
        body.regime.row_hash,
        new Date().toISOString(),
      )
      .run();

    const stored = await db
      .prepare("SELECT * FROM quant_runs WHERE id = ? LIMIT 1")
      .bind(body.run_id)
      .first<Record<string, unknown>>();
    if (
      !stored ||
      stored.payload_hash !== body.payload_hash ||
      stored.market_date !== body.market_date ||
      stored.status !== "PENDING"
    ) {
      return errorResponse("run_id_conflict", 409);
    }
    const storedRegime = await db
      .prepare("SELECT row_hash, market_date FROM market_regimes WHERE run_id = ? LIMIT 1")
      .bind(body.run_id)
      .first<{ row_hash: string; market_date: string }>();
    if (
      !storedRegime ||
      storedRegime.row_hash !== body.regime.row_hash ||
      storedRegime.market_date !== body.market_date
    ) {
      return errorResponse("regime_row_conflict", 409);
    }

    const issueStatements = [
      db.prepare("DELETE FROM data_issues WHERE run_id = ?").bind(body.run_id),
      ...issues.map((issue) =>
        db
          .prepare(
            `INSERT INTO data_issues
             (run_id, severity, code, symbol, field, detail)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            body.run_id,
            issue.severity,
            issue.code.slice(0, 80),
            issue.symbol ?? null,
            issue.field ?? null,
            issue.detail.slice(0, 500),
          ),
      ),
    ];
    await db.batch(issueStatements);
    return Response.json({ ok: true, status: "pending", run_id: body.run_id });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "invalid_request");
  }
}
