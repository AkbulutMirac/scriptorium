Add a Markdown stock report so it can be pasted into wikis and pull requests.

1. In `src/report.js`, export `markdownReport(inventory, options = {})` returning a string.

   Without options it is one table of all items sorted by name, followed by a total row:
   ```
   | SKU | Name | Qty | Price | Value |
   |:----|:-----|----:|------:|------:|
   | A100 | Desk lamp | 12 | $24.99 | $299.88 |
   | **Total** | | **12** | | **$299.88** |
   ```
   - `Price` is the item price and `Value` is `quantity * priceCents`, both formatted with `formatMoney`.
   - The total row has the summed quantity and summed value, in bold, with the Name and Price cells empty.
   - A `|` inside a SKU or name is written as `\|`, and a backslash as `\\`.
   - Lines are joined with `\n` and the string has no trailing newline. An empty inventory still has the header, the separator and a total row with `**0**` and `**$0.00**`.

   With `{ groupBy: "prefix" }` items are grouped by the letters before the first digit of their SKU (`A100` → `A`; a SKU without digits is its own prefix). Groups are in alphabetical order. Each group is a `## <prefix>` heading, a blank line, then its table as above, whose last row is `| **Subtotal** | | **<qty>** | | **<value>** |` instead of the total row. Groups are separated by one blank line, and after the last group comes a blank line and `**Grand total:** <value>` (summed value of all items, not bold inside). An empty inventory gives just `**Grand total:** $0.00`.

2. The CLI (`src/cli.js`) accepts, before or after the file name, `--format text|md` (default `text`) and `--group prefix` (only valid with `--format md`). An unknown option, a missing or invalid value, or `--group` without `--format md` prints a line starting with `Usage:` and returns `2`. The text report and its exit codes stay as they are.

Add tests to the project's test suite.
