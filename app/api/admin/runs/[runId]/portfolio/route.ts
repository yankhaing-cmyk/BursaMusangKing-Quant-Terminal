import {
  authorized,
  errorResponse,
  readJson,
  requiredDatabase,
} from "@/app/lib/ingest";
import {
  validatePortfolioAllocation,
  validatePortfolioSummary,
  type PortfolioAllocationPayload,
  type PortfolioSummaryPayload,
} from "@/app/lib/portfolio-ingest";

type BatchPayload = {
  summary?: PortfolioSummaryPayload | null;
  allocations?: PortfolioAllocationPayload[];
};

function closeEnough(left: number, right: number): boolean {
  return Math.abs(left - right) <= 1e-6;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ runId: string }> },
) {
  if (!(await authorized(request))) return errorResponse("unauthorized", 401);
  try {
    const { runId } = await context.params;
    const body = await readJson<BatchPayload>(request);
    const summary = body.summary ?? null;
    const allocations = body.allocations ?? [];
    if (!Array.isArray(allocations) || allocations.length > 40 || (!summary && allocations.length < 1)) {
      return errorResponse("invalid_portfolio_batch_size");
    }
    if (new Set(allocations.map((row) => row.symbol.trim().toUpperCase())).size !== allocations.length) {
      return errorResponse("duplicate_portfolio_allocation", 422);
    }
    if (summary) {
      if (summary.run_id !== runId) return errorResponse("portfolio_summary_run_mismatch", 422);
      const error = await validatePortfolioSummary(summary);
      if (error) return errorResponse(error, 422);
    }
    for (const row of allocations) {
      if (row.run_id !== runId) return errorResponse("portfolio_allocation_run_mismatch", 422);
      const error = await validatePortfolioAllocation(row);
      if (error) return errorResponse(`${error}:${row.symbol}`, 422);
    }

    const db = await requiredDatabase();
    const publication = await db
      .prepare(
        `SELECT pp.*, qr.market_date, mr.regime_label, mr.max_equity_exposure,
                mr.minimum_cash_allocation
         FROM portfolio_publications pp
         JOIN quant_runs qr ON qr.id = pp.run_id
         JOIN market_regimes mr ON mr.run_id = pp.run_id
         WHERE pp.run_id = ? LIMIT 1`,
      )
      .bind(runId)
      .first<Record<string, unknown>>();
    if (!publication) return errorResponse("portfolio_publication_not_found", 404);
    if (publication.status !== "PENDING") return errorResponse("portfolio_publication_not_pending", 409);

    if (summary) {
      if (
        summary.market_date !== publication.market_date ||
        summary.regime_label !== publication.regime_label ||
        summary.row_hash !== publication.summary_hash ||
        summary.position_count !== Number(publication.expected_allocations) ||
        !closeEnough(summary.max_equity_exposure, Number(publication.max_equity_exposure)) ||
        !closeEnough(summary.minimum_cash_allocation, Number(publication.minimum_cash_allocation)) ||
        !closeEnough(summary.position_cap, Number(publication.position_cap)) ||
        !closeEnough(summary.sector_cap, Number(publication.sector_cap)) ||
        !closeEnough(summary.correlation_threshold, Number(publication.correlation_threshold))
      ) {
        return errorResponse("portfolio_summary_anchor_mismatch", 422);
      }
      if (Number(publication.summary_received) === 1) {
        const fields = [
          [publication.capital_deployed, summary.capital_deployed],
          [publication.cash_allocation, summary.cash_allocation],
          [publication.portfolio_risk, summary.portfolio_risk],
        ];
        if (fields.some(([stored, incoming]) => !closeEnough(Number(stored), Number(incoming)))) {
          return errorResponse("conflicting_immutable_portfolio_summary", 409);
        }
      } else {
        await db
          .prepare(
            `UPDATE portfolio_publications SET
              summary_received = 1, regime_label = ?, max_equity_exposure = ?,
              minimum_cash_allocation = ?, max_portfolio_risk = ?,
              position_count = ?, capital_deployed = ?, cash_allocation = ?,
              portfolio_risk = ?, largest_position = ?, top5_concentration = ?,
              portfolio_quant_score = ?, portfolio_beta = ?, expected_volatility = ?,
              sector_exposure_json = ?, correlation_clusters_json = ?
             WHERE run_id = ? AND status = 'PENDING' AND summary_received = 0`,
          )
          .bind(
            summary.regime_label, summary.max_equity_exposure,
            summary.minimum_cash_allocation, summary.max_portfolio_risk,
            summary.position_count, summary.capital_deployed,
            summary.cash_allocation, summary.portfolio_risk,
            summary.largest_position, summary.top5_concentration,
            summary.portfolio_quant_score, summary.portfolio_beta,
            summary.expected_volatility, summary.sector_exposure_json,
            summary.correlation_clusters_json, runId,
          )
          .run();
      }
    }

    if (allocations.length) {
      const symbols = allocations.map((row) => row.symbol);
      const anchors = await db
        .prepare(
          `SELECT score.symbol, score.quant_score, score.close, score.atr_pct,
                  score.average_traded_value_20, score.sector,
                  trade.trade_id, trade.state, trade.last_close
           FROM daily_scores score
           JOIN trade_state_snapshots trade
             ON trade.run_id = score.run_id AND trade.symbol = score.symbol
           WHERE score.run_id = ? AND score.symbol IN (${symbols.map(() => "?").join(",")})`,
        )
        .bind(runId, ...symbols)
        .all<Record<string, unknown>>();
      const anchorMap = new Map(anchors.results.map((row) => [String(row.symbol), row]));
      for (const row of allocations) {
        const anchor = anchorMap.get(row.symbol);
        if (
          !anchor || row.market_date !== publication.market_date ||
          row.trade_id !== anchor.trade_id || row.trade_state !== anchor.state ||
          row.sector !== anchor.sector ||
          !closeEnough(row.quant_score, Number(anchor.quant_score)) ||
          !closeEnough(row.last_close, Number(anchor.last_close)) ||
          !closeEnough(row.atr_pct, Number(anchor.atr_pct)) ||
          !closeEnough(row.average_traded_value_20, Number(anchor.average_traded_value_20))
        ) {
          return errorResponse(`portfolio_allocation_anchor_mismatch:${row.symbol}`, 422);
        }
      }

      const existing = await db
        .prepare(
          `SELECT symbol, row_hash FROM portfolio_allocations
           WHERE run_id = ? AND symbol IN (${symbols.map(() => "?").join(",")})`,
        )
        .bind(runId, ...symbols)
        .all<{ symbol: string; row_hash: string }>();
      const hashes = new Map(existing.results.map((row) => [row.symbol, row.row_hash]));
      for (const row of allocations) {
        const prior = hashes.get(row.symbol);
        if (prior && prior !== row.row_hash) return errorResponse(`conflicting_immutable_portfolio_allocation:${row.symbol}`, 409);
      }
      const createdAt = new Date().toISOString();
      const fresh = allocations.filter((row) => !hashes.has(row.symbol));
      if (fresh.length) await db.batch(
        fresh.map((row) => db.prepare(
          `INSERT INTO portfolio_allocations
           (run_id, market_date, methodology_version, symbol, trade_id,
            trade_state, sector, quant_score, last_close, atr_pct,
            stop_distance_pct, average_traded_value_20, score_multiplier,
            volatility_multiplier, liquidity_multiplier, correlation_multiplier,
            target_weight, risk_budget, risk_contribution,
            volatility_contribution, beta, correlation_cluster,
            sector_cap_applied, flags_json, row_hash, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                   ?, ?, ?, ?, ?, ?)`,
        ).bind(
          row.run_id, row.market_date, row.methodology_version, row.symbol,
          row.trade_id, row.trade_state, row.sector, row.quant_score,
          row.last_close, row.atr_pct, row.stop_distance_pct,
          row.average_traded_value_20, row.score_multiplier,
          row.volatility_multiplier, row.liquidity_multiplier,
          row.correlation_multiplier, row.target_weight, row.risk_budget,
          row.risk_contribution, row.volatility_contribution, row.beta,
          row.correlation_cluster, row.sector_cap_applied ? 1 : 0,
          row.flags_json, row.row_hash, createdAt,
        )),
      );
    }

    const count = await db
      .prepare("SELECT COUNT(*) AS count FROM portfolio_allocations WHERE run_id = ?")
      .bind(runId)
      .first<{ count: number }>();
    await db
      .prepare("UPDATE portfolio_publications SET received_allocations = ? WHERE run_id = ?")
      .bind(Number(count?.count ?? 0), runId)
      .run();
    return Response.json({
      ok: true,
      accepted_allocations: allocations.length,
      summary_received: Boolean(summary),
      received_allocations: Number(count?.count ?? 0),
    });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "invalid_request");
  }
}
