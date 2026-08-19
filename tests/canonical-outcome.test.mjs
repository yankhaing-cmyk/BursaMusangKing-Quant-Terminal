import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { canonicalOutcome } from "../shared/canonical-outcome.mjs";

test("Python and Worker share the frozen forward-outcome representation", () => {
  const outcome = {
    signal_run_id: "qv1-20260818-example",
    symbol: "L&G",
    signal_date: "2026-08-18",
    score_bucket: "85-89",
    horizon: 5,
    entry_date: "2026-08-19",
    exit_date: "2026-08-25",
    quant_score: 87.25,
    entry_open: 1.2,
    exit_close: 1.32,
    signal_close: 1.18,
    forward_return: 0.1,
    signal_close_return: 0.1186440678,
    mae: -0.0416666667,
    mfe: 0.125,
    computed_run_id: "qv1-20260825-example",
    methodology_version: "next-open-v1.0.0",
  };
  const digest = createHash("sha256").update(canonicalOutcome(outcome), "utf8").digest("hex");
  assert.equal(digest, "0d9833c6148c875c28941dc49e577f14bf763f3bc64b888877da1a0ed130dd55");
});
