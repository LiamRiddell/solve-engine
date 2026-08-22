---
"solve-engine": minor
---

Matrices can render as a stacked, column-aligned grid.

A matrix's value is still returned as the compact one-line form (`[1, 2; 3, 4]`), which stays the stable text the API and the worker DTO use. Alongside it, a new `formatMatrixAligned(matrix)` export in `solve-engine/format` renders a matrix the way it reads best: one row per line, each column right-padded to its widest cell.

```
formatMatrixAligned  of  [1, 200; 300, 4]

[   1  200 ]
[ 300    4 ]
```

The documentation notepad now uses this to show matrix answers as an aligned grid rather than a single line. Anything that wants the compact form (or one value per row) keeps reading `formatValue` as before.
