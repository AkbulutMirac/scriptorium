import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCSV, parseRecords } from "../../src/csv.js";
import { Inventory } from "../../src/inventory.js";

test("simple rows still work", () => {
  assert.deepEqual(parseCSV("a,b,c\n1,2,3\n"), [["a", "b", "c"], ["1", "2", "3"]]);
});

test("unquoted cells are trimmed", () => {
  assert.deepEqual(parseCSV(" a , b \n"), [["a", "b"]]);
});

test("quoted field with a comma", () => {
  assert.deepEqual(parseCSV('sku,name\nA1,"Desk lamp, large"\n'), [["sku", "name"], ["A1", "Desk lamp, large"]]);
});

test("doubled quotes become one quote", () => {
  assert.deepEqual(parseCSV('a,"say ""hi"""\n'), [["a", 'say "hi"']]);
  assert.deepEqual(parseCSV('""""\n'), [['"']]);
});

test("quoted field with a line break", () => {
  assert.deepEqual(parseCSV('a,"line one\nline two",c\nd,e,f\n'), [["a", "line one\nline two", "c"], ["d", "e", "f"]]);
});

test("CRLF line endings", () => {
  assert.deepEqual(parseCSV("a,b\r\n1,2\r\n"), [["a", "b"], ["1", "2"]]);
  assert.deepEqual(parseCSV('a,"x\r\ny"\r\n'), [["a", "x\r\ny"]]);
});

test("quoted content is not trimmed", () => {
  assert.deepEqual(parseCSV('"  padded  ",b\n'), [["  padded  ", "b"]]);
});

test("empty fields stay empty", () => {
  assert.deepEqual(parseCSV("a,,c\n,,\n"), [["a", "", "c"], ["", "", ""]]);
  assert.deepEqual(parseCSV('a,"",c\n'), [["a", "", "c"]]);
});

test("blank lines are skipped and no trailing newline is needed", () => {
  assert.deepEqual(parseCSV("a,b\n\n1,2"), [["a", "b"], ["1", "2"]]);
});

test("parseRecords uses the fixed parser", () => {
  assert.deepEqual(parseRecords('sku,name\r\nA1,"Lamp, big"\r\n'), [{ sku: "A1", name: "Lamp, big" }]);
});

test("Inventory.fromCSV with quoted names and CRLF", () => {
  const inv = Inventory.fromCSV('sku,name,quantity,price_cents\r\nA1,"Chair, ""ergo""",2,15900\r\nB2,Pen,10,99\r\n');
  assert.equal(inv.items.length, 2);
  assert.deepEqual(inv.find("A1"), { sku: "A1", name: 'Chair, "ergo"', quantity: 2, priceCents: 15900 });
  assert.equal(inv.find("B2").priceCents, 99);
});
