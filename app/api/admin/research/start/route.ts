import {
  authorized,
  errorResponse,
  isHash,
  readJson,
  requiredDatabase,
} from "@/app/lib/ingest";
import { RESEARCH_METHODOLOGY } from "@/app/lib/research-ingest";

type ResearchStartPayload = {
  computed_run_id: string;
  methodology_version: string;
  expected_observations: number;
  payload_hash: string;
};

export async function POST(request: Request) {
  if (!(await authorized(request))) return errorResponse("unauthorized", 401);
  try {
    const body = await readJson<ResearchStartPayload>(request);
    if (!/^[A-Za-z0-9._:-]{8,100}$/.test(body.computed_run_id ?? "")) return errorResponse("invalid_computed_run_id");
    if (body.methodology_version !== RESEARCH_METHODOLOGY) return errorResponse("unsupported_methodology", 422);
    if (!Number.isInteger(body.expected_observations) || body.expected_observations < 0 || body.expected_observations > 20_000) {
      return errorResponse("invalid_expected_observations");
    }
    if (!isHash(body.payload_hash)) return errorResponse("invalid_research_payload_hash");
    const db = await requiredDatabase();
    const quantRun = await db
      .prepare("SELECT status FROM quant_runs WHERE id = ? LIMIT 1")
      .bind(body.computed_run_id)
      .first<{ status: string }>();
    if (quantRun?.status !== "ACTIVE") return errorResponse("computed_quant_run_not_active", 409);
    const existing = await db
      .prepare("SELECT * FROM research_publications WHERE computed_run_id = ? LIMIT 1")
      .bind(body.computed_run_id)
      .first<Record<string, unknown>>();
    if (existing?.status === "ACTIVE") {
      if (
        existing.payload_hash === body.payload_hash &&
        Number(existing.expected_observations) === body.expected_observations &&
        existing.methodology_version === body.methodology_version
      ) {
        return Response.json({ ok: true, status: "already_active", computed_run_id: body.computed_run_id });
      }
      return errorResponse("conflicting_active_research_payload", 409);
    }
    await db
      .prepare(
        `INSERT INTO research_publications
         (computed_run_id, status, methodology_version, expected_observations,
          received_observations, payload_hash, started_at)
         VALUES (?, 'PENDING', ?, ?, 0, ?, ?)
         ON CONFLICT(computed_run_id) DO NOTHING`,
      )
      .bind(
        body.computed_run_id,
        body.methodology_version,
        body.expected_observations,
        body.payload_hash,
        new Date().toISOString(),
      )
      .run();
    const stored = await db
      .prepare("SELECT * FROM research_publications WHERE computed_run_id = ? LIMIT 1")
      .bind(body.computed_run_id)
      .first<Record<string, unknown>>();
    if (
      !stored || stored.status !== "PENDING" || stored.payload_hash !== body.payload_hash ||
      Number(stored.expected_observations) !== body.expected_observations ||
      stored.methodology_version !== body.methodology_version
    ) {
      return errorResponse("research_run_conflict", 409);
    }
    return Response.json({ ok: true, status: "pending", computed_run_id: body.computed_run_id });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "invalid_request");
  }
}
