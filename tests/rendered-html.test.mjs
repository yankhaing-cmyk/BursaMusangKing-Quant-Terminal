import assert from "node:assert/strict";
import test from "node:test";

const developmentPreviewMeta =
  /<meta(?=[^>]*\bname=["']codex-preview["'])(?=[^>]*\bcontent=["']development["'])[^>]*>/i;

test("renders development preview metadata", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  const response = await worker.fetch(
    new Request("http://localhost/", {
      headers: {
        accept: "text/html",
        "oai-authenticated-user-email": "yankhaing@gmail.com",
      },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html\b/i,
  );
  const html = await response.text();
  assert.match(html, developmentPreviewMeta);
  assert.match(html, /BursaMusangKing Quant Terminal/i);
  assert.match(html, /Publication gate closed/i);
  assert.match(html, /Illustrative interface only/i);
  assert.match(html, /Run full Bursa screening/i);
  assert.match(html, />Research</i);
  assert.match(html, />Regime</i);
});

test("owner health API fails closed without an active D1 run", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("health", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const response = await worker.fetch(
    new Request("http://localhost/api/health", {
      headers: { "oai-authenticated-user-email": "yankhaing@gmail.com" },
    }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.mode, "DEMO");
  assert.equal(body.failClosed, true);
  assert.equal(body.run.status, "NOT_CONNECTED");
});

test("owner research API starts empty and never invents expected edge", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("research", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const response = await worker.fetch(
    new Request("http://localhost/api/research", {
      headers: { "oai-authenticated-user-email": "yankhaing@gmail.com" },
    }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.observationCount, 0);
  assert.equal(body.minimumSample, 30);
  assert.deepEqual(body.statistics, []);
  assert.deepEqual(body.regimeStatistics, []);
});

test("manual Run API rejects unauthenticated requests", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("run-auth", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const response = await worker.fetch(
    new Request("http://localhost/api/run", {
      method: "POST",
      headers: { origin: "http://localhost", "content-type": "application/json" },
      body: "{}",
    }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { ok: false, error: "owner_access_required" });
});

test("manual Run API remains fail-closed until explicitly enabled", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("run-gate", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const response = await worker.fetch(
    new Request("http://localhost/api/run", {
      method: "POST",
      headers: {
        origin: "http://localhost",
        "content-type": "application/json",
        "oai-authenticated-user-email": "yankhaing@gmail.com",
      },
      body: "{}",
    }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.equal(body.error, "acceptance_gate_closed");
});

test("anonymous browser and data routes expose no ranking data", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("private-routes", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const env = { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } };
  const ctx = { waitUntil() {}, passThroughOnException() {} };

  const page = await worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    env,
    ctx,
  );
  assert.equal(page.status, 307);
  assert.match(
    page.headers.get("location") ?? "",
    /\/signin-with-chatgpt\?return_to=%2F$/,
  );

  for (const path of ["/api/health", "/api/ranking", "/api/research", "/api/stocks/PWRWELL"]) {
    const response = await worker.fetch(new Request(`http://localhost${path}`), env, ctx);
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(await response.json(), {
      ok: false,
      error: "owner_access_required",
    });
  }
});

test("signed-in non-owner receives no terminal or API data", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("non-owner", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const headers = { "oai-authenticated-user-email": "visitor@example.com" };
  const env = { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } };
  const ctx = { waitUntil() {}, passThroughOnException() {} };

  const page = await worker.fetch(
    new Request("http://localhost/", { headers: { ...headers, accept: "text/html" } }),
    env,
    ctx,
  );
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /Owner access required/i);
  assert.doesNotMatch(html, /Sample score anatomy/i);

  const ranking = await worker.fetch(
    new Request("http://localhost/api/ranking", { headers }),
    env,
    ctx,
  );
  assert.equal(ranking.status, 403);
});
