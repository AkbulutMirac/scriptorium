import assert from "node:assert/strict";
import { test } from "node:test";
import { LRUCache } from "../../src/lru.js";

function clock(start = 1000) {
  const c = { t: start, now: () => c.t };
  return c;
}

test("validates capacity", () => {
  for (const capacity of [0, -1, 1.5, NaN, undefined, "3"]) {
    assert.throws(() => new LRUCache({ capacity }), RangeError, `capacity ${String(capacity)}`);
  }
  assert.doesNotThrow(() => new LRUCache({ capacity: 1 }));
});

test("set, get, has, size", () => {
  const c = new LRUCache({ capacity: 3 });
  assert.equal(c.set("a", 1), c);
  c.set("b", 2).set("c", 3);
  assert.equal(c.get("a"), 1);
  assert.equal(c.get("missing"), undefined);
  assert.equal(c.has("b"), true);
  assert.equal(c.size, 3);
});

test("evicts the least recently used", () => {
  const c = new LRUCache({ capacity: 2 });
  c.set("a", 1).set("b", 2);
  c.get("a");
  c.set("c", 3);
  assert.equal(c.has("b"), false);
  assert.deepEqual(c.keys(), ["a", "c"]);
});

test("has does not change the order", () => {
  const c = new LRUCache({ capacity: 2 });
  c.set("a", 1).set("b", 2);
  c.has("a");
  c.set("c", 3);
  assert.equal(c.has("a"), false);
  assert.deepEqual(c.keys(), ["b", "c"]);
});

test("setting an existing key updates it and its recency", () => {
  const c = new LRUCache({ capacity: 2 });
  c.set("a", 1).set("b", 2).set("a", 10);
  c.set("c", 3);
  assert.equal(c.get("a"), 10);
  assert.equal(c.has("b"), false);
  assert.equal(c.size, 2);
});

test("stores falsy values", () => {
  const c = new LRUCache({ capacity: 3 });
  c.set("zero", 0).set("empty", "").set("undef", undefined);
  assert.equal(c.get("zero"), 0);
  assert.equal(c.get("empty"), "");
  assert.equal(c.has("undef"), true);
  assert.equal(c.size, 3);
});

test("delete and clear", () => {
  const c = new LRUCache({ capacity: 3 });
  c.set("a", 1).set("b", 2);
  assert.equal(c.delete("a"), true);
  assert.equal(c.delete("a"), false);
  assert.equal(c.size, 1);
  c.clear();
  assert.equal(c.size, 0);
  assert.deepEqual(c.keys(), []);
});

test("entries expire after ttlMs", () => {
  const t = clock();
  const c = new LRUCache({ capacity: 3, ttlMs: 100, now: t.now });
  c.set("a", 1);
  t.t += 99;
  assert.equal(c.get("a"), 1);
  t.t += 1;
  assert.equal(c.get("a"), undefined);
  assert.equal(c.has("a"), false);
  assert.equal(c.size, 0);
  assert.equal(c.delete("a"), false);
});

test("set restarts the time to live, get does not", () => {
  const t = clock();
  const c = new LRUCache({ capacity: 3, ttlMs: 100, now: t.now });
  c.set("a", 1);
  t.t += 60;
  c.get("a");
  t.t += 50;
  assert.equal(c.has("a"), false);
  c.set("b", 2);
  t.t += 60;
  c.set("b", 3);
  t.t += 60;
  assert.equal(c.get("b"), 3);
});

test("expired entries are not counted and don't push out live ones", () => {
  const t = clock();
  const c = new LRUCache({ capacity: 2, ttlMs: 100, now: t.now });
  c.set("old", 1);
  t.t += 150;
  c.set("a", 2).set("b", 3);
  assert.equal(c.size, 2);
  assert.deepEqual(c.keys(), ["a", "b"]);
  assert.equal(c.get("a"), 2);
  assert.equal(c.get("b"), 3);
});

test("without ttl nothing expires", () => {
  const t = clock();
  const c = new LRUCache({ capacity: 2, now: t.now });
  c.set("a", 1);
  t.t += 1e12;
  assert.equal(c.get("a"), 1);
});
