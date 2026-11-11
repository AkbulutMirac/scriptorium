Users report that `parseCSV` in `src/csv.js` breaks on real exported files: item names like `"Desk lamp, large"` get split into two columns, and files saved on Windows leave a stray `\r` at the end of every last cell.

Fix `parseCSV` so it follows RFC 4180:
- A field can be wrapped in double quotes. A quoted field may contain commas, line breaks, and doubled double quotes (`""`), which stand for one literal `"`.
- Lines may end with `\n` or `\r\n`.
- Unquoted cells are still trimmed, as today. The content of a quoted field is kept exactly as written (no trimming inside the quotes).
- Empty fields stay empty strings (`a,,c` has three cells). Blank lines are still skipped.

`parseRecords` and `Inventory.fromCSV` must keep working on top of it. Add tests for the fix to the project's test suite.
