import assert from "node:assert/strict";
import { test } from "node:test";
import { formatDuration, parseDuration } from "../../src/duration.js";

test("parses single units", () => {
  assert.equal(parseDuration("45s"), 45);
  assert.equal(parseDuration("2m"), 120);
  assert.equal(parseDuration("3h"), 10800);
  assert.equal(parseDuration("1d"), 86400);
});

test("parses combined units", () => {
  assert.equal(parseDuration("1h30m15s"), 5415);
  assert.equal(parseDuration("1d2h3m4s"), 93784);
  assert.equal(parseDuration("2d5s"), 172805);
});

test("allows spaces and mixed case", () => {
  assert.equal(parseDuration("1h 30m"), 5400);
  assert.equal(parseDuration("  2H  "), 7200);
  assert.equal(parseDuration("1D 1H 1M 1S"), 90061);
});

test("allows zero amounts", () => {
  assert.equal(parseDuration("0s"), 0);
  assert.equal(parseDuration("0h5m"), 300);
});

test("throws TypeError for non-strings", () => {
  assert.throws(() => parseDuration(30), TypeError);
  assert.throws(() => parseDuration(null), TypeError);
  assert.throws(() => parseDuration(undefined), TypeError);
});

test("rejects invalid input", () => {
  for (const bad of ["", "   ", "10", "5x", "1m1h", "1h1h", "1.5h", "-5s", "h", "1h30", "abc"]) {
    assert.throws(() => parseDuration(bad), (err) => err instanceof Error && !(err instanceof TypeError) && err.message.startsWith("Invalid duration"), `should reject ${JSON.stringify(bad)}`);
  }
});

test("formats durations", () => {
  assert.equal(formatDuration(93784), "1d 2h 3m 4s");
  assert.equal(formatDuration(3600), "1h");
  assert.equal(formatDuration(61), "1m 1s");
  assert.equal(formatDuration(86400 + 5), "1d 5s");
  assert.equal(formatDuration(0), "0s");
});

test("format rejects bad numbers", () => {
  for (const bad of [-1, 1.5, NaN, Infinity, "10"]) {
    assert.throws(() => formatDuration(bad), RangeError, `should reject ${String(bad)}`);
  }
});

test("round trips", () => {
  for (const s of [1, 59, 60, 3599, 3661, 90061, 1000000]) {
    assert.equal(parseDuration(formatDuration(s)), s);
  }
});
