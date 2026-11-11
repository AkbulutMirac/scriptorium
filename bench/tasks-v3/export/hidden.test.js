import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { main } from "../../src/cli.js";
import { safeExportPath, toCSV } from "../../src/export.js";
import { Inventory } from "../../src/inventory.js";
import { textReport } from "../../src/report.js";

const STOCK = fileURLToPath(new URL("../../data/stock.csv", import.meta.url));
const fresh = () => mkdtempSync(path.join(tmpdir(), "export-"));
function run(argv, cwd) {
  const lines = [];
  const code = main(argv, (s) => lines.push(String(s)), cwd);
  return { code, output: lines.join("\n") };
}
const item = (sku, name, quantity = 1, priceCents = 100) => ({ sku, name, quantity, priceCents });
const csvOf = (...items) => toCSV(new Inventory(items)).split("\n").slice(1, -1);

test("safeExportPath returns exports/<name> inside the base folder", () => {
  const base = fresh();
  assert.equal(safeExportPath(base, "stock-2026_01.csv"), path.join(path.resolve(base), "exports", "stock-2026_01.csv"));
  assert.equal(safeExportPath(".", "a.csv"), path.join(path.resolve("."), "exports", "a.csv"));
});

test("safeExportPath accepts edge cases that are still safe", () => {
  for (const name of ["a.csv", `${"x".repeat(60)}.csv`, "nul1.csv", "com0.csv", "a..csv", "CONSOLE.csv", "_x.csv", "-x.csv", "report.v2.csv"]) {
    assert.doesNotThrow(() => safeExportPath(".", name), name);
  }
});

test("safeExportPath rejects names that could escape or misbehave", () => {
  const bad = [
    "../x.csv", "..\\x.csv", "a/b.csv", "a\\b.csv", "/abs.csv", "C:\\x.csv", "C:x.csv", ".hidden.csv", ".csv", "x.txt", "x", "",
    "a b.csv", "x.CSV", "x.csv ", "é.csv", "CON.csv", "con.backup.csv", "Lpt9.csv", "aux.csv", "COM1.csv", `${"x".repeat(61)}.csv`, "x.csv\u0000", undefined, 5,
  ];
  for (const name of bad) {
    assert.throws(() => safeExportPath(".", name), (err) => err instanceof Error && err.message === "Invalid export name", String(name));
  }
});

test("toCSV writes a header and one line per item, each ending in a newline", () => {
  const text = toCSV(new Inventory([item("B2", "Pen", 0, 899), item("A1", "Lamp", 12, 2499)]));
  assert.equal(text, "sku,name,quantity,price_cents\nB2,Pen,0,899\nA1,Lamp,12,2499\n");
  assert.equal(toCSV(new Inventory([])), "sku,name,quantity,price_cents\n");
});

test("toCSV quotes commas, quotes and line breaks", () => {
  assert.deepEqual(csvOf(item("A1", "Lamp, desk"), item("A2", 'The "best" pen'), item("A3", "two\nlines"), item("A4", "cr\rhere")), [
    'A1,"Lamp, desk",1,100',
    'A2,"The ""best"" pen",1,100',
    'A3,"two',
    'lines",1,100',
    'A4,"cr\rhere",1,100',
  ]);
});

test("toCSV defuses spreadsheet formulas in text cells", () => {
  assert.deepEqual(csvOf(item("A1", "=SUM(A1:A9)"), item("A2", "+1"), item("-5", "@cmd"), item("A4", "\tx"), item("A5", "=a,b"), item("A6", 'x=1'), item("A7", "\rcalc")), [
    "A1,'=SUM(A1:A9),1,100",
    "A2,'+1,1,100",
    "'-5,'@cmd,1,100",
    "A4,'\tx,1,100",
    `A5,"'=a,b",1,100`,
    "A6,x=1,1,100",
    `A7,"'\rcalc",1,100`,
  ]);
  assert.deepEqual(csvOf(item("A1", "Mug", -3, -100)), ["A1,Mug,-3,-100"]);
});

