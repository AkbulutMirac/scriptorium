import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { main } from "../../src/cli.js";
import { compileFilter } from "../../src/filter.js";

const CSV = fileURLToPath(new URL("../../data/stock.csv", import.meta.url));
const ITEMS = [
  { sku: "A100", name: "Desk lamp", quantity: 12, priceCents: 2499 },
  { sku: "A101", name: "Office chair", quantity: 3, priceCents: 15900 },
  { sku: "B200", name: "Notebook", quantity: 140, priceCents: 350 },
  { sku: "B201", name: "Pen set", quantity: 0, priceCents: 899 },
  { sku: "C300", name: "Monitor stand", quantity: 7, priceCents: 4550 },
];
const pick = (expr) => ITEMS.filter(compileFilter(expr)).map((i) => i.sku);

function run(argv) {
  const lines = [];
  const code = main(argv, (s) => lines.push(String(s)));
  return { code, output: lines.join("\n") };
}

test("number comparisons", () => {
  assert.deepEqual(pick("quantity < 5"), ["A101", "B201"]);
  assert.deepEqual(pick("quantity <= 3"), ["A101", "B201"]);
  assert.deepEqual(pick("quantity > 100"), ["B200"]);
  assert.deepEqual(pick("quantity >= 12"), ["A100", "B200"]);
  assert.deepEqual(pick("quantity = 0"), ["B201"]);
  assert.deepEqual(pick("price_cents != 350"), ["A100", "A101", "B201", "C300"]);
});

test("string comparisons", () => {
  assert.deepEqual(pick('sku = "B200"'), ["B200"]);
  assert.deepEqual(pick('sku = "b200"'), []);
  assert.deepEqual(pick('name != "Notebook"'), ["A100", "A101", "B201", "C300"]);
  assert.deepEqual(pick('name ~ "LAMP"'), ["A100"]);
  assert.deepEqual(pick('name ~ "o"'), ["A101", "B200", "C300"]);
});

test("and binds tighter than or, parentheses override", () => {
  assert.deepEqual(pick('quantity < 5 and name ~ "pen" or sku = "A100"'), ["A100", "B201"]);
  assert.deepEqual(pick('quantity < 5 and (name ~ "pen" or sku = "A101")'), ["A101", "B201"]);
  assert.deepEqual(pick('quantity < 5 and (name ~ "lamp" or price_cents >= 1000)'), ["A101"]);
});

test("not, nesting and case-insensitive keywords", () => {
  assert.deepEqual(pick("not quantity > 5"), ["A101", "B201"]);
  assert.deepEqual(pick("NOT NOT quantity = 0"), ["B201"]);
  assert.deepEqual(pick('not (sku ~ "a" Or sku ~ "b")'), ["C300"]);
  assert.deepEqual(pick("((quantity = 7))"), ["C300"]);
});

test("whitespace is optional between tokens", () => {
  assert.deepEqual(pick('quantity<5 and(name~"pen")'), ["B201"]);
});

test("string escapes", () => {
  const f = compileFilter('name = "say \\"hi\\" \\\\ bye"');
  assert.equal(f({ sku: "X", name: 'say "hi" \\ bye', quantity: 1, priceCents: 1 }), true);
  assert.equal(f({ sku: "X", name: "say hi bye", quantity: 1, priceCents: 1 }), false);
});

test("syntax errors report the position", () => {
  const cases = [
    ["quantity <", 10],
    ["quantity < 5 and", 16],
    ["(quantity < 5", 13],
    ["quantity < 5)", 12],
    ["colour = 3", 0],
    ['name ~ "open', 7],
    ["quantity # 5", 9],
    ["quantity < 5 5", 13],
    ["", 0],
  ];
  for (const [expr, pos] of cases) {
    assert.throws(
      () => compileFilter(expr),
      (err) => err instanceof SyntaxError && err.message.endsWith(`at position ${pos}`),
      `${JSON.stringify(expr)} should fail at ${pos}`,
    );
  }
});

test("type errors", () => {
  for (const expr of ['quantity = "5"', 'price_cents ~ "1"', "name = 5", 'name < "b"', 'sku >= "A"', "quantity ~ 5"]) {
    assert.throws(() => compileFilter(expr), TypeError, expr);
  }
});

test("the returned function does not throw", () => {
  const f = compileFilter('name ~ "x"');
  assert.equal(f({ sku: "", name: "", quantity: 0, priceCents: 0 }), false);
});

test("CLI --where", () => {
  const { code, output } = run([CSV, "--where", "quantity < 5"]);
  assert.equal(code, 0);
  const lines = output.split("\n");
  assert.equal(lines.length, 2);
  assert.ok(lines[0].startsWith("A101"));
  assert.ok(lines[1].startsWith("B201"));
  const before = run(["--where", 'name ~ "lamp"', CSV]);
  assert.equal(before.code, 0);
  assert.ok(before.output.startsWith("A100"));
  assert.equal(before.output.split("\n").length, 1);
});

test("CLI reports bad expressions", () => {
  for (const argv of [[CSV, "--where", "quantity <"], [CSV, "--where", "name > 3"], [CSV, "--where"]]) {
    const { code, output } = run(argv);
    assert.equal(code, 2, argv.join(" "));
    assert.ok(output.split("\n").some((l) => l.startsWith("Error:")), argv.join(" "));
  }
  assert.equal(run([CSV]).code, 0);
});
