Add an export command that writes the stock as a CSV file into an `exports/` folder, safely enough to run on names typed by other people.

1. New module `src/export.js` exporting:

   `safeExportPath(baseDir, name)` returns the absolute path of `exports/<name>` inside `baseDir` (`path.join(path.resolve(baseDir), "exports", name)`) if `name` is a valid export name, and otherwise throws an `Error` with the message `Invalid export name`. A valid name:
   - is a string of 1 to 64 characters, made only of ASCII letters, digits, `.`, `-` and `_`;
   - does not start with `.`;
   - ends with `.csv` (lowercase) and has at least one character before it;
   - is not a reserved Windows device name: the part before its first `.` must not be `CON`, `PRN`, `AUX`, `NUL`, `COM1` to `COM9` or `LPT1` to `LPT9`, in any letter case.

   `toCSV(inventory)` returns the inventory as CSV text: the header `sku,name,quantity,price_cents`, then one line per item in the inventory's order, every line (the last one too) ending with `\n`. Quantity and price are written as plain numbers. For the `sku` and `name` cells:
   - a value that starts with `=`, `+`, `-`, `@`, a tab or a carriage return gets a `'` in front of it, so spreadsheets don't run it as a formula;
   - then, a value that contains a comma, a double quote, `\n` or `\r` is wrapped in double quotes, with each double quote inside doubled.

2. The CLI (`src/cli.js`): `main` takes an optional third argument, the working folder: `main(argv, out = console.log, cwd = process.cwd())`. Add `stockroom export <stock.csv> <name> [--force]`, where `--force` may appear anywhere after `export` and `<stock.csv>` is read relative to the working folder. Checked in this order:
   - Missing arguments, extra arguments or any other option starting with `--` print a line starting with `Usage:` and return `1`.
   - An invalid name prints `Error: Invalid export name` and returns `2`, before anything is created.
   - If `exports` exists in the working folder but is not a plain directory (a file, a symbolic link or a junction), it prints `Error: exports is not a directory` and returns `2`. If it doesn't exist, it is created.
   - If the file already exists and `--force` is not given, it prints `Error: exports/<name> already exists` and returns `3`, leaving the file as it was.
   - Otherwise it writes `toCSV` of the stock to the file, prints `Wrote exports/<name>` and returns `0`.

   The plain `stockroom <file.csv>` keeps working as today.

Add tests to the project's test suite.
