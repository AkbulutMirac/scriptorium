import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { main } from "../../src/cli.js";
import { Inventory } from "../../src/inventory.js";
import { applyMovements, parseMovements } from "../../src/ledger.js";
import { textReport } from "../../src/report.js";

const CSV = fileURLToPath(new URL("../../data/stock.csv", import.meta.url));
const inv = () =>
  new Inventory([
    { sku: "A", name: "Apple", quantity: 5, priceCents: 100 },
    { sku: "B", name: "Banana", quantity: 0, priceCents: 50 },
  ]);
const mv = (line, date, sku, type, quantity) => ({ line, date, sku, type, quantity });

function run(argv) {
  const lines = [];
  const code = main(argv, (s) => lines.push(String(s)));
  return { code, output: lines.join("\n") };
}

test("parses valid rows with line numbers", () => {
  const { movements, errors } = parseMovements("date,sku,type,quantity\n2026-01-02,A,receive,10\n2026-01-03,B,ship,2\n2026-01-04,A,adjust,0\n");
  assert.deepEqual(errors, []);
  assert.deepEqual(movements, [mv(2, "2026-01-02", "A", "receive", 10), mv(3, "2026-01-03", "B", "ship", 2), mv(4, "2026-01-04", "A", "adjust", 0)]);
});

test("reports invalid rows", () => {
  const text = [
    "date,sku,type,quantity",
    "2026-02-30,A,receive,1",
    "2026-1-05,A,receive,1",
    "2026-01-05,A,steal,1",
    "2026-01-05,A,receive,-3",
    "2026-01-05,A,receive,1.5",
    "2026-01-05,A,receive",
    "nope,A,steal,x",
    "2026-01-06,A,ship,2",
  ].join("\n");
  const { movements, errors } = parseMovements(text);
  assert.deepEqual(movements, [mv(9, "2026-01-06", "A", "ship", 2)]);
  assert.deepEqual(errors, [
    { line: 2, message: "Invalid date" },
    { line: 3, message: "Invalid date" },
    { line: 4, message: "Invalid type" },
    { line: 5, message: "Invalid quantity" },
    { line: 6, message: "Invalid quantity" },
    { line: 7, message: "Wrong number of columns" },
    { line: 8, message: "Invalid date" },
  ]);
});

test("leap day is a real date", () => {
  assert.deepEqual(parseMovements("date,sku,type,quantity\n2028-02-29,A,receive,1\n").errors, []);
  assert.deepEqual(parseMovements("date,sku,type,quantity\n2027-02-29,A,receive,1\n").errors, [{ line: 2, message: "Invalid date" }]);
});

test("applies receive, ship and adjust", () => {
  const original = inv();
  const { inventory, errors } = applyMovements(original, [mv(2, "2026-01-01", "A", "ship", 2), mv(3, "2026-01-02", "B", "receive", 7), mv(4, "2026-01-03", "A", "adjust", 9)]);
  assert.deepEqual(errors, []);
  assert.equal(inventory.find("A").quantity, 9);
  assert.equal(inventory.find("B").quantity, 7);
  assert.equal(original.find("A").quantity, 5, "input inventory is unchanged");
  assert.equal(original.find("B").quantity, 0);
});

test("orders by date, keeping the order within a date", () => {
  const { inventory, errors } = applyMovements(inv(), [
    mv(2, "2026-03-01", "B", "ship", 3),
    mv(3, "2026-01-01", "B", "receive", 2),
    mv(4, "2026-01-01", "B", "receive", 1),
  ]);
  assert.deepEqual(errors, []);
  assert.equal(inventory.find("B").quantity, 0);
  const second = applyMovements(inv(), [mv(2, "2026-01-01", "A", "adjust", 1), mv(3, "2026-01-01", "A", "receive", 4)]);
  assert.equal(second.inventory.find("A").quantity, 5);
});

test("skips bad movements with messages", () => {
  const { inventory, errors } = applyMovements(inv(), [
    mv(2, "2026-01-01", "Z", "receive", 1),
    mv(3, "2026-01-02", "A", "receive", 0),
    mv(4, "2026-01-03", "A", "ship", 0),
    mv(5, "2026-01-04", "A", "ship", 6),
    mv(6, "2026-01-05", "A", "ship", 5),
    mv(7, "2026-01-06", "Z", "ship", 0),
  ]);
  assert.deepEqual(errors, [
    { line: 2, message: "Unknown SKU Z" },
    { line: 3, message: "Quantity must be positive" },
    { line: 4, message: "Quantity must be positive" },
    { line: 5, message: "Not enough stock for A (have 5, need 6)" },
    { line: 7, message: "Unknown SKU Z" },
  ]);
  assert.equal(inventory.find("A").quantity, 0);
});

test("adjust to zero is allowed", () => {
  const { inventory, errors } = applyMovements(inv(), [mv(2, "2026-01-01", "A", "adjust", 0)]);
  assert.deepEqual(errors, []);
  assert.equal(inventory.find("A").quantity, 0);
});

test("errors follow the applied order", () => {
  const { errors } = applyMovements(inv(), [mv(2, "2026-05-01", "Q", "receive", 1), mv(3, "2026-01-01", "R", "receive", 1)]);
  assert.deepEqual(errors, [
    { line: 3, message: "Unknown SKU R" },
    { line: 2, message: "Unknown SKU Q" },
  ]);
});

function tmpFile(name, text) {
  const dir = mkdtempSync(path.join(tmpdir(), "ledger-"));
  const file = path.join(dir, name);
  writeFileSync(file, text);
  return file;
}

test("CLI ledger without errors", () => {
  const moves = tmpFile("m.csv", "date,sku,type,quantity\n2026-01-01,B201,receive,5\n2026-01-02,A101,ship,3\n");
  const { code, output } = run(["ledger", moves, CSV]);
  assert.equal(code, 0);
  const expected = applyMovements(Inventory.fromCSV("sku,name,quantity,price_cents\nA100,Desk lamp,12,2499\nA101,Office chair,3,15900\nB200,Notebook,140,350\nB201,Pen set,0,899\nC300,Monitor stand,7,4550\n"), [
    mv(2, "2026-01-01", "B201", "receive", 5),
    mv(3, "2026-01-02", "A101", "ship", 3),
  ]).inventory;
  assert.equal(output, textReport(expected));
});

test("CLI ledger with errors", () => {
  const moves = tmpFile("m.csv", "date,sku,type,quantity\n2026-01-02,A101,ship,9\nbad,A100,receive,1\n2026-01-01,ZZZ,receive,1\n");
  const { code, output } = run(["ledger", moves, CSV]);
  assert.equal(code, 3);
  const lines = output.split("\n");
  assert.deepEqual(lines.slice(-3), ["Line 3: Invalid date", "Line 4: Unknown SKU ZZZ", "Line 2: Not enough stock for A101 (have 3, need 9)"]);
});

test("CLI usage", () => {
  for (const argv of [["ledger"], ["ledger", CSV]]) {
    const { code, output } = run(argv);
    assert.equal(code, 1);
    assert.ok(output.split("\n").some((l) => l.startsWith("Usage:")));
  }
  assert.equal(run([CSV]).code, 0);
});
