import { isOwnerEmail } from "@/app/lib/owner-auth";

type RuntimeEnv = {
  DB?: D1Database;
  RUN_ENABLED?: string;
  GITHUB_ACTIONS_TOKEN?: string;
  GITHUB_OWNER?: string;
  GITHUB_REPOSITORY?: string;
  GITHUB_WORKFLOW?: string;
  GITHUB_REF?: string;
  MANUAL_RUN_COOLDOWN_SECONDS?: string;
};

type ManualRunState = {
  id: string;
  requestedAt: string;
  requestedBy: string;
  status: "QUEUING" | "QUEUED" | "FAILED";
  detail: string;
};

async function runtimeEnv(): Promise<RuntimeEnv> {
  try {
    const cloudflare = await import("cloudflare:workers");
    return cloudflare.env as unknown as RuntimeEnv;
  } catch {
    return {};
  }
}

function json(body: Record<string, unknown>, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function authenticatedEmail(request: Request): string | null {
  const email = request.headers.get("oai-authenticated-user-email")?.trim();
  return email && email.length <= 254 && isOwnerEmail(email) ? email : null;
}

function hasSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function cooldownSeconds(value: string | undefined): number {
  const parsed = Number(value ?? "300");
  return Number.isInteger(parsed) && parsed >= 60 && parsed <= 3600 ? parsed : 300;
}

function parseState(value: unknown): ManualRunState | null {
  if (typeof value !== "string") return null;
  try {
    const state = JSON.parse(value) as ManualRunState;
    return state && typeof state.requestedAt === "string" ? state : null;
  } catch {
    return null;
  }
}

async function saveState(db: D1Database, state: ManualRunState): Promise<void> {
  await db
    .prepare(
      `INSERT INTO app_state (key, value, updated_at)
       VALUES ('last_manual_run', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .bind(JSON.stringify(state), new Date().toISOString())
    .run();
}

export async function POST(request: Request) {
  const requestedBy = authenticatedEmail(request);
  if (!requestedBy) return json({ ok: false, error: "owner_access_required" }, 403);
  if (!hasSameOrigin(request)) return json({ ok: false, error: "invalid_origin" }, 403);

  const env = await runtimeEnv();
  if (env.RUN_ENABLED !== "true") {
    return json(
      {
        ok: false,
        error: "acceptance_gate_closed",
        message: "Manual screening stays locked until the free-TradingView data adapter passes acceptance testing.",
      },
      503,
    );
  }

  const token = env.GITHUB_ACTIONS_TOKEN?.trim();
  const owner = env.GITHUB_OWNER?.trim();
  const repository = env.GITHUB_REPOSITORY?.trim();
  const workflow = env.GITHUB_WORKFLOW?.trim() || "quant-daily.yml";
  const ref = env.GITHUB_REF?.trim() || "main";
  if (!token || !owner || !repository) {
    return json(
      {
        ok: false,
        error: "manual_run_not_configured",
        message: "The secure GitHub Actions trigger is not configured yet.",
      },
      503,
    );
  }
  if (!env.DB) {
    return json({ ok: false, error: "database_unavailable" }, 503);
  }

  const previousRow = await env.DB
    .prepare("SELECT value FROM app_state WHERE key = 'last_manual_run' LIMIT 1")
    .first<{ value: string }>();
  const previous = parseState(previousRow?.value);
  const cooldown = cooldownSeconds(env.MANUAL_RUN_COOLDOWN_SECONDS);
  const previousTime = previous ? Date.parse(previous.requestedAt) : Number.NaN;
  const elapsedSeconds = Number.isFinite(previousTime)
    ? Math.floor((Date.now() - previousTime) / 1000)
    : cooldown;
  if (elapsedSeconds < cooldown) {
    return json(
      {
        ok: false,
        error: "run_already_requested",
        message: "A screening request was recently queued. Please wait before trying again.",
        retryAfterSeconds: cooldown - Math.max(0, elapsedSeconds),
      },
      429,
    );
  }

  const state: ManualRunState = {
    id: crypto.randomUUID(),
    requestedAt: new Date().toISOString(),
    requestedBy,
    status: "QUEUING",
    detail: "Dispatching full-universe screening with verified publication",
  };
  await saveState(env.DB, state);

  const dispatchUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`;
  try {
    const response = await fetch(dispatchUrl, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "BursaMusangKing-Quant-Terminal",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({ ref, inputs: { publish: "true" } }),
    });
    if (response.status !== 204) {
      const failed = {
        ...state,
        status: "FAILED" as const,
        detail: `GitHub rejected the request with status ${response.status}`,
      };
      await saveState(env.DB, failed);
      return json(
        {
          ok: false,
          error: "github_dispatch_failed",
          message: "GitHub did not accept the screening request.",
        },
        502,
      );
    }

    const queued = {
      ...state,
      status: "QUEUED" as const,
      detail: "Full Bursa screening queued with verified private publication",
    };
    await saveState(env.DB, queued);
    return json(
      {
        ok: true,
        status: queued.status,
        requestedAt: queued.requestedAt,
        message: "Full Bursa screening queued. Verified scores will update the private terminal.",
      },
      202,
    );
  } catch {
    const failed = {
      ...state,
      status: "FAILED" as const,
      detail: "GitHub dispatch request could not be completed",
    };
    await saveState(env.DB, failed);
    return json(
      {
        ok: false,
        error: "github_unreachable",
        message: "The screening request could not reach GitHub.",
      },
      502,
    );
  }
}
