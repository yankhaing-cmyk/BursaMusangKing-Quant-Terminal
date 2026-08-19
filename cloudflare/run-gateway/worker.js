const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

const APPROVED_ORIGIN =
  "https://bursa-musangking-quant-terminal.yankhaing.chatgpt.site";

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Run-Key",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

function jsonResponse(body, status, origin = "") {
  return Response.json(body, {
    status,
    headers: {
      ...JSON_HEADERS,
      ...(origin ? corsHeaders(origin) : {}),
    },
  });
}

function cooldownSeconds(value) {
  const parsed = Number(value ?? "300");
  return Number.isInteger(parsed) && parsed >= 60 && parsed <= 3600
    ? parsed
    : 300;
}

async function secureEqual(left, right) {
  if (!left || !right) return false;
  const encoder = new TextEncoder();
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  const a = new Uint8Array(leftHash);
  const b = new Uint8Array(rightHash);
  let difference = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return difference === 0;
}

const gateway = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") ?? "";
    const originAllowed = origin === APPROVED_ORIGIN;

    if (request.method === "OPTIONS") {
      if (!originAllowed) return jsonResponse({ ok: false }, 403);
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (request.method === "GET" && url.pathname === "/health") {
      return jsonResponse({ ok: true, service: "bursa-quant-run-gateway" }, 200);
    }

    if (request.method !== "POST" || url.pathname !== "/run") {
      return jsonResponse({ ok: false, error: "not_found" }, 404);
    }

    if (!originAllowed) {
      return jsonResponse({ ok: false, error: "origin_rejected" }, 403);
    }

    const suppliedRunKey = request.headers.get("X-Run-Key") ?? "";
    if (!(await secureEqual(suppliedRunKey, env.MANUAL_RUN_KEY ?? ""))) {
      return jsonResponse(
        { ok: false, error: "authentication_failed" },
        401,
        origin,
      );
    }

    const required = [
      "GITHUB_ACTIONS_TOKEN",
      "GITHUB_OWNER",
      "GITHUB_REPOSITORY",
      "GITHUB_WORKFLOW",
      "GITHUB_REF",
    ];
    const missing = required.filter((key) => !String(env[key] ?? "").trim());
    if (missing.length > 0 || !env.RUN_STATE) {
      return jsonResponse(
        { ok: false, error: "gateway_not_configured" },
        503,
        origin,
      );
    }

    const cooldown = cooldownSeconds(env.COOLDOWN_SECONDS);
    const now = Date.now();
    const previousValue = await env.RUN_STATE.get("last_manual_run");
    const previous = Number(previousValue ?? "0");
    const elapsed = Number.isFinite(previous) ? Math.floor((now - previous) / 1000) : cooldown;
    if (previous > 0 && elapsed < cooldown) {
      return jsonResponse(
        {
          ok: false,
          error: "cooldown_active",
          retryAfterSeconds: cooldown - Math.max(0, elapsed),
        },
        429,
        origin,
      );
    }

    await env.RUN_STATE.put("last_manual_run", String(now), {
      expirationTtl: Math.max(60, cooldown * 2),
    });

    const owner = encodeURIComponent(env.GITHUB_OWNER.trim());
    const repository = encodeURIComponent(env.GITHUB_REPOSITORY.trim());
    const workflow = encodeURIComponent(env.GITHUB_WORKFLOW.trim());
    const dispatchUrl = `https://api.github.com/repos/${owner}/${repository}/actions/workflows/${workflow}/dispatches`;

    let githubResponse;
    try {
      githubResponse = await fetch(dispatchUrl, {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${env.GITHUB_ACTIONS_TOKEN.trim()}`,
          "Content-Type": "application/json",
          "User-Agent": "BursaMusangKing-Quant-Terminal",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({
          ref: env.GITHUB_REF.trim(),
          inputs: { publish: "true" },
        }),
      });
    } catch {
      await env.RUN_STATE.delete("last_manual_run");
      return jsonResponse(
        { ok: false, error: "github_unreachable" },
        502,
        origin,
      );
    }

    if (githubResponse.status !== 204) {
      await env.RUN_STATE.delete("last_manual_run");
      return jsonResponse(
        {
          ok: false,
          error: "github_dispatch_rejected",
          githubStatus: githubResponse.status,
        },
        502,
        origin,
      );
    }

    return jsonResponse(
      {
        ok: true,
        status: "QUEUED",
        message: "Full Bursa screening queued; verified scores will update the private terminal.",
      },
      202,
      origin,
    );
  },
};

export default gateway;
