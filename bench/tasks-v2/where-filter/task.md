Add a small filter language so users can pick items, e.g. `stockroom data/stock.csv --where 'quantity < 5 and (name ~ "lamp" or price_cents >= 1000)'`.

1. New module `src/filter.js` exporting `compileFilter(expression)`, which returns a function `(item) => boolean` for the item objects of `Inventory` (`sku`, `name`, `quantity`, `priceCents`).

   Grammar (keywords `and`, `or`, `not` are case-insensitive, whitespace between tokens is ignored):
   ```
   expr       := orExpr
   orExpr     := andExpr ("or" andExpr)*
   andExpr    := notExpr ("and" notExpr)*
   notExpr    := "not" notExpr | primary
   primary    := "(" expr ")" | comparison
   comparison := field operator value
   field      := sku | name | quantity | price_cents
   operator   := = | != | < | <= | > | >= | ~
   value      := integer | string
   ```
   - An integer is one or more digits. A string is in double quotes; inside it `\"` is a quote and `\\` a backslash.
   - `quantity` and `price_cents` (the item's `priceCents`) are numbers and can only be compared with integers, using any operator except `~`.
   - `sku` and `name` are strings and can only be compared with strings, using `=`, `!=` (exact, case-sensitive) or `~` (contains, case-insensitive).
   - Syntax errors (unexpected or missing token, unterminated string, unknown character, unknown field) throw a `SyntaxError` whose message ends with `at position N`, where `N` is the 0-based index in the expression where the offending token starts (the expression's length for an unexpected end).
   - Type errors (a string field with a number or with `<`, `<=`, `>`, `>=`; a number field with a string or with `~`) throw a `TypeError`.
   - All errors are thrown by `compileFilter`, never by the returned function.

2. The CLI (`src/cli.js`) accepts `--where <expression>` before or after the file name and only reports the matching items. If the expression is invalid it prints a line starting with `Error:` and returns `2`; a missing value for `--where` does the same. Everything else keeps working as today.

Add tests to the project's test suite.
