Add stock movements: a ledger file of receipts, shipments and stock counts that is applied to the inventory.

1. New module `src/ledger.js` exporting:

   `parseMovements(csvText)` reads a CSV with the header `date,sku,type,quantity` (use the existing `parseCSV`) and returns `{ movements, errors }`.
   - Each valid row becomes `{ line, date, sku, type, quantity }`, where `line` is the row's line number in the file (the header is line 1) and `quantity` is a number.
   - `date` must be a real calendar date written `YYYY-MM-DD`; `type` is `receive`, `ship` or `adjust`; `quantity` is a whole number of digits only (no sign).
   - An invalid row is left out and adds `{ line, message }` to `errors`. A row with a different number of cells than the header gives `Wrong number of columns` (checked first); otherwise the message is `Invalid date`, `Invalid type` or `Invalid quantity` for the first problem found in that order.

   `applyMovements(inventory, movements)` returns `{ inventory, errors }` and never changes the inventory it was given.
   - Movements are applied in date order; movements on the same date keep their order in the list.
   - `receive` adds the quantity, which must be greater than 0. `ship` subtracts it; it must be greater than 0 and not more than what is in stock. `adjust` sets the quantity to the given number (a stock count; 0 is allowed).
   - A movement that breaks a rule is skipped and adds `{ line, message }` to `errors`: `Unknown SKU <sku>`, `Quantity must be positive`, or `Not enough stock for <sku> (have <n>, need <m>)`, checked in that order.
   - `errors` are in the order the movements were applied.

2. The CLI (`src/cli.js`) gets a subcommand: `stockroom ledger <movements.csv> <stock.csv>`. It prints the text report of the resulting inventory, then one line `Line <n>: <message>` per error from parsing and then from applying (parse errors first, each group in its own order). It returns `3` if there were any errors and `0` otherwise. Missing file arguments print a line starting with `Usage:` and return `1`. The plain `stockroom <file.csv>` keeps working as today.

Add tests to the project's test suite.
