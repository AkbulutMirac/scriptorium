import { parseRecords, parseRows } from "./csv.js";

const COLUMNS = ["sku", "name", "quantity", "price_cents"];
const DIGITS = /^\d+$/;

/**
 * An inventory loaded from CSV with the columns sku, name, quantity, price_cents.
 */
export class Inventory {
  constructor(items = []) {
    this.items = items;
  }

  static fromCSV(text) {
    const items = parseRecords(text).map((r) => ({
      sku: r.sku,
      name: r.name,
      quantity: Number(r.quantity),
      priceCents: Number(r.price_cents),
    }));
    return new Inventory(items);
  }

  /** Loads only the valid records and reports the others as { line, message } */
  static validateCSV(text) {
    const [header, ...rows] = parseRows(text);
    const names = header?.cells ?? [];
    const missing = COLUMNS.filter((c) => !names.includes(c));
    if (missing.length) {
      return { inventory: new Inventory([]), errors: missing.map((c) => ({ line: header?.line ?? 1, message: `Missing column ${c}` })) };
    }
    const at = Object.fromEntries(COLUMNS.map((c) => [c, names.indexOf(c)]));
    const items = [];
    const errors = [];
    const seen = new Set();
    for (const { line, cells } of rows) {
      const [sku, name, quantity, price] = COLUMNS.map((c) => cells[at[c]]);
      let message;
      if (cells.length !== names.length) message = "Wrong number of columns";
      else if (sku === "") message = "Missing SKU";
      else if (name === "") message = "Missing name";
      else if (!DIGITS.test(quantity)) message = "Invalid quantity";
      else if (!DIGITS.test(price)) message = "Invalid price";
      else if (seen.has(sku)) message = `Duplicate SKU ${sku}`;
      if (message) {
        errors.push({ line, message });
        continue;
      }
      seen.add(sku);
      items.push({ sku, name, quantity: Number(quantity), priceCents: Number(price) });
    }
    return { inventory: new Inventory(items), errors };
  }

  find(sku) {
    return this.items.find((i) => i.sku === sku);
  }

  /** Items sorted by name */
  sorted() {
    return [...this.items].sort((a, b) => a.name.localeCompare(b.name));
  }
}
