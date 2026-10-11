## 2026-04-05 - WeakMap Caching for Table Filtering

**Learning:** Mutating state objects directly when caching transformed property values (e.g. for filtering/searching) introduces risks of object mutation side-effects and stale properties. Using a module-scoped `WeakMap` caches normalized values cleanly without mutating data objects, works with frozen objects, and automatically cleans up memory when objects are dereferenced.

**Action:** Use `WeakMap` for memoizing object-derived computation in UI event loops instead of mutating items directly.
