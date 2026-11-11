#!/usr/bin/env node
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { safeExportPath, toCSV } from "./export.js";
import { Inventory } from "./inventory.js";
import { textReport } from "./report.js";

function exportCommand(args, out, cwd) {
  const force = args.includes("--force");
  const rest = args.filter((a) => a !== "--force");
  if (rest.length !== 2 || rest.some((a) => a.startsWith("--"))) {
    out("Usage: stockroom export <stock.csv> <name> [--force]");
    return 1;
  }
  const [file, name] = rest;
  let target;
  try {
    target = safeExportPath(cwd, name);
  } catch (err) {
    out(`Error: ${err.message}`);
    return 2;
  }
  const dir = path.dirname(target);
  let stat;
  try {
    stat = lstatSync(dir);
  } catch {
    stat = undefined;
  }
  if (stat && !stat.isDirectory()) {
    out("Error: exports is not a directory");
    return 2;
  }
  if (!stat) mkdirSync(dir);
  if (existsSync(target) && !force) {
    out(`Error: exports/${name} already exists`);
    return 3;
  }
  const inventory = Inventory.fromCSV(readFileSync(path.resolve(cwd, file), "utf8"));
  writeFileSync(target, toCSV(inventory));
  out(`Wrote exports/${name}`);
  return 0;
}

/**
 * Usage: stockroom <file.csv>
 *        stockroom export <stock.csv> <name> [--force]
 */
export function main(argv, out = console.log, cwd = process.cwd()) {
  if (argv[0] === "export") return exportCommand(argv.slice(1), out, cwd);
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
