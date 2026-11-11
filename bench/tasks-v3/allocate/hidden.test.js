import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { main } from "../../src/cli.js";
import { Inventory } from "../../src/inventory.js";
import { allocate, parseOrders } from "../../src/orders.js";
import { textReport } from "../../src/report.js";

const STOCK = fileURLToPath(new URL("../../data/stock.csv", import.meta.url));
const dir = mkdtempSync(path.join(tmpdir(), "allocate-"));
let n = 0;
function file(text, ext = "json") {
  const f = path.join(dir, `f${n++}.${ext}`);
  writeFileSync(f, typeof text === "string" ? text : JSON.stringify(text));
  return f;
}
function run(argv) {
  const lines = [];
  const code = main(argv, (s) => lines.push(String(s)));
  return { code, output: lines.join("\n") };
}
const inv = (stock) => new Inventory(Object.entries(stock).map(([sku, quantity], i) => ({ sku, name: `Item ${sku}`, quantity, priceCents: 100 * (i + 1) })));
const order = (id, lines, priority) => ({ id, priority: priority ?? 5, lines: lines.map(([sku, quantity]) => ({ sku, quantity })) });
const qty = (inventory) => Object.fromEntries(inventory.items.map((i) => [i.sku, i.quantity]));
const L = (sku, quantity) => ({ sku, quantity });

test("parseOrders fills in the default priority and drops other fields", () => {
  const orders = parseOrders(JSON.stringify([{ id: "o1", note: "x", lines: [{ sku: "A", quantity: 2, extra: true }] }, { id: "o2", priority: 0, lines: [{ sku: "B", quantity: 1 }] }]));
  assert.deepEqual(orders, [
    { id: "o1", priority: 5, lines: [{ sku: "A", quantity: 2 }] },
    { id: "o2", priority: 0, lines: [{ sku: "B", quantity: 1 }] },
  ]);
});

test("parseOrders rejects bad JSON and non-lists", () => {
  assert.throws(() => parseOrders("[{"), (err) => err instanceof SyntaxError && err.message.startsWith("Invalid JSON"));
  assert.throws(() => parseOrders('{"id":"o1"}'), (err) => err instanceof TypeError && err.message === "Orders must be a list");
});

test("parseOrders names the first invalid order", () => {
  const good = { id: "ok", lines: [{ sku: "A", quantity: 1 }] };
  const bad = [
    { lines: [{ sku: "A", quantity: 1 }] },
    { id: "", lines: [{ sku: "A", quantity: 1 }] },
    { id: "x", lines: [] },
    { id: "x", lines: [{ sku: "A", quantity: 0 }] },
    { id: "x", lines: [{ sku: "A", quantity: 1.5 }] },
    { id: "x", lines: [{ sku: "", quantity: 1 }] },
    { id: "x", priority: -1, lines: [{ sku: "A", quantity: 1 }] },
    { id: "x", priority: 1.5, lines: [{ sku: "A", quantity: 1 }] },
    { id: "x", lines: [{ sku: "A", quantity: "2" }] },
    null,
  ];
  for (const b of bad) {
    assert.throws(() => parseOrders(JSON.stringify([good, b, b])), (err) => err instanceof TypeError && err.message === "Invalid order at index 1", JSON.stringify(b));
  }
});

test("lower priority numbers go first; results keep list order", () => {
  const { inventory, results } = allocate(inv({ A: 5 }), [order("o1", [["A", 3]], 5), order("o2", [["A", 4]], 1)]);
  assert.deepEqual(results, [
    { id: "o1", status: "backordered", allocated: [], missing: [L("A", 2)] },
    { id: "o2", status: "filled", allocated: [L("A", 4)], missing: [] },
  ]);
  assert.deepEqual(qty(inventory), { A: 1 });
  assert.ok(inventory instanceof Inventory);
});

test("equal priorities keep their order in the list", () => {
  const { results } = allocate(inv({ A: 3 }), [order("o1", [["A", 2]], 2), order("o2", [["A", 2]], 2), order("o3", [["A", 1]], 2)]);
  assert.deepEqual(results.map((r) => r.status), ["filled", "backordered", "filled"]);
});

test("all or nothing: a backordered order leaves its stock for later orders", () => {
  const { inventory, results } = allocate(inv({ A: 2, B: 1 }), [order("o1", [["A", 1], ["B", 2]]), order("o2", [["A", 2]])]);
  assert.deepEqual(results, [
    { id: "o1", status: "backordered", allocated: [], missing: [L("B", 1)] },
    { id: "o2", status: "filled", allocated: [L("A", 2)], missing: [] },
  ]);
  assert.deepEqual(qty(inventory), { A: 0, B: 1 });
});

test("lines for the same SKU count together", () => {
  const { inventory, results } = allocate(inv({ A: 3 }), [order("o1", [["A", 2], ["A", 2]])]);
  assert.deepEqual(results, [{ id: "o1", status: "backordered", allocated: [], missing: [L("A", 1)] }]);
  assert.deepEqual(qty(inventory), { A: 3 });
  const ok = allocate(inv({ A: 4 }), [order("o1", [["A", 2], ["A", 2]])]);
  assert.deepEqual(ok.results[0], { id: "o1", status: "filled", allocated: [L("A", 2), L("A", 2)], missing: [] });
});