test("export writes the CSV and creates the folder", () => {
  const cwd = fresh();
  const r = run(["export", STOCK, "out.csv"], cwd);
  assert.equal(r.code, 0);
  assert.equal(r.output, "Wrote exports/out.csv");
  assert.equal(readFileSync(path.join(cwd, "exports", "out.csv"), "utf8"), toCSV(Inventory.fromCSV(readFileSync(STOCK, "utf8"))));
  const again = run(["export", STOCK, "second.csv"], cwd);
  assert.equal(again.code, 0);
  assert.deepEqual(readdirSync(path.join(cwd, "exports")).sort(), ["out.csv", "second.csv"]);
});

test("export reads the stock file relative to the working folder", () => {
  const cwd = fresh();
  writeFileSync(path.join(cwd, "s.csv"), "sku,name,quantity,price_cents\nZ1,=evil,1,1\n");
  assert.equal(run(["export", "s.csv", "z.csv"], cwd).code, 0);
  assert.equal(readFileSync(path.join(cwd, "exports", "z.csv"), "utf8"), "sku,name,quantity,price_cents\nZ1,'=evil,1,1\n");
});

test("export keeps an existing file unless --force is given", () => {
  const cwd = fresh();
  mkdirSync(path.join(cwd, "exports"));
  writeFileSync(path.join(cwd, "exports", "out.csv"), "old");
  const r = run(["export", STOCK, "out.csv"], cwd);
  assert.equal(r.code, 3);
  assert.equal(r.output, "Error: exports/out.csv already exists");
  assert.equal(readFileSync(path.join(cwd, "exports", "out.csv"), "utf8"), "old");
  for (const argv of [["export", "--force", STOCK, "out.csv"], ["export", STOCK, "out.csv", "--force"]]) {
    writeFileSync(path.join(cwd, "exports", "out.csv"), "old");
    const forced = run(argv, cwd);
    assert.equal(forced.code, 0);
    assert.notEqual(readFileSync(path.join(cwd, "exports", "out.csv"), "utf8"), "old");
  }
});

test("export rejects a bad name before creating anything", () => {
  for (const name of ["../escape.csv", "sub/x.csv", "CON.csv", "x.txt"]) {
    const cwd = fresh();
    const r = run(["export", STOCK, name], cwd);
    assert.equal(r.code, 2, name);
    assert.equal(r.output, "Error: Invalid export name");
    assert.deepEqual(readdirSync(cwd), [], name);
  }
  assert.ok(!existsSync(path.join(path.dirname(fresh()), "escape.csv")));
});

test("export refuses when exports is not a plain directory", () => {
  const asFile = fresh();
  writeFileSync(path.join(asFile, "exports"), "a file");
  const r = run(["export", STOCK, "out.csv"], asFile);
  assert.equal(r.code, 2);
  assert.equal(r.output, "Error: exports is not a directory");

  const cwd = fresh();
  const elsewhere = fresh();
  symlinkSync(elsewhere, path.join(cwd, "exports"), "junction");
  const linked = run(["export", STOCK, "out.csv"], cwd);
  assert.equal(linked.code, 2);
  assert.equal(linked.output, "Error: exports is not a directory");
  assert.deepEqual(readdirSync(elsewhere), []);
});

test("export usage errors", () => {
  const cwd = fresh();
  for (const argv of [["export"], ["export", STOCK], ["export", STOCK, "a.csv", "extra"], ["export", STOCK, "a.csv", "--zip"], ["export", "--overwrite", STOCK, "a.csv"]]) {
    const r = run(argv, cwd);
    assert.equal(r.code, 1, JSON.stringify(argv));
    assert.match(r.output, /^Usage:/);
  }
  assert.deepEqual(readdirSync(cwd), []);
});

test("the plain report keeps working", () => {
  const lines = [];
  assert.equal(main([STOCK], (s) => lines.push(String(s))), 0);
  assert.equal(lines.join("\n"), textReport(Inventory.fromCSV(readFileSync(STOCK, "utf8"))));
});
