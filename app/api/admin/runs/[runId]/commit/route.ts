import {
  authorized,
  errorResponse,
  requiredDatabase,
  sha256Hex,
} from "@/app/lib/ingest";
import { validateRegime, type RegimePayload } from "@/app/lib/regime-ingest";

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
    const invalid =
      Number(critical?.count ?? 0) > 0 ||
      Boolean(regimeError) ||
      String(regimeRow?.market_date ?? "") !== String(run.market_date) ||
      received !== expected ||
      computedHash !== String(run.payload_hash) ||
      String(run.market_date) !== String(run.benchmark_date);
    if (invalid) {
      await db
        .prepare(
          "UPDATE quant_runs SET status = 'REJECTED', received_symbols = ? WHERE id = ?",
        )
        .bind(received, runId)
        .run();
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
        `SELECT qr.status, state.value AS active_run_id
         FROM quant_runs qr LEFT JOIN app_state state ON state.key = 'active_run_id'
         WHERE qr.id = ? LIMIT 1`,
      )
      .bind(runId)
      .first<{ status: string; active_run_id: string | null }>();
    if (promoted?.status !== "ACTIVE" || promoted.active_run_id !== runId) {
      return errorResponse("newer_or_conflicting_run_already_active", 409);
    }
    return Response.json({
      ok: true,
      status: "active",
      run_id: runId,
      market_date: run.market_date,
      received_symbols: received,
      payload_hash: computedHash,
    });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "invalid_request");
  }
}
