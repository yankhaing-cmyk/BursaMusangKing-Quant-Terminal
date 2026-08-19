import assert from "node:assert/strict";
import test from "node:test";
import {
  isValidBursaSymbol,
  normalizeBursaSymbol,
} from "../shared/bursa-symbol.mjs";

test("accepts observed Bursa symbols including L&G", () => {
  for (const symbol of ["L&G", "1155", "AEMULUS", "ABC-PA", "ABC.CA"]) {
    assert.equal(isValidBursaSymbol(symbol), true, symbol);
  }
  assert.equal(normalizeBursaSymbol(" l&g "), "L&G");
});

test("rejects symbols with unsafe or ambiguous path characters", () => {
  for (const symbol of ["", "../L&G", "ABC/DEF", "ABC DEF", "ABC?DEF", "ABC#DEF", "A".repeat(21)]) {
    assert.equal(isValidBursaSymbol(symbol), false, symbol);
  }
});
