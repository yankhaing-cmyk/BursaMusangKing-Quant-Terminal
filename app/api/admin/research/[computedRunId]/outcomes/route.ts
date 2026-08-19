import {
  authorized,
  errorResponse,
  readJson,
  requiredDatabase,
} from "@/app/lib/ingest";
import {
  type ResearchOutcomePayload,
  scoreBucket,
  validateResearchOutcome,
} from "@/app/lib/research-ingest";

type BatchPayload = { outcomes: ResearchOutcomePayload[] };

export async function POST(
  request: Request,
  context: { params: Promise<{ computedRunId: string }> },
) {
  if (!(await authorized(request))) return errorResponse("unauthorized", 401);
  try {
    const { computedRunId } = await context.params;
    const body = await readJson<BatchPayload>(request);
    if (!Array.isArray(body.outcomes) || body.outcomes.length < 1 || body.outcomes.length > 40) {
      return errorResponse("invalid_research_batch_size");
    }
    const keys = body.outcomes.map((row) => `${row.signal_run_id}:${row.symbol.trim().toUpperCase()}:${row.horizon}`);
    if (new Set(keys).size !== keys.length) return errorResponse("duplicate_research_observation", 422);
    for (const row of body.outcomes) {
      if (row.computed_run_id !== computedRunId) return errorResponse("computed_run_id_mismatch", 422);
      const validationError = await validateResearchOutcome(row);
      if (validationError) return errorResponse(`${validationError}:${row.symbol}`, 422);
    }

    const db = await requiredDatabase();
    const publication = await db
      .prepare("SELECT status, methodology_version FROM research_publications WHERE computed_run_id = ? LIMIT 1")
      .bind(computedRunId)
      .first<{ status: string; methodology_version: string }>();
    if (!publication) return errorResponse("research_run_not_found", 404);
    if (publication.status !== "PENDING") return errorResponse("research_run_not_pending", 409);

    const anchorWhere = body.outcomes.map(() => "(ds.run_id = ? AND ds.symbol = ?)").join(" OR ");
    const anchorBindings = body.outcomes.flatMap((row) => [row.signal_run_id, row.symbol.trim().toUpperCase()]);
    const anchors = await db
      .prepare(
        `SELECT ds.run_id, ds.symbol, ds.quant_score, ds.close, qr.market_date, qr.status
         FROM daily_scores ds JOIN quant_runs qr ON qr.id = ds.run_id
         WHERE ${anchorWhere}`,
      )
      .bind(...anchorBindings)
      .all<Record<string, unknown>>();
    const anchorMap = new Map(
      anchors.results.map((row) => [`${row.run_id}:${row.symbol}`, row]),
    );
    for (const row of body.outcomes) {
      const anchor = anchorMap.get(`${row.signal_run_id}:${row.symbol.trim().toUpperCase()}`);
      if (!anchor || !["ACTIVE", "SUPERSEDED"].includes(String(anchor.status))) {
        return errorResponse(`missing_or_ineligible_score_anchor:${row.symbol}`, 422);
      }
      if (
        String(anchor.market_date) !== row.signal_date ||
        Math.abs(Number(anchor.quant_score) - row.quant_score) > 1e-6 ||
        Math.abs(Number(anchor.close) - row.signal_close) > 1e-7 ||
        scoreBucket(Number(anchor.quant_score)) !== row.score_bucket ||
        publication.methodology_version !== row.methodology_version
      ) {
        return errorResponse(`score_anchor_mismatch:${row.symbol}`, 422);
      }
    }

    const existingWhere = body.outcomes.map(() => "(signal_run_id = ? AND symbol = ? AND horizon = ?)").join(" OR ");
    const existingBindings = body.outcomes.flatMap((row) => [
      row.signal_run_id,
      row.symbol.trim().toUpperCase(),
      row.horizon,
    ]);
    const existing = await db
      .prepare(
        `SELECT signal_run_id, symbol, horizon, observation_hash
         FROM forward_outcomes WHERE ${existingWhere}`,
      )
      .bind(...existingBindings)
      .all<{ signal_run_id: string; symbol: string; horizon: number; observation_hash: string }>();
    const existingMap = new Map(
      existing.results.map((row) => [`${row.signal_run_id}:${row.symbol}:${row.horizon}`, row.observation_hash]),
    );
    for (const row of body.outcomes) {
      const priorHash = existingMap.get(`${row.signal_run_id}:${row.symbol.trim().toUpperCase()}:${row.horizon}`);
      if (priorHash && priorHash !== row.observation_hash) {
        return errorResponse(`conflicting_immutable_outcome:${row.symbol}`, 409);
      }
    }

    const createdAt = new Date().toISOString();
    const newRows = body.outcomes.filter(
      (row) => !existingMap.has(`${row.signal_run_id}:${row.symbol.trim().toUpperCase()}:${row.horizon}`),
    );
    if (newRows.length) {
      await db.batch(
        newRows.map((row) =>
          db
            .prepare(
              `INSERT INTO forward_outcomes
               (signal_run_id, symbol, signal_date, score_bucket, horizon,
                entry_date, exit_date, quant_score, entry_open, exit_close,
                signal_close, forward_return, signal_close_return, mae, mfe,
                computed_run_id, methodology_version, observation_hash, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(signal_run_id, symbol, horizon) DO NOTHING`,
            )
            .bind(
              row.signal_run_id,
              row.symbol.trim().toUpperCase(),
              row.signal_date,
              row.score_bucket,
              row.horizon,
              row.entry_date,
              row.exit_date,
              row.quant_score,
              row.entry_open,
              row.exit_close,
              row.signal_close,
              row.forward_return,
              row.signal_close_return,
              row.mae,
              row.mfe,
              row.computed_run_id,
              row.methodology_version,
              row.observation_hash,
              createdAt,
            ),
        ),
      );
    }
    const count = await db
      .prepare("SELECT COUNT(*) AS count FROM forward_outcomes WHERE computed_run_id = ?")
      .bind(computedRunId)
      .first<{ count: number }>();
    await db
      .prepare("UPDATE research_publications SET received_observations = ? WHERE computed_run_id = ?")
      .bind(Number(count?.count ?? 0), computedRunId)
      .run();
    return Response.json({
      ok: true,
      accepted: body.outcomes.length,
      received_observations: Number(count?.count ?? 0),
    });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "invalid_request");
  }
}
