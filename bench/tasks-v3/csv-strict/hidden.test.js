import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { main } from "../../src/cli.js";
import { parseCSV, parseRows } from "../../src/csv.js";
import { Inventory } from "../../src/inventory.js";
import { textReport } from "../../src/report.js";

const STOCK = fileURLToPath(new URL("../../data/stock.csv", import.meta.url));
const dir = mkdtempSync(path.join(tmpdir(), "csv-strict-"));
let n = 0;
function file(text) {
  const f = path.join(dir, `f${n++}.csv`);
  writeFileSync(f, text);
  return f;
}
function run(argv) {
  const lines = [];
  const code = main(argv, (s) => lines.push(String(s)));
  return { code, output: lines.join("\n") };
}
const HEADER = "sku,name,quantity,price_cents";

test("unquoted fields are trimmed and blank lines skipped", () => {
  assert.deepEqual(parseCSV("a, b ,c\n\n   \n d,e,f\n"), [["a", "b", "c"], ["d", "e", "f"]]);
});

test("quoted fields keep commas and their exact inner text", () => {
  assert.deepEqual(parseCSV('x,"a, b",y'), [["x", "a, b", "y"]]);
  assert.deepEqual(parseCSV('  " a "  ,b'), [[" a ", "b"]]);
});

test("doubled quotes inside quotes are one quote", () => {
  assert.deepEqual(parseCSV('"He said ""hi""",z'), [['He said "hi"', "z"]]);
});

test("a quote inside an unquoted field is an ordinary character", () => {
  assert.deepEqual(parseCSV('5" ruler,1'), [['5" ruler', "1"]]);
});

test("line breaks inside quotes belong to the value", () => {
  assert.deepEqual(parseCSV('a,"line1\nline2"\nb,c'), [["a", "line1\nline2"], ["b", "c"]]);
});

test("CRLF line endings", () => {
  assert.deepEqual(parseCSV("a,b\r\nc,d\r\n"), [["a", "b"], ["c", "d"]]);
  assert.deepEqual(parseCSV('"a","b"\r\nc,d'), [["a", "b"], ["c", "d"]]);
});

test("empty quoted field and trailing comma", () => {
  assert.deepEqual(parseCSV('"",x,'), [["", "x", ""]]);
});

test("parseRows reports the line each record starts on", () => {
  assert.deepEqual(parseRows('h1,h2\n\n"a\nb",c\nd,e'), [
    { line: 1, cells: ["h1", "h2"] },
    { line: 3, cells: ["a\nb", "c"] },
    { line: 5, cells: ["d", "e"] },
  ]);
});

test("unterminated quote", () => {
  assert.throws(() => parseRows('a,b\nc,"oops\nd,e'), (err) => err instanceof SyntaxError && err.message === "Unterminated quote on line 2");
});

test("unexpected character after a closing quote", () => {
  assert.throws(() => parseRows('a\n"x"y,z'), (err) => err instanceof SyntaxError && err.message === "Unexpected character after quote on line 2");
  assert.throws(() => parseRows('a\n"x\ny" q'), (err) => err instanceof SyntaxError && err.message === "Unexpected character after quote on line 3");
});

test("fromCSV loads quoted names", () => {
  const inv = Inventory.fromCSV(`${HEADER}\nA1,"Lamp, desk",2,100\n`);
  assert.deepEqual(inv.items, [{ sku: "A1", name: "Lamp, desk", quantity: 2, priceCents: 100 }]);
});

test("validateCSV accepts columns in any order and ignores extra ones", () => {
  const { inventory, errors } = Inventory.validateCSV("name,extra,sku,price_cents,quantity\nLamp,x,A1,100,2\n");
  assert.deepEqual(errors, []);
  assert.ok(inventory instanceof Inventory);
  assert.deepEqual(inventory.items, [{ sku: "A1", name: "Lamp", quantity: 2, priceCents: 100 }]);
});

