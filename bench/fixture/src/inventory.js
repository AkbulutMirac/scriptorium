import { parseRecords } from "./csv.js";

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

  find(sku) {
    return this.items.find((i) => i.sku === sku);
  }

  /** Items sorted by name */
  sorted() {
    return [...this.items].sort((a, b) => a.name.localeCompare(b.name));
  }
}
