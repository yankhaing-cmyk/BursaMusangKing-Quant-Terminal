import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Phase 4 Open view stays visible in the terminal source", async () => {
  const component = await readFile(
    new URL("../app/components/QuantTerminal.tsx", import.meta.url),
    "utf8",
  );

  assert.match(component, /function OpenView/);
  assert.match(component, /Awaiting the next verified screening run/);
  assert.match(component, /Automatic orders/);
});

test("trade API rejects unauthenticated requests", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("phase4-trade-auth", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const response = await worker.fetch(
    new Request("http://localhost/api/trades"),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );

  assert.equal(response.status, 403);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), {
    ok: false,
    error: "owner_access_required",
  });
});

test("Phase 5 Portfolio view and API remain owner-only and fail closed", async () => {
  const component = await readFile(
    new URL("../app/components/QuantTerminal.tsx", import.meta.url),
    "utf8",
  );
  assert.match(component, /function PortfolioView/);
  assert.match(component, /Normalized shadow allocation/);
  assert.match(component, /Automatic execution remains OFF/);

  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("phase5-portfolio-auth", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const response = await worker.fetch(
    new Request("http://localhost/api/portfolio"),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), { ok: false, error: "owner_access_required" });
});
