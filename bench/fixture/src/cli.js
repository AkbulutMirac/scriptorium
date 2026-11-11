#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { Inventory } from "./inventory.js";
import { textReport } from "./report.js";

/**
 * Usage: stockroom <file.csv>
 * Prints a stock report for the inventory in the CSV file.
 */
export function main(argv, out = console.log) {
  const file = argv[0];
  if (!file) {
    out("Usage: stockroom <file.csv>");
    return 1;
  }
  const inventory = Inventory.fromCSV(readFileSync(file, "utf8"));
  out(textReport(inventory));
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("cli.js")) {
  process.exitCode = main(process.argv.slice(2));
}
