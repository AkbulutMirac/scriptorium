import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { main } from "../../src/cli.js";
import { Inventory } from "../../src/inventory.js";
import { textReport } from "../../src/report.js";

const CSV = fileURLToPath(new URL("../../data/stock.csv", import.meta.url));

function run(argv) {
  const lines = [];
  const code = main(argv, (s) => lines.push(String(s)));
  return { code, output: lines.join("\n") };
}

const inv = () =>
  new Inventory([
    { sku: "A", name: "Zeta", quantity: 2, priceCents: 100 },
    { sku: "B", name: "Alpha", quantity: 10, priceCents: 50 },
    { sku: "C", name: "Mid", quantity: 0, priceCents: 999 },
  ]);

test("totalValue sums quantity times price", () => {
  assert.equal(inv().totalValue(), 2 * 100 + 10 * 50);
  assert.equal(new Inventory([]).totalValue(), 0);
});

test("lowStock returns a filtered Inventory", () => {
  const low = inv().lowStock(3);
  assert.ok(low instanceof Inventory);
  assert.deepEqual(low.items.map((i) => i.sku).sort(), ["A", "C"]);
  assert.equal(inv().lowStock(0).items.length, 0);
});

test("text format stays the default and unchanged", () => {
  const { code, output } = run([CSV]);
  assert.equal(code, 0);
  assert.equal(output, textReport(Inventory.fromCSV("sku,name,quantity,price_cents\nA100,Desk lamp,12,2499\nA101,Office chair,3,15900\nB200,Notebook,140,350\nB201,Pen set,0,899\nC300,Monitor stand,7,4550\n")));
  assert.equal(run([CSV, "--format", "text"]).output, output);
});

test("json format", () => {
  const { code, output } = run(["--format", "json", CSV]);
  assert.equal(code, 0);
  assert.equal(output, JSON.stringify(JSON.parse(output), null, 2));
  const report = JSON.parse(output);
  assert.deepEqual(
    report.items.map((i) => i.name),
    ["Desk lamp", "Monitor stand", "Notebook", "Office chair", "Pen set"],
  );
  assert.deepEqual(report.items[0], { sku: "A100", name: "Desk lamp", quantity: 12, priceCents: 2499, valueCents: 29988 });
  assert.equal(report.totalValueCents, 12 * 2499 + 3 * 15900 + 140 * 350 + 0 + 7 * 4550);
});

test("--low filters in json, before or after the file", () => {
  for (const argv of [[CSV, "--format", "json", "--low", "8"], ["--low", "8", "--format", "json", CSV]]) {
    const report = JSON.parse(run(argv).output);
    assert.deepEqual(report.items.map((i) => i.sku), ["C300", "A101", "B201"]);
    assert.equal(report.totalValueCents, 7 * 4550 + 3 * 15900);
  }
});

test("--low filters the text report", () => {
  const { code, output } = run([CSV, "--low", "4"]);
  assert.equal(code, 0);
  const lines = output.split("\n");
  assert.equal(lines.length, 2);
  assert.ok(lines[0].startsWith("A101"));
  assert.ok(lines[1].startsWith("B201"));
});

test("bad options return 2 with a usage line", () => {
  for (const argv of [[CSV, "--bogus"], [CSV, "--format", "xml"], [CSV, "--format"], [CSV, "--low", "abc"], [CSV, "--low", "-1"], [CSV, "--low"]]) {
    const { code, output } = run(argv);
    assert.equal(code, 2, `exit code for ${argv.slice(1).join(" ")}`);
    assert.ok(output.split("\n").some((l) => l.startsWith("Usage:")), `usage line for ${argv.slice(1).join(" ")}`);
  }
});

test("missing file still returns 1", () => {
  assert.equal(run([]).code, 1);
});
