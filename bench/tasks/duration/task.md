Add a new module `src/duration.js` that exports two functions:

`parseDuration(text)` turns a duration like `"1h30m15s"` into a number of seconds.
- Units: `d` (days), `h`, `m`, `s`. Each unit appears at most once and in that order (`d`, then `h`, then `m`, then `s`); any unit may be left out, but at least one must be there.
- Amounts are non-negative whole numbers. Spaces between parts are allowed (`"1h 30m"`), leading and trailing spaces are ignored, units are case-insensitive (`"2H"`).
- A non-string argument throws a `TypeError`.
- Any other invalid input (empty, unknown unit, wrong order, repeated unit, a number without a unit, decimals, negative numbers) throws an `Error` whose message starts with `Invalid duration`.

`formatDuration(seconds)` does the reverse.
- It returns the non-zero parts from days to seconds separated by single spaces, e.g. `93784` → `"1d 2h 3m 4s"`, `3600` → `"1h"`.
- `0` returns `"0s"`.
- Anything that is not a non-negative integer throws a `RangeError`.

Add tests for it to the project's test suite.
