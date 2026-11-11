import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { main } from "../../src/cli.js";
import { Inventory } from "../../src/inventory.js";
import { markdownReport, textReport } from "../../src/report.js";

const CSV = fileURLToPath(new URL("../../data/stock.csv", import.meta.url));
const HEAD = "| SKU | Name | Qty | Price | Value |\n|:----|:-----|----:|------:|------:|";

function run(argv) {
  const lines = [];
  const code = main(argv, (s) => lines.push(String(s)));
  return { code, output: lines.join("\n") };
}

test("single table sorted by name with a total row", () => {
  const inv = new Inventory([
    { sku: "B2", name: "Zebra", quantity: 2, priceCents: 150 },
    { sku: "A1", name: "Apple", quantity: 10, priceCents: 99 },
  ]);
  assert.equal(
    markdownReport(inv),
    `${HEAD}\n| A1 | Apple | 10 | $0.99 | $9.90 |\n| B2 | Zebra | 2 | $1.50 | $3.00 |\n| **Total** | | **12** | | **$12.90** |`,
  );
});

test("empty inventory", () => {
  assert.equal(markdownReport(new Inventory([])), `${HEAD}\n| **Total** | | **0** | | **$0.00** |`);
  assert.equal(markdownReport(new Inventory([]), { groupBy: "prefix" }), "**Grand total:** $0.00");
});

test("escapes pipes and backslashes", () => {
  const inv = new Inventory([{ sku: "X|1", name: "a|b\\c", quantity: 1, priceCents: 100 }]);
  assert.ok(markdownReport(inv).includes("| X\\|1 | a\\|b\\\\c | 1 | $1.00 | $1.00 |"));
});

test("large values use thousands separators", () => {
  const inv = new Inventory([{ sku: "Z9", name: "Gold", quantity: 1000, priceCents: 123456 }]);
  assert.ok(markdownReport(inv).includes("| Z9 | Gold | 1000 | $1,234.56 | $1,234,560.00 |"));
});

test("grouped by prefix", () => {
  const inv = new Inventory([
    { sku: "B200", name: "Notebook", quantity: 4, priceCents: 350 },
    { sku: "A101", name: "Office chair", quantity: 1, priceCents: 15900 },
    { sku: "A100", name: "Desk lamp", quantity: 2, priceCents: 2499 },
    { sku: "MISC", name: "Box", quantity: 3, priceCents: 100 },
  ]);
  const expected = [
    "## A",
    "",
    HEAD,
    "| A100 | Desk lamp | 2 | $24.99 | $49.98 |",
    "| A101 | Office chair | 1 | $159.00 | $159.00 |",
    "| **Subtotal** | | **3** | | **$208.98** |",
    "",
    "## B",
    "",
    HEAD,
    "| B200 | Notebook | 4 | $3.50 | $14.00 |",
    "| **Subtotal** | | **4** | | **$14.00** |",
    "",
    "## MISC",
    "",
    HEAD,
    "| MISC | Box | 3 | $1.00 | $3.00 |",
    "| **Subtotal** | | **3** | | **$3.00** |",
    "",
    "**Grand total:** $225.98",
  ].join("\n");
  assert.equal(markdownReport(inv, { groupBy: "prefix" }), expected);
});

test("multi-letter prefixes", () => {
  const inv = new Inventory([
    { sku: "AB1", name: "x", quantity: 1, priceCents: 1 },
    { sku: "A2", name: "y", quantity: 1, priceCents: 1 },
  ]);
  const out = markdownReport(inv, { groupBy: "prefix" });
  assert.ok(out.indexOf("## A\n") < out.indexOf("## AB\n"));
  assert.ok(out.startsWith("## A\n"));
});

test("CLI markdown output", () => {
  const { code, output } = run(["--format", "md", CSV]);
  assert.equal(code, 0);
  assert.equal(output, markdownReport(Inventory.fromCSV("sku,name,quantity,price_cents\nA100,Desk lamp,12,2499\nA101,Office chair,3,15900\nB200,Notebook,140,350\nB201,Pen set,0,899\nC300,Monitor stand,7,4550\n")));
  const grouped = run([CSV, "--group", "prefix", "--format", "md"]);
  assert.equal(grouped.code, 0);
  assert.ok(grouped.output.startsWith("## A\n"));
  assert.ok(grouped.output.endsWith("**Grand total:** $1,585.38"));
});

test("CLI text output is unchanged", () => {
  const plain = run([CSV]);
  assert.equal(plain.code, 0);
  assert.equal(run([CSV, "--format", "text"]).output, plain.output);
  assert.equal(plain.output, textReport(Inventory.fromCSV("sku,name,quantity,price_cents\nA100,Desk lamp,12,2499\nA101,Office chair,3,15900\nB200,Notebook,140,350\nB201,Pen set,0,899\nC300,Monitor stand,7,4550\n")));
});

test("CLI usage errors", () => {
  for (const argv of [[CSV, "--format", "html"], [CSV, "--format"], [CSV, "--group", "prefix"], [CSV, "--format", "md", "--group", "sku"], [CSV, "--nope"]]) {
    const { code, output } = run(argv);
    assert.equal(code, 2, argv.slice(1).join(" "));
    assert.ok(output.split("\n").some((l) => l.startsWith("Usage:")), argv.slice(1).join(" "));
  }
  assert.equal(run([]).code, 1);
});
