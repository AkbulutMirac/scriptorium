import assert from "node:assert/strict";
import { test } from "node:test";
import { formatMoney } from "../src/money.js";

test("formats cents as dollars", () => {
  assert.equal(formatMoney(123456), "$1,234.56");
  assert.equal(formatMoney(5), "$0.05");
  assert.equal(formatMoney(-250), "-$2.50");
});
