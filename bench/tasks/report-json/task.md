Extend the stockroom CLI (`src/cli.js`) and the inventory:

1. `Inventory` gets two methods:
   - `totalValue()`: the sum of `quantity * priceCents` over all items, in cents.
   - `lowStock(threshold)`: a new `Inventory` with only the items whose `quantity` is less than `threshold`.
2. The CLI accepts two options, before or after the file name:
   - `--format text|json` (default `text`). With `json`, print `JSON.stringify(report, null, 2)` where `report` is `{ "items": [...], "totalValueCents": number }`. `items` are sorted by name, and each item is `{ "sku", "name", "quantity", "priceCents", "valueCents" }` with `valueCents = quantity * priceCents`. `totalValueCents` is the total of the listed items.
   - `--low <n>`: only include items with `quantity < n`, in both formats. `n` must be a non-negative integer.
3. Errors: an unknown option, a missing or invalid option value, or an unknown format prints a line starting with `Usage:` and returns exit code `2`. A missing file name keeps returning `1` as today.

Keep `main(argv, out)` and its return codes; the text report keeps its current format. Add tests to the project's test suite.
