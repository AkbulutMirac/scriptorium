#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { Inventory } from "./inventory.js";
import { textReport } from "./report.js";

/**
 * Usage: stockroom <file.csv>
 *        stockroom check <file.csv>
 */
export function main(argv, out = console.log) {
  try {
    if (argv[0] === "check") {
      if (!argv[1]) {
        out("Usage: stockroom check <file.csv>");
        return 1;
      }
      const { inventory, errors } = Inventory.validateCSV(readFileSync(argv[1], "utf8"));
      if (!errors.length) {
        out(`OK: ${inventory.items.length} items`);
        return 0;
      }
      for (const e of errors) out(`Line ${e.line}: ${e.message}`);
      return 3;
    }
    const file = argv[0];
    if (!file) {
      out("Usage: stockroom <file.csv>");
      return 1;
    }
    const inventory = Inventory.fromCSV(readFileSync(file, "utf8"));
    out(textReport(inventory));
    return 0;
  } catch (err) {
    if (!(err instanceof SyntaxError)) throw err;
    out(`Error: ${err.message}`);
    return 2;
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("cli.js")) {
  process.exitCode = main(process.argv.slice(2));
}
