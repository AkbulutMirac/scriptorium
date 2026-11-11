import { formatMoney } from "./money.js";

/** Plain-text stock report: one line per item, sorted by name */
export function textReport(inventory) {
  const lines = inventory.sorted().map((i) => `${i.sku.padEnd(8)} ${i.name.padEnd(24)} ${String(i.quantity).padStart(5)}  ${formatMoney(i.priceCents)}`);
  return lines.join("\n");
}
