#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { Inventory } from "./inventory.js";
import { allocate, parseOrders } from "./orders.js";
import { textReport } from "./report.js";

const ALLOCATE_USAGE = "Usage: stockroom allocate <orders.json> <stock.csv> [--partial]";

function allocateCommand(args, out) {
  const partial = args.includes("--partial");
  const files = args.filter((a) => a !== "--partial");
  if (files.length !== 2 || files.some((a) => a.startsWith("--"))) {
    out(ALLOCATE_USAGE);
    return 1;
  }
  let orders;
  try {
    orders = parseOrders(readFileSync(files[0], "utf8"));
  } catch (err) {
    if (!(err instanceof SyntaxError || err instanceof TypeError)) throw err;
    out(`Error: ${err.message}`);
    return 2;
  }
  const { inventory, results } = allocate(Inventory.fromCSV(readFileSync(files[1], "utf8")), orders, { partial });
  for (const r of results) {
    if (r.status === "filled") out(`${r.id} filled`);
    else if (r.status === "rejected") out(`${r.id} rejected - ${r.reason}`);
    else out(`${r.id} ${r.status} - missing ${r.missing.map((m) => `${m.sku} x${m.quantity}`).join(", ")}`);
  }
  out("");
  out(textReport(inventory));
  return results.every((r) => r.status === "filled") ? 0 : 4;
}

/**
 * Usage: stockroom <file.csv>
 *        stockroom allocate <orders.json> <stock.csv> [--partial]
 */
export function main(argv, out = console.log) {
  if (argv[0] === "allocate") return allocateCommand(argv.slice(1), out);
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
