Add order allocation: read a list of customer orders and reserve stock for them, most urgent first.

1. New module `src/orders.js` exporting:

   `parseOrders(text)` reads JSON: a list of orders, each `{ "id": string, "priority": integer, "lines": [{ "sku": string, "quantity": integer }] }`.
   - `id` and every `sku` are non-empty strings, `lines` has at least one line, every `quantity` is an integer greater than 0, and `priority` is optional: an integer of 0 or more, default `5`.
   - It returns the orders as `{ id, priority, lines: [{ sku, quantity }] }`, with the default priority filled in and any other fields dropped.
   - Text that is not valid JSON throws a `SyntaxError` whose message starts with `Invalid JSON`. JSON that is not a list throws a `TypeError` with the message `Orders must be a list`. Otherwise the first order that breaks a rule throws a `TypeError` with the message `Invalid order at index <i>` (0-based).

   `allocate(inventory, orders, options = {})` returns `{ inventory, results }`: the stock left after allocation as a new `Inventory`, and one result per order. It never changes the inventory, its items or the orders it was given.
   - Orders are handled by priority, lowest number first; orders with the same priority keep their order in the list.
   - If any line of an order has a SKU that is not in the inventory, the order is `rejected` and takes nothing; its result has `reason: "Unknown SKU <sku>"` for the first such line. Only rejected results have a `reason`.
   - Without `{ partial: true }` an order is all or nothing. If every line can be filled from the stock that is left (lines for the same SKU count together), it takes everything and is `filled`. Otherwise it takes nothing and is `backordered`.
   - With `{ partial: true }` each line, in order, takes as much as it can of what is left. The order is `filled` if nothing is missing, `partial` if it got something but not everything, and `backordered` if it got nothing.
   - Each result is `{ id, status, allocated, missing }`. `allocated` lists, per line in line order, `{ sku, quantity }` actually taken, leaving out lines that took nothing. `missing` lists, per line in line order, `{ sku, quantity }` that could not be covered, leaving out lines with nothing missing. For a backordered order without `partial`, `missing` is what would still be missing if the order took everything that is left, line by line. A rejected order has both lists empty.
   - `results` are in the order of the `orders` list, not in the order they were handled.

2. The CLI (`src/cli.js`) gets a subcommand: `stockroom allocate <orders.json> <stock.csv>`, with an optional `--partial` anywhere after `allocate`.
   - It prints one line per order in list order: `<id> filled`, `<id> <status> - missing <sku> x<n>, <sku> x<n>` for partial and backordered orders (the `missing` list), or `<id> rejected - <reason>`. Then an empty line and the text report of the stock that is left.
   - It returns `0` if every order is filled and `4` otherwise.
   - A missing file argument or any other option prints a line starting with `Usage:` and returns `1`. An error from `parseOrders` prints `Error: <message>` and returns `2`.
   - The plain `stockroom <file.csv>` keeps working as today.

Add tests to the project's test suite.
