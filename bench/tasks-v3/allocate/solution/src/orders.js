import { Inventory } from "./inventory.js";

const isName = (v) => typeof v === "string" && v !== "";

function validOrder(o) {
  return (
    !!o &&
    typeof o === "object" &&
    isName(o.id) &&
    (o.priority === undefined || (Number.isInteger(o.priority) && o.priority >= 0)) &&
    Array.isArray(o.lines) &&
    o.lines.length > 0 &&
    o.lines.every((l) => !!l && typeof l === "object" && isName(l.sku) && Number.isInteger(l.quantity) && l.quantity > 0)
  );
}

/** Reads orders from JSON text */
export function parseOrders(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new SyntaxError(`Invalid JSON: ${err.message}`);
  }
  if (!Array.isArray(data)) throw new TypeError("Orders must be a list");
  const bad = data.findIndex((o) => !validOrder(o));
  if (bad >= 0) throw new TypeError(`Invalid order at index ${bad}`);
  return data.map((o) => ({ id: o.id, priority: o.priority ?? 5, lines: o.lines.map((l) => ({ sku: l.sku, quantity: l.quantity })) }));
}

/** Takes what each line can get from `stock` (changed in place); returns the allocated and missing lists */
function take(stock, lines) {
  const allocated = [];
  const missing = [];
  for (const { sku, quantity } of lines) {
    const got = Math.min(quantity, stock.get(sku));
    stock.set(sku, stock.get(sku) - got);
    if (got > 0) allocated.push({ sku, quantity: got });
    if (quantity > got) missing.push({ sku, quantity: quantity - got });
  }
  return { allocated, missing };
}

/** Reserves stock for the orders, lowest priority number first */
export function allocate(inventory, orders, options = {}) {
  const stock = new Map(inventory.items.map((i) => [i.sku, i.quantity]));
  const results = new Array(orders.length);
  const queue = orders.map((order, index) => ({ order, index })).sort((a, b) => (a.order.priority ?? 5) - (b.order.priority ?? 5) || a.index - b.index);
  for (const { order, index } of queue) {
    const unknown = order.lines.find((l) => !stock.has(l.sku));
    if (unknown) {
      results[index] = { id: order.id, status: "rejected", allocated: [], missing: [], reason: `Unknown SKU ${unknown.sku}` };
      continue;
    }
    if (options.partial) {
      const { allocated, missing } = take(stock, order.lines);
      const status = !missing.length ? "filled" : allocated.length ? "partial" : "backordered";
      results[index] = { id: order.id, status, allocated, missing };
      continue;
    }
    const trial = new Map(stock);
    const { allocated, missing } = take(trial, order.lines);
    if (missing.length) {
      results[index] = { id: order.id, status: "backordered", allocated: [], missing };
    } else {
      for (const [sku, q] of trial) stock.set(sku, q);
      results[index] = { id: order.id, status: "filled", allocated, missing: [] };
    }
  }
  const left = new Inventory(inventory.items.map((i) => ({ ...i, quantity: stock.get(i.sku) })));
  return { inventory: left, results };
}
