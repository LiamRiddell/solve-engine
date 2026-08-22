---
"solve-engine": patch
---

Implicit multiplication over a grouping keeps thousands: `(2)(1,000)` is `2,000`, not a vector.

A `(` right after `)` or `]` was read as a function call, so a thousands number in the following grouping paren was split on its comma and `(2)(1,000)` became the vector `[2, 0]`:

```
(2)(1,000)     was [2, 0],      now 2000
(5)(2,500)     was [10, 2,500], now 12500
```

This grammar has no curried or first-class calls (`f(1000)(2000)` errors) and no index-application (`[1,2,3](0)` errors), so `)(` and `](` are implicit multiplication over a grouping, never a call. The lexer now treats only an identifier or a function keyword as a call target, so a `(` after a closing bracket is a grouping and its comma stays a thousands separator, matching the no-comma form `(2)(1000)` = `2000`.
