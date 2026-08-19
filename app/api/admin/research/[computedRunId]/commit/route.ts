import {
  authorized,
  errorResponse,
  requiredDatabase,
  sha256Hex,
} from "@/app/lib/ingest";
import {
  refreshResearchBucketStats,
  refreshResearchRegimeStats,
} from "@/app/lib/research-ingest";

export async function POST(
  request: Request,
  context: { params: Promise<{ computedRunId: string }> },
) {
  if (!(await authorized(request))) return errorResponse("unauthorized", 401);
  try {
    const { computedRunId } = await context.params;
    const db = await requiredDatabase();
    const publication = await db
      .prepare("SELECT * FROM research_publications WHERE computed_run_id = ? LIMIT 1")
      .bind(computedRunId)
      .first<Record<string, unknown>>();
    if (!publication) return errorResponse("research_run_not_found", 404);
    if (publication.status === "ACTIVE") {
      return Response.json({ ok: true, status: "already_active", computed_run_id: computedRunId });
    }
    if (publication.status !== "PENDING") return errorResponse("research_run_not_pending", 409);
    const hashes = await db
      .prepare(
        `SELECT signal_run_id, symbol, horizon, observation_hash
         FROM forward_outcomes WHERE computed_run_id = ?
         ORDER BY signal_run_id, symbol, horizon`,
      )
      .bind(computedRunId)
      .all<{ signal_run_id: string; symbol: string; horizon: number; observation_hash: string }>();
    const computedHash = await sha256Hex(
      hashes.results
        .map((row) => `${row.signal_run_id}:${row.symbol}:${row.horizon}:${row.observation_hash}`)
        .join("\n"),
    );
    const received = hashes.results.length;
    if (
      received !== Number(publication.expected_observations) ||
      computedHash !== String(publication.payload_hash)
    ) {
      await db
        .prepare("UPDATE research_publications SET status = 'REJECTED', received_observations = ? WHERE computed_run_id = ?")
        .bind(received, computedRunId)
        .run();
      return errorResponse("research_commit_validation_failed_previous_stats_preserved", 422);
    }

    const groups = await db
      .prepare(
        `SELECT DISTINCT score_bucket, horizon FROM forward_outcomes
         WHERE computed_run_id = ?`,
      )
      .bind(computedRunId)
      .all<{ score_bucket: string; horizon: number }>();
    const regimeGroups = await db
      .prepare(
        `SELECT DISTINCT regime.regime_label, outcome.horizon
         FROM forward_outcomes outcome
         JOIN market_regimes regime ON regime.run_id = outcome.signal_run_id
         WHERE outcome.computed_run_id = ?`,
      )
      .bind(computedRunId)
      .all<{ regime_label: string; horizon: number }>();
    await Promise.all([
      refreshResearchBucketStats(db, groups.results),
      refreshResearchRegimeStats(db, regimeGroups.results),
    ]);
    const committedAt = new Date().toISOString();
    await db.batch([
      db
        .prepare(
          `UPDATE research_publications
           SET status = 'ACTIVE', received_observations = ?, committed_at = ?
           WHERE computed_run_id = ? AND status = 'PENDING'`,
        )
        .bind(received, committedAt, computedRunId),
      db
        .prepare(
          `UPDATE research_publications SET status = 'SUPERSEDED'
           WHERE status = 'ACTIVE' AND computed_run_id <> ?`,
        )
        .bind(computedRunId),
      db
        .prepare(
          `INSERT INTO app_state (key, value, updated_at)
           VALUES ('research_run_id', ?, ?)
           ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
        )
        .bind(computedRunId, committedAt),
    ]);
    return Response.json({
      ok: true,
      status: "active",
      computed_run_id: computedRunId,
      received_observations: received,
      payload_hash: computedHash,
    });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "invalid_request");
  }
}
