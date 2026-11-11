Add a new module `src/lru.js` that exports a class `LRUCache`, to be used for caching parsed inventories.

`new LRUCache({ capacity, ttlMs, now })`
- `capacity` (required): a positive integer, the most entries the cache keeps. Anything else throws a `RangeError`.
- `ttlMs` (optional): entries expire this many milliseconds after they were last set. Without it entries never expire.
- `now` (optional): a function returning the current time in milliseconds, `Date.now` by default (lets tests control time).

Methods:
- `set(key, value)`: stores the value, makes it the most recently used and restarts its time to live. When the cache goes over capacity, the least recently used entry is removed. Returns the cache, so calls can be chained.
- `get(key)`: returns the value, or `undefined` if it is missing or expired. A successful get makes the entry the most recently used.
- `has(key)`: `true` if the key is present and not expired. It does not change the order.
- `delete(key)`: removes the entry; returns `true` if it was there (and not expired), otherwise `false`.
- `clear()`: removes everything.
- `size` (a getter): the number of entries that are not expired.
- `keys()`: an array of the non-expired keys, from least to most recently used.

Expired entries must never be returned or counted, and they must not push out live entries. Add tests to the project's test suite.
