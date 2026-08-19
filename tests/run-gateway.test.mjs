import assert from "node:assert/strict";
import test from "node:test";

import gateway from "../cloudflare/run-gateway/worker.js";

const allowedOrigin =
  "https://bursa-musangking-quant-terminal.yankhaing.chatgpt.site";
const runKey = "test-manual-run-key-that-is-longer-than-32-characters";

function testEnv() {
  const state = new Map();
  return {
    ALLOWED_ORIGIN: allowedOrigin,
    MANUAL_RUN_KEY: runKey,
    GITHUB_ACTIONS_TOKEN: "test-github-token",
    GITHUB_OWNER: "yankhaing-cmyk",
    GITHUB_REPOSITORY: "BursaMusangKing-Quant-Terminal",
    GITHUB_WORKFLOW: "quant-daily.yml",
    GITHUB_REF: "main",
    COOLDOWN_SECONDS: "300",
    RUN_STATE: {
      get: async (key) => state.get(key) ?? null,
      put: async (key, value) => state.set(key, value),
      delete: async (key) => state.delete(key),
    },
  };
}

function runRequest(origin = allowedOrigin, key = runKey) {
  return new Request("https://gateway.example/run", {
    method: "POST",
    headers: { Origin: origin, "X-Run-Key": key },
  });
}

test("manual gateway authenticates, queues verified publication, and rate-limits", async () => {
  const env = testEnv();
  const originalFetch = globalThis.fetch;
  const dispatches = [];
  globalThis.fetch = async (url, init) => {
    dispatches.push({ url: String(url), init });
    return new Response(null, { status: 204 });
  };

  try {
    const accepted = await gateway.fetch(runRequest(), env);
    assert.equal(accepted.status, 202);
    assert.deepEqual(await accepted.json(), {
      ok: true,
      status: "QUEUED",
      message: "Full Bursa screening queued; verified scores will update the private terminal.",
    });
    assert.equal(dispatches.length, 1);
    assert.deepEqual(JSON.parse(dispatches[0].init.body), {
      ref: "main",
      inputs: { publish: "true" },
    });
    assert.equal(
      dispatches[0].url,
      "https://api.github.com/repos/yankhaing-cmyk/BursaMusangKing-Quant-Terminal/actions/workflows/quant-daily.yml/dispatches",
    );

    const cooldown = await gateway.fetch(runRequest(), env);
    assert.equal(cooldown.status, 429);
    assert.equal((await cooldown.json()).error, "cooldown_active");
    assert.equal(dispatches.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("manual gateway rejects an unapproved origin and an invalid run key", async () => {
  const env = testEnv();
  const rejectedOrigin = await gateway.fetch(
    runRequest("https://example.invalid"),
    env,
  );
  assert.equal(rejectedOrigin.status, 403);

  const rejectedKey = await gateway.fetch(runRequest(allowedOrigin, "wrong"), env);
  assert.equal(rejectedKey.status, 401);
});

test("manual gateway health check exposes no configuration", async () => {
  const response = await gateway.fetch(
    new Request("https://gateway.example/health"),
    {},
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    service: "bursa-quant-run-gateway",
  });
});
