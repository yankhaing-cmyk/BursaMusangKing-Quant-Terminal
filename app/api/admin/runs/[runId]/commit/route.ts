import {
  authorized,
  errorResponse,
  requiredDatabase,
  sha256Hex,
} from "@/app/lib/ingest";
import { validateRegime, type RegimePayload } from "@/app/lib/regime-ingest";
import {
  validateTradeEvent,
  validateTradeState,
  type TradeEventPayload,
  type TradeStatePayload,
} from "@/app/lib/trade-ingest";
import {
  validatePortfolioAllocation,
  validatePortfolioSummary,
  type PortfolioAllocationPayload,
  type PortfolioSummaryPayload,
} from "@/app/lib/portfolio-ingest";

export async function POST(
  request: Request,
  context: { params: Promise<{ runId: string }> },
) {
  if (!(await authorized(request))) return errorResponse("unauthorized", 401);
  try {
    const { runId } = await context.params;
    const db = await requiredDatabase();
    const run = await db
      .prepare("SELECT * FROM quant_runs WHERE id = ? LIMIT 1")
      .bind(runId)
      .first<Record<string, unknown>>();
    if (!run) return errorResponse("run_not_found", 404);
    if (run.status === "ACTIVE") {
      return Response.json({ ok: true, status: "already_active", run_id: runId });
    }
    if (run.status !== "PENDING") return errorResponse("run_not_pending", 409);

    const regimeRow = await db
      .prepare("SELECT * FROM market_regimes WHERE run_id = ? LIMIT 1")
      .bind(runId)
      .first<Record<string, unknown>>();
    let regimeError = "missing_market_regime";
    if (regimeRow) {
      try {
        regimeError =
          (await validateRegime({
            ...regimeRow,
            explanation: JSON.parse(String(regimeRow.explanation_json)),
          } as unknown as RegimePayload)) ?? "";
      } catch {
        regimeError = "invalid_regime_explanation_json";
      }
    }

    const critical = await db
      .prepare(
        "SELECT COUNT(*) AS count FROM data_issues WHERE run_id = ? AND severity = 'CRITICAL'",
      )
      .bind(runId)
      .first<{ count: number }>();
    const hashes = await db
      .prepare(
        "SELECT symbol, row_hash FROM daily_scores WHERE run_id = ? ORDER BY symbol ASC",
      )
      .bind(runId)
      .all<{ symbol: string; row_hash: string }>();
    const expected = Number(run.expected_symbols);
    const received = hashes.results.length;
    const computedHash = await sha256Hex(
      hashes.results.map((row) => `${row.symbol}:${row.row_hash}`).join("\n"),
    );
    const tradePublication = await db
      .prepare("SELECT * FROM trade_publications WHERE run_id = ? LIMIT 1")
      .bind(runId)
      .first<Record<string, unknown>>();
    const tradeStates = await db
      .prepare("SELECT * FROM trade_state_snapshots WHERE run_id = ? ORDER BY symbol")
      .bind(runId)
      .all<Record<string, unknown>>();
    const tradeEvents = await db
      .prepare("SELECT * FROM trade_events WHERE run_id = ? ORDER BY event_id")
      .bind(runId)
      .all<Record<string, unknown>>();
    let tradeValidationError = tradePublication ? "" : "missing_trade_publication";
    if (tradePublication) {
      if (tradePublication.status !== "PENDING") tradeValidationError = "trade_publication_not_pending";
      for (const row of tradeStates.results) {
        tradeValidationError = (await validateTradeState(row as unknown as TradeStatePayload)) ?? "";
        if (tradeValidationError) break;
      }
      if (!tradeValidationError) {
        for (const row of tradeEvents.results) {
          tradeValidationError = (await validateTradeEvent(row as unknown as TradeEventPayload)) ?? "";
          if (tradeValidationError) break;
        }
      }
    }
    const computedTradeStateHash = await sha256Hex(
      tradeStates.results.map((row) => `${row.symbol}:${row.row_hash}`).join("\n"),
    );
    const computedTradeEventHash = await sha256Hex(
      tradeEvents.results.map((row) => `${row.event_id}:${row.row_hash}`).join("\n"),
    );
    const portfolioPublication = await db
      .prepare("SELECT * FROM portfolio_publications WHERE run_id = ? LIMIT 1")
      .bind(runId)
      .first<Record<string, unknown>>();
    const portfolioAllocations = await db
      .prepare("SELECT * FROM portfolio_allocations WHERE run_id = ? ORDER BY symbol")
      .bind(runId)
      .all<Record<string, unknown>>();
    let portfolioValidationError = portfolioPublication ? "" : "missing_portfolio_publication";
    if (portfolioPublication) {
      if (portfolioPublication.status !== "PENDING") portfolioValidationError = "portfolio_publication_not_pending";
      if (!portfolioValidationError && Number(portfolioPublication.summary_received) !== 1) {
        portfolioValidationError = "portfolio_summary_missing";
      }
      if (!portfolioValidationError) {
        portfolioValidationError = (await validatePortfolioSummary({
          ...portfolioPublication,
          market_date: run.market_date,
          automatic_execution: Number(portfolioPublication.automatic_execution) !== 0,
          row_hash: portfolioPublication.summary_hash,
        } as unknown as PortfolioSummaryPayload)) ?? "";
      }
      if (!portfolioValidationError) {
        for (const row of portfolioAllocations.results) {
          portfolioValidationError = (await validatePortfolioAllocation(row as unknown as PortfolioAllocationPayload)) ?? "";
          if (portfolioValidationError) break;
        }
      }
    }
    const computedPortfolioHash = await sha256Hex(
      portfolioAllocations.results.map((row) => `${row.symbol}:${row.row_hash}`).join("\n"),
    );
    const sectorExposure: Record<string, number> = {};
    for (const row of portfolioAllocations.results) {
      const sector = String(row.sector);
      sectorExposure[sector] = (sectorExposure[sector] ?? 0) + Number(row.target_weight);
    }
    const computedSectorJson = JSON.stringify(
      Object.fromEntries(Object.entries(sectorExposure).sort(([left], [right]) => left.localeCompare(right)).map(([sector, value]) => [sector, Number(value.toFixed(8))])),
    );
    const invalid =
      Number(critical?.count ?? 0) > 0 ||
      Boolean(regimeError) ||
      Boolean(tradeValidationError) ||
      Boolean(portfolioValidationError) ||
      String(regimeRow?.market_date ?? "") !== String(run.market_date) ||
      received !== expected ||
      computedHash !== String(run.payload_hash) ||
      tradeStates.results.length !== Number(tradePublication?.expected_states ?? -1) ||
      tradeEvents.results.length !== Number(tradePublication?.expected_events ?? -1) ||
      computedTradeStateHash !== String(tradePublication?.state_payload_hash ?? "") ||
      computedTradeEventHash !== String(tradePublication?.event_payload_hash ?? "") ||
      Number(tradePublication?.automatic_execution ?? 1) !== 0 ||
      portfolioAllocations.results.length !== Number(portfolioPublication?.expected_allocations ?? -1) ||
      computedPortfolioHash !== String(portfolioPublication?.allocation_payload_hash ?? "") ||
      computedSectorJson !== String(portfolioPublication?.sector_exposure_json ?? "") ||
      Number(portfolioPublication?.position_count ?? -1) !== portfolioAllocations.results.length ||
      Number(portfolioPublication?.automatic_execution ?? 1) !== 0 ||
      String(run.market_date) !== String(run.benchmark_date);
    if (invalid) {
      await db.batch([
        db
          .prepare("UPDATE quant_runs SET status = 'REJECTED', received_symbols = ? WHERE id = ?")
          .bind(received, runId),
        db
          .prepare("UPDATE trade_publications SET status = 'REJECTED', received_states = ?, received_events = ? WHERE run_id = ?")
          .bind(tradeStates.results.length, tradeEvents.results.length, runId),
        db
          .prepare("UPDATE portfolio_publications SET status = 'REJECTED', received_allocations = ? WHERE run_id = ?")
          .bind(portfolioAllocations.results.length, runId),
      ]);
      return errorResponse("commit_validation_failed_previous_run_preserved", 422);
    }

    const conflict = await db
      .prepare(
        `SELECT id FROM quant_runs
         WHERE market_date = ? AND status = 'ACTIVE' AND payload_hash <> ? LIMIT 1`,
      )
      .bind(run.market_date, run.payload_hash)
      .first<{ id: string }>();
    if (conflict) return errorResponse("conflicting_active_payload_for_market_date", 409);

    const committedAt = new Date().toISOString();
    await db.batch([
      db
        .prepare(
          `UPDATE quant_runs
           SET status = 'ACTIVE', received_symbols = ?, committed_at = ?
           WHERE id = ? AND status = 'PENDING'
             AND NOT EXISTS (
               SELECT 1 FROM quant_runs active
               WHERE active.status = 'ACTIVE'
                 AND active.market_date >= quant_runs.market_date
             )`,
        )
        .bind(received, committedAt, runId),
      db
        .prepare(
          `UPDATE trade_publications
           SET status = 'ACTIVE', received_states = ?, received_events = ?, committed_at = ?
           WHERE run_id = ? AND status = 'PENDING'
             AND EXISTS (
               SELECT 1 FROM quant_runs promoted
               WHERE promoted.id = trade_publications.run_id
                 AND promoted.status = 'ACTIVE'
             )`,
        )
        .bind(tradeStates.results.length, tradeEvents.results.length, committedAt, runId),
      db
        .prepare(
          `UPDATE portfolio_publications
           SET status = 'ACTIVE', received_allocations = ?, committed_at = ?
           WHERE run_id = ? AND status = 'PENDING'
             AND EXISTS (
               SELECT 1 FROM quant_runs promoted
               WHERE promoted.id = portfolio_publications.run_id
                 AND promoted.status = 'ACTIVE'
             )`,
        )
        .bind(portfolioAllocations.results.length, committedAt, runId),
      db
        .prepare(
          `UPDATE quant_runs
           SET status = 'SUPERSEDED'
           WHERE status = 'ACTIVE' AND id <> ?
             AND market_date < (
               SELECT market_date FROM quant_runs promoted
               WHERE promoted.id = ? AND promoted.status = 'ACTIVE'
             )`,
        )
        .bind(runId, runId),
      db
        .prepare(
          `INSERT INTO app_state (key, value, updated_at)
           SELECT 'active_run_id', id, ? FROM quant_runs
           WHERE id = ? AND status = 'ACTIVE'
             AND NOT EXISTS (
               SELECT 1 FROM quant_runs newer
               WHERE newer.status = 'ACTIVE'
                 AND newer.market_date > quant_runs.market_date
             )
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        )
        .bind(committedAt, runId),
    ]);
    const promoted = await db
      .prepare(
        `SELECT qr.status, state.value AS active_run_id,
                trades.status AS trade_status,
                portfolio.status AS portfolio_status
         FROM quant_runs qr
         LEFT JOIN app_state state ON state.key = 'active_run_id'
         LEFT JOIN trade_publications trades ON trades.run_id = qr.id
         LEFT JOIN portfolio_publications portfolio ON portfolio.run_id = qr.id
         WHERE qr.id = ? LIMIT 1`,
      )
      .bind(runId)
      .first<{ status: string; active_run_id: string | null; trade_status: string | null; portfolio_status: string | null }>();
    if (
      promoted?.status !== "ACTIVE" || promoted.active_run_id !== runId ||
      promoted.trade_status !== "ACTIVE" || promoted.portfolio_status !== "ACTIVE"
    ) {
      return errorResponse("newer_or_conflicting_run_already_active", 409);
    }
    return Response.json({
      ok: true,
      status: "active",
      run_id: runId,
      market_date: run.market_date,
      received_symbols: received,
      payload_hash: computedHash,
      trade_states: tradeStates.results.length,
      trade_events: tradeEvents.results.length,
      portfolio_allocations: portfolioAllocations.results.length,
    });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "invalid_request");
  }
}