test("partial: each line takes what is left", () => {
  const { inventory, results } = allocate(inv({ A: 3, B: 0 }), [order("o1", [["A", 2], ["B", 1], ["A", 2]])], { partial: true });
  assert.deepEqual(results, [{ id: "o1", status: "partial", allocated: [L("A", 2), L("A", 1)], missing: [L("B", 1), L("A", 1)] }]);
  assert.deepEqual(qty(inventory), { A: 0, B: 0 });
});

test("partial: filled and backordered", () => {
  const { inventory, results } = allocate(inv({ A: 2, B: 5 }), [order("o1", [["A", 2], ["B", 1]]), order("o2", [["A", 1]]), order("o3", [["B", 4]], 9)], { partial: true });
  assert.deepEqual(results, [
    { id: "o1", status: "filled", allocated: [L("A", 2), L("B", 1)], missing: [] },
    { id: "o2", status: "backordered", allocated: [], missing: [L("A", 1)] },
    { id: "o3", status: "filled", allocated: [L("B", 4)], missing: [] },
  ]);
  assert.deepEqual(qty(inventory), { A: 0, B: 0 });
});

test("unknown SKUs reject the order, also in partial mode", () => {
  for (const partial of [false, true]) {
    const { inventory, results } = allocate(inv({ A: 5 }), [order("o1", [["A", 1], ["Z", 1], ["Y", 1]]), order("o2", [["A", 1]])], { partial });
    assert.deepEqual(results, [
      { id: "o1", status: "rejected", allocated: [], missing: [], reason: "Unknown SKU Z" },
      { id: "o2", status: "filled", allocated: [L("A", 1)], missing: [] },
    ]);
    assert.ok(!("reason" in results[1]));
    assert.deepEqual(qty(inventory), { A: 4 });
  }
});

test("the inputs are never changed", () => {
  const stock = inv({ A: 3, B: 1 });
  const orders = [order("o1", [["A", 2]]), order("o2", [["B", 1], ["A", 5]])];
  const before = JSON.stringify({ items: stock.items, orders });
  const items = stock.items;
  const a = allocate(stock, orders, { partial: true });
  allocate(stock, orders);
  assert.equal(JSON.stringify({ items: stock.items, orders }), before);
  assert.equal(stock.items, items);
  assert.notEqual(a.inventory, stock);
  assert.deepEqual(qty(a.inventory), { A: 0, B: 0 });
});

test("the remaining inventory keeps names and prices", () => {
  const { inventory } = allocate(inv({ A: 3 }), [order("o1", [["A", 1]])]);
  assert.deepEqual(inventory.items, [{ sku: "A", name: "Item A", quantity: 2, priceCents: 100 }]);
});

test("CLI: all filled", () => {
  const orders = file([{ id: "w1", lines: [{ sku: "A100", quantity: 2 }] }, { id: "w2", priority: 1, lines: [{ sku: "B200", quantity: 40 }] }]);
  const r = run(["allocate", orders, STOCK]);
  assert.equal(r.code, 0);
  const left = allocate(Inventory.fromCSV(readFileSync(STOCK, "utf8")), parseOrders(readFileSync(orders, "utf8"))).inventory;
  assert.equal(r.output, `w1 filled\nw2 filled\n\n${textReport(left)}`);
});

test("CLI: statuses, missing lists and exit code 4", () => {
  const orders = file([
    { id: "w1", lines: [{ sku: "A101", quantity: 5 }, { sku: "B201", quantity: 1 }] },
    { id: "w2", lines: [{ sku: "ZZZ", quantity: 1 }] },
    { id: "w3", lines: [{ sku: "C300", quantity: 7 }] },
  ]);
  const strict = run(["allocate", orders, STOCK]);
  assert.equal(strict.code, 4);
  assert.equal(strict.output.split("\n\n")[0], "w1 backordered - missing A101 x2, B201 x1\nw2 rejected - Unknown SKU ZZZ\nw3 filled");
  for (const argv of [["allocate", "--partial", orders, STOCK], ["allocate", orders, STOCK, "--partial"]]) {
    const partial = run(argv);
    assert.equal(partial.code, 4);
    const [lines, report] = partial.output.split("\n\n");
    assert.equal(lines, "w1 partial - missing A101 x2, B201 x1\nw2 rejected - Unknown SKU ZZZ\nw3 filled");
    assert.match(report, /A101\s+Office chair\s+0\s/);
  }
});

test("CLI: usage errors", () => {
  const orders = file([{ id: "w1", lines: [{ sku: "A100", quantity: 1 }] }]);
  for (const argv of [["allocate"], ["allocate", orders], ["allocate", orders, STOCK, "--fast"], ["allocate", "--nope", orders, STOCK]]) {
    const r = run(argv);
    assert.equal(r.code, 1, JSON.stringify(argv));
    assert.match(r.output, /^Usage:/);
  }
});

test("CLI: invalid orders", () => {
  const badJson = run(["allocate", file("[{oops"), STOCK]);
  assert.equal(badJson.code, 2);
  assert.match(badJson.output, /^Error: Invalid JSON/);
  const badShape = run(["allocate", file([{ id: "w1", lines: [] }]), STOCK]);
  assert.equal(badShape.code, 2);
  assert.equal(badShape.output, "Error: Invalid order at index 0");
});

test("CLI: the plain report keeps working", () => {
  const r = run([STOCK]);
  assert.equal(r.code, 0);
  assert.equal(r.output, textReport(Inventory.fromCSV(readFileSync(STOCK, "utf8"))));
});
