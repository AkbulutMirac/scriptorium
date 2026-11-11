Make the CSV handling strict enough for real exports: quoted fields, Windows line endings, and a `check` command that validates a stock file.

1. In `src/csv.js`:

   Export `parseRows(text)`, which returns the records as `[{ line, cells }]`, where `cells` is an array of strings and `line` is the 1-based line on which the record starts.
   - Fields are separated by commas and records by `\n` or `\r\n`.
   - A field may be wrapped in double quotes. Inside quotes `""` stands for one quote, and commas and line breaks are part of the value. Spaces outside the quotes are ignored; the value is kept exactly as written between the quotes.
   - Unquoted fields are trimmed of surrounding whitespace, as today. A quote inside an unquoted field is an ordinary character.
   - A line that is empty or only whitespace (outside quotes) is skipped, as today. A record ending with a comma has an empty last cell.
   - A quote that is never closed throws a `SyntaxError` with the message `Unterminated quote on line N`, where N is the line on which that quoted field starts.
   - Anything other than spaces between a closing quote and the next comma or line end throws a `SyntaxError` with the message `Unexpected character after quote on line N`, where N is the line of that character.

   `parseCSV(text)` keeps its signature and returns the `cells` of `parseRows(text)`. `parseRecords` and `Inventory.fromCSV` keep working on top of it, so quoted names now load correctly.

2. In `src/inventory.js`, add the static method `Inventory.validateCSV(text)`, returning `{ inventory, errors }`, where each error is `{ line, message }`.
   - The header row must contain the columns `sku`, `name`, `quantity` and `price_cents`, in any order; other columns are ignored. If any are missing, `errors` has one `Missing column <name>` per missing column, in the order just listed, with the header's line, and the inventory is empty. Empty text counts as a header with no columns.
   - Every other record is checked for the first problem in this order: `Wrong number of columns` (a different number of cells than the header), `Missing SKU` (empty), `Missing name` (empty), `Invalid quantity` and `Invalid price` (`price_cents`) (each must be digits only), and `Duplicate SKU <sku>` (a SKU already used by an earlier valid record). A record with a problem is left out and adds one error with its line.
   - Valid records become items `{ sku, name, quantity, priceCents }` with numbers for the last two, in file order.
   - `parseRows` syntax errors are not caught here.

3. In the CLI (`src/cli.js`), add `stockroom check <file.csv>`. If the file has no errors it prints `OK: <n> items` and returns `0`. Otherwise it prints one line `Line <n>: <message>` per error and returns `3`. A CSV syntax error prints `Error: <message>` and returns `2`, and so does a syntax error in the plain `stockroom <file.csv>`, which otherwise keeps working as today. A missing file argument prints a line starting with `Usage:` and returns `1`.

Add tests to the project's test suite.