test("validateCSV reports missing columns", () => {
  const { inventory, errors } = Inventory.validateCSV("\nsku,qty,price_cents\nA,1,2\n");
  assert.deepEqual(errors, [
    { line: 2, message: "Missing column name" },
    { line: 2, message: "Missing column quantity" },
  ]);
  assert.deepEqual(inventory.items, []);
  assert.equal(Inventory.validateCSV("").errors.length, 4);
  assert.deepEqual(Inventory.validateCSV("").errors[0], { line: 1, message: "Missing column sku" });
});

test("validateCSV reports the first problem of each record", () => {
  const text = [
    HEADER,
    "A1,Lamp,2,100",
    "A2,Chair,1",
    ",Thing,1,1",
    "A3,,1,1",
    "A4,Pen,-1,1",
    "A5,Pen,1.5,1",
    "A6,Pen,1,9.99",
    "A1,Lamp again,1,1",
    "A7,Mug,0,0",
    ",,x,y",
    "A8,Cup,1,1,extra",
  ].join("\n");
  const { inventory, errors } = Inventory.validateCSV(text);
  assert.deepEqual(errors, [
    { line: 3, message: "Wrong number of columns" },
    { line: 4, message: "Missing SKU" },
    { line: 5, message: "Missing name" },
    { line: 6, message: "Invalid quantity" },
    { line: 7, message: "Invalid quantity" },
    { line: 8, message: "Invalid price" },
    { line: 9, message: "Duplicate SKU A1" },
    { line: 11, message: "Missing SKU" },
    { line: 12, message: "Wrong number of columns" },
  ]);
  assert.deepEqual(inventory.items, [
    { sku: "A1", name: "Lamp", quantity: 2, priceCents: 100 },
    { sku: "A7", name: "Mug", quantity: 0, priceCents: 0 },
  ]);
});

test("a duplicate only counts against earlier valid records", () => {
  const { inventory, errors } = Inventory.validateCSV(`${HEADER}\nB1,X,1,1x\nB1,Y,1,1\n`);
  assert.deepEqual(errors, [{ line: 2, message: "Invalid price" }]);
  assert.deepEqual(inventory.items, [{ sku: "B1", name: "Y", quantity: 1, priceCents: 1 }]);
});

test("validateCSV uses the record's start line and lets syntax errors through", () => {
  const { errors } = Inventory.validateCSV(`${HEADER}\nA1,"Two\nlines",x,1\n`);
  assert.deepEqual(errors, [{ line: 2, message: "Invalid quantity" }]);
  assert.throws(() => Inventory.validateCSV(`${HEADER}\nA1,"open,1,1\n`), SyntaxError);
});

test("check: a valid file", () => {
  const r = run(["check", file(`${HEADER}\r\nA1,"Lamp, desk",2,100\r\nA2,Chair,1,5\r\n`)]);
  assert.equal(r.code, 0);
  assert.equal(r.output, "OK: 2 items");
});

test("check: errors", () => {
  const r = run(["check", file(`${HEADER}\nA1,Lamp,2,100\n,Thing,1,1\nA1,Again,1,1\n`)]);
  assert.equal(r.code, 3);
  assert.equal(r.output, "Line 3: Missing SKU\nLine 4: Duplicate SKU A1");
});

test("check: usage and syntax errors", () => {
  const usage = run(["check"]);
  assert.equal(usage.code, 1);
  assert.match(usage.output, /^Usage:/);
  const bad = run(["check", file(`${HEADER}\nA1,"open,1,1\n`)]);
  assert.equal(bad.code, 2);
  assert.equal(bad.output, "Error: Unterminated quote on line 2");
});

test("plain report keeps working and handles quotes and syntax errors", () => {
  const plain = run([STOCK]);
  assert.equal(plain.code, 0);
  assert.equal(plain.output, textReport(Inventory.fromCSV(readFileSync(STOCK, "utf8"))));
  const quoted = run([file(`${HEADER}\nA1,"Lamp, desk",2,100\n`)]);
  assert.equal(quoted.code, 0);
  assert.match(quoted.output, /Lamp, desk/);
  const bad = run([file(`${HEADER}\nA1,"x"y,1,1\n`)]);
  assert.equal(bad.code, 2);
  assert.equal(bad.output, "Error: Unexpected character after quote on line 2");
  assert.match(run([]).output, /^Usage:/);
});
