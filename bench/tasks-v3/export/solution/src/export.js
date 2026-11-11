import path from "node:path";

const NAME = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,63}$/;
const DEVICE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** exports/<name> inside baseDir, for a name that can't leave the folder or hit a Windows device */
export function safeExportPath(baseDir, name) {
  const ok = typeof name === "string" && NAME.test(name) && name.endsWith(".csv") && name.length > 4 && !DEVICE.test(name.split(".")[0]);
  if (!ok) throw new Error("Invalid export name");
  return path.join(path.resolve(baseDir), "exports", name);
}

const FORMULA = /^[=+\-@\t\r]/;

function textCell(value) {
  let s = String(value);
  if (FORMULA.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

/** The inventory as CSV, safe to open in a spreadsheet */
export function toCSV(inventory) {
  const lines = ["sku,name,quantity,price_cents", ...inventory.items.map((i) => [textCell(i.sku), textCell(i.name), i.quantity, i.priceCents].join(","))];
  return lines.map((l) => `${l}\n`).join("");
}
