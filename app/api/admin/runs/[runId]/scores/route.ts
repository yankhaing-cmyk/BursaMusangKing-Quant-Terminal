import {
  authorized,
  errorResponse,
  type InstrumentPayload,
  readJson,
  requiredDatabase,
  type ScorePayload,
  validateScore,
} from "@/app/lib/ingest";

type BatchPayload = {
  instruments: InstrumentPayload[];
  scores: ScorePayload[];
};

export async function POST(
  request: Request,
  context: { params: Promise<{ runId: string }> },
) {
  if (!(await authorized(request))) return errorResponse("unauthorized", 401);
  try {
    const { runId } = await context.params;
    const body = await readJson<BatchPayload>(request);
    if (
      !Array.isArray(body.instruments) ||
      !Array.isArray(body.scores) ||
      body.scores.length < 1 ||
      body.scores.length > 40 ||
      body.instruments.length !== body.scores.length
    ) {
      return errorResponse("invalid_batch_size");
    }
    const symbols = body.scores.map((row) => row.symbol.trim().toUpperCase());
    if (new Set(symbols).size !== symbols.length) {
      return errorResponse("duplicate_symbol_in_batch", 422);
    }
    const instrumentBySymbol = new Map(
      body.instruments.map((item) => [item.symbol.trim().toUpperCase(), item]),
    );
    if (instrumentBySymbol.size !== symbols.length) {
      return errorResponse("instrument_score_mismatch", 422);
    }
    for (const row of body.scores) {
      const validationError = await validateScore(row);
      if (validationError) {
        return errorResponse(`${validationError}:${row.symbol}`, 422);
      }
      const instrument = instrumentBySymbol.get(row.symbol.trim().toUpperCase());
      if (
        !instrument ||
        instrument.name.trim() !== row.name.trim() ||
        instrument.sector.trim() !== row.sector.trim()
      ) {
        return errorResponse(`instrument_identity_mismatch:${row.symbol}`, 422);
      }
    }

    const db = await requiredDatabase();
    const run = await db
      .prepare(
        "SELECT status, expected_symbols, market_date FROM quant_runs WHERE id = ? LIMIT 1",
      )
      .bind(runId)
      .first<{ status: string; expected_symbols: number; market_date: string }>();
    if (!run) return errorResponse("run_not_found", 404);
    if (run.status !== "PENDING") return errorResponse("run_not_pending", 409);
    if (body.scores.some((row) => row.rank > Number(run.expected_symbols))) {
      return errorResponse("rank_exceeds_expected_universe", 422);
    }
    if (
      body.instruments.some(
        (instrument) =>
          instrument.last_seen_date !== run.market_date ||
          instrument.active === false ||
          instrument.suspended === true ||
          !["EQUITY", "REIT", "ETF"].includes(
            (instrument.security_type ?? "EQUITY").toUpperCase(),
          ),
      )
    ) {
      return errorResponse("ineligible_or_wrong_date_instrument", 422);
    }

    const statements: D1PreparedStatement[] = [];
    for (const symbol of symbols) {
      const instrument = instrumentBySymbol.get(symbol)!;
      statements.push(
        db
          .prepare(
            `INSERT INTO instruments
             (symbol, name, sector, sector_benchmark, board, security_type,
              listing_date, delisting_date, active, suspended, source_id, last_seen_date)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(symbol) DO UPDATE SET
               name = excluded.name,
               sector = excluded.sector,
               sector_benchmark = excluded.sector_benchmark,
               board = excluded.board,
               security_type = excluded.security_type,
               listing_date = excluded.listing_date,
               delisting_date = excluded.delisting_date,
               active = excluded.active,
               suspended = excluded.suspended,
               source_id = excluded.source_id,
               last_seen_date = excluded.last_seen_date`,
          )
          .bind(
            symbol,
            instrument.name.trim(),
            instrument.sector.trim(),
            instrument.sector_benchmark ?? null,
            instrument.board ?? null,
            instrument.security_type ?? "EQUITY",
            instrument.listing_date ?? null,
            instrument.delisting_date ?? null,
            instrument.active === false ? 0 : 1,
            instrument.suspended ? 1 : 0,
            instrument.source_id ?? null,
            instrument.last_seen_date,
          ),
      );
    }
    for (const row of body.scores) {
      statements.push(
        db
          .prepare(
            `INSERT INTO daily_scores
             (run_id, symbol, name, sector, close, rank, quant_score, trend_score,
              momentum_score, relative_strength_score, volume_score,
              volatility_score, liquidity_score, price_structure_score,
              trending_score, momentum_strategy_score, meta_score,
              strategy_ensemble_score, return_20, return_60, rs_20, rs_60,
              sector_rs_20, atr_14, atr_pct, average_traded_value_20,
              volume_ratio_20, distance_52_week_high, history_days,
              sector_rs_available, quality_flags_json, factor_explanation_json,
              row_hash)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                     ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(run_id, symbol) DO UPDATE SET
              name=excluded.name, sector=excluded.sector, close=excluded.close,
              rank=excluded.rank, quant_score=excluded.quant_score,
              trend_score=excluded.trend_score,
              momentum_score=excluded.momentum_score,
              relative_strength_score=excluded.relative_strength_score,
              volume_score=excluded.volume_score,
              volatility_score=excluded.volatility_score,
              liquidity_score=excluded.liquidity_score,
              price_structure_score=excluded.price_structure_score,
              trending_score=excluded.trending_score,
              momentum_strategy_score=excluded.momentum_strategy_score,
              meta_score=excluded.meta_score,
              strategy_ensemble_score=excluded.strategy_ensemble_score,
              return_20=excluded.return_20, return_60=excluded.return_60,
              rs_20=excluded.rs_20, rs_60=excluded.rs_60,
              sector_rs_20=excluded.sector_rs_20, atr_14=excluded.atr_14,
              atr_pct=excluded.atr_pct,
              average_traded_value_20=excluded.average_traded_value_20,
              volume_ratio_20=excluded.volume_ratio_20,
              distance_52_week_high=excluded.distance_52_week_high,
              history_days=excluded.history_days,
              sector_rs_available=excluded.sector_rs_available,
              quality_flags_json=excluded.quality_flags_json,
              factor_explanation_json=excluded.factor_explanation_json,
              row_hash=excluded.row_hash`,
          )
          .bind(
            runId,
            row.symbol.trim().toUpperCase(),
            row.name.trim(),
            row.sector.trim(),
            row.close,
            row.rank,
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
            row.history_days,
            row.sector_rs_available ? 1 : 0,
            JSON.stringify([...row.quality_flags].sort()),
            JSON.stringify(row.factor_explanation),
            row.row_hash,
          ),
      );
    }
    await db.batch(statements);
    const count = await db
      .prepare("SELECT COUNT(*) AS count FROM daily_scores WHERE run_id = ?")
      .bind(runId)
      .first<{ count: number }>();
    await db
      .prepare("UPDATE quant_runs SET received_symbols = ? WHERE id = ?")
      .bind(Number(count?.count ?? 0), runId)
      .run();
    return Response.json({
      ok: true,
      accepted: body.scores.length,
      received_symbols: Number(count?.count ?? 0),
    });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "invalid_request");
  }
}
