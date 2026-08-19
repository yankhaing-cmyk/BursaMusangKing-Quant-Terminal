import {
  authorized,
  errorResponse,
  readJson,
  requiredDatabase,
} from "@/app/lib/ingest";
import {
  validateTradeEvent,
  validateTradeState,
  type TradeEventPayload,
  type TradeStatePayload,
} from "@/app/lib/trade-ingest";

type BatchPayload = {
  states?: TradeStatePayload[];
  events?: TradeEventPayload[];
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
    const states = body.states ?? [];
    const events = body.events ?? [];
    if (
      !Array.isArray(states) || !Array.isArray(events) ||
      states.length + events.length < 1 || states.length + events.length > 40
    ) {
      return errorResponse("invalid_trade_batch_size");
    }
    if (new Set(states.map((row) => row.symbol.trim().toUpperCase())).size !== states.length) {
      return errorResponse("duplicate_trade_state", 422);
    }
    if (new Set(events.map((row) => row.event_id)).size !== events.length) {
      return errorResponse("duplicate_trade_event", 422);
    }
    for (const row of states) {
      if (row.run_id !== runId) return errorResponse("trade_state_run_mismatch", 422);
      const error = await validateTradeState(row);
      if (error) return errorResponse(`${error}:${row.symbol}`, 422);
    }
    for (const row of events) {
      if (row.run_id !== runId) return errorResponse("trade_event_run_mismatch", 422);
      const error = await validateTradeEvent(row);
      if (error) return errorResponse(`${error}:${row.symbol}`, 422);
    }

    const db = await requiredDatabase();
    const publication = await db
      .prepare(
        `SELECT tp.*, qr.market_date, mr.regime_label
         FROM trade_publications tp
         JOIN quant_runs qr ON qr.id = tp.run_id
         JOIN market_regimes mr ON mr.run_id = tp.run_id
         WHERE tp.run_id = ? LIMIT 1`,
      )
      .bind(runId)
      .first<Record<string, unknown>>();
    if (!publication) return errorResponse("trade_publication_not_found", 404);
    if (publication.status !== "PENDING") return errorResponse("trade_publication_not_pending", 409);

    const symbols = [...new Set([...states.map((row) => row.symbol), ...events.map((row) => row.symbol)])];
    const anchors = symbols.length
      ? await db
          .prepare(
            `SELECT symbol, quant_score, close FROM daily_scores
             WHERE run_id = ? AND symbol IN (${symbols.map(() => "?").join(",")})`,
          )
          .bind(runId, ...symbols)
          .all<{ symbol: string; quant_score: number; close: number }>()
      : { results: [] };
    const anchorMap = new Map(anchors.results.map((row) => [row.symbol, row]));
    for (const row of states) {
      const anchor = anchorMap.get(row.symbol);
      if (
        !anchor || row.market_date !== publication.market_date ||
        row.regime_label !== publication.regime_label ||
        !closeEnough(row.quant_score, Number(anchor.quant_score)) ||
        !closeEnough(row.last_close, Number(anchor.close))
      ) {
        return errorResponse(`trade_state_anchor_mismatch:${row.symbol}`, 422);
      }
    }
    for (const row of events) {
      const anchor = anchorMap.get(row.symbol);
      if (!anchor || row.market_date !== publication.market_date || !closeEnough(row.quant_score, Number(anchor.quant_score))) {
        return errorResponse(`trade_event_anchor_mismatch:${row.symbol}`, 422);
      }
    }

    if (states.length) {
      const existing = await db
        .prepare(
          `SELECT symbol, row_hash FROM trade_state_snapshots
           WHERE run_id = ? AND symbol IN (${states.map(() => "?").join(",")})`,
        )
        .bind(runId, ...states.map((row) => row.symbol))
        .all<{ symbol: string; row_hash: string }>();
      const hashes = new Map(existing.results.map((row) => [row.symbol, row.row_hash]));
      for (const row of states) {
        const prior = hashes.get(row.symbol);
        if (prior && prior !== row.row_hash) return errorResponse(`conflicting_immutable_trade_state:${row.symbol}`, 409);
      }
      const createdAt = new Date().toISOString();
      const newStates = states.filter((row) => !hashes.has(row.symbol));
      if (newStates.length) await db.batch(
        newStates.map((row) =>
          db.prepare(
            `INSERT INTO trade_state_snapshots
             (run_id, market_date, methodology_version, symbol, trade_id, state,
              signal_run_id, signal_date, signal_score_bucket, entry_date,
              exit_date, entry_price, exit_price, peak_close, last_close, atr14,
              trailing_stop, stop_distance_pct, unrealized_return, quant_score,
              signal_quant_score, signal_rank, regime_label, expected_edge_20d,
              edge_sample_size, edge_confidence, reason, row_hash, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                     ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).bind(
            row.run_id, row.market_date, row.methodology_version, row.symbol,
            row.trade_id, row.state, row.signal_run_id, row.signal_date,
            row.signal_score_bucket, row.entry_date, row.exit_date,
            row.entry_price, row.exit_price, row.peak_close, row.last_close,
            row.atr14, row.trailing_stop, row.stop_distance_pct,
            row.unrealized_return, row.quant_score, row.signal_quant_score,
            row.signal_rank, row.regime_label, row.expected_edge_20d,
            row.edge_sample_size, row.edge_confidence, row.reason,
            row.row_hash, createdAt,
          ),
        ),
      );
    }

    if (events.length) {
      const existing = await db
        .prepare(
          `SELECT event_id, row_hash FROM trade_events
           WHERE event_id IN (${events.map(() => "?").join(",")})`,
        )
        .bind(...events.map((row) => row.event_id))
        .all<{ event_id: string; row_hash: string }>();
      const hashes = new Map(existing.results.map((row) => [row.event_id, row.row_hash]));
      for (const row of events) {
        const prior = hashes.get(row.event_id);
        if (prior && prior !== row.row_hash) return errorResponse(`conflicting_immutable_trade_event:${row.symbol}`, 409);
      }
      const createdAt = new Date().toISOString();
      const newEvents = events.filter((row) => !hashes.has(row.event_id));
      if (newEvents.length) await db.batch(
        newEvents.map((row) =>
          db.prepare(
            `INSERT INTO trade_events
             (event_id, run_id, market_date, methodology_version, symbol,
              trade_id, event_type, prior_state, new_state, event_price,
              quant_score, trailing_stop, reason, row_hash, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).bind(
            row.event_id, row.run_id, row.market_date, row.methodology_version,
            row.symbol, row.trade_id, row.event_type, row.prior_state,
            row.new_state, row.event_price, row.quant_score,
            row.trailing_stop, row.reason, row.row_hash, createdAt,
          ),
        ),
      );
    }

    const [stateCount, eventCount] = await Promise.all([
      db.prepare("SELECT COUNT(*) AS count FROM trade_state_snapshots WHERE run_id = ?").bind(runId).first<{ count: number }>(),
      db.prepare("SELECT COUNT(*) AS count FROM trade_events WHERE run_id = ?").bind(runId).first<{ count: number }>(),
    ]);
    await db
      .prepare("UPDATE trade_publications SET received_states = ?, received_events = ? WHERE run_id = ?")
      .bind(Number(stateCount?.count ?? 0), Number(eventCount?.count ?? 0), runId)
      .run();
    return Response.json({
      ok: true,
      accepted_states: states.length,
      accepted_events: events.length,
      received_states: Number(stateCount?.count ?? 0),
      received_events: Number(eventCount?.count ?? 0),
    });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "invalid_request");
  }
}
