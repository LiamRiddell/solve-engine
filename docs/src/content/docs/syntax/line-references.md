---
title: Line references
description: Refer to a previous line by number or position, and total or average a span of them.
---

> **Package:** `LINES_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

A note is often a column of working where each line builds on the ones above it.
Rather than retype a figure, refer to the line it came from, and the reference
updates when that line changes.

| Expression | Meaning |
| --- | --- |
| `prev` | the result of the previous line |
| `line 3` | the result of line three |
| `sum(line 1 : line 4)` | the total of a span of lines |
| `average(line 1 : line 4)` | the mean of a span |
| `total above` | the total of every line above |
| `average above` | the same, averaged |

`prev` reads the line immediately above, and `line N` reads any earlier line by
its number:

```solve
120
80
prev
line 1
```

`total above` and `average above` gather every line above them:

```solve
10
20
30
total above
```

A blank line or a heading acts as a boundary, so `total above` sums the current
block rather than the whole document:

```solve
10
20

100
total above
```

A `sum(...)` or `average(...)` over an explicit span reads exactly the lines it
names, so it can reach across a boundary a bare `above` would stop at:

```solve
10
20
30
sum(line 1 : line 3)
average(line 1 : line 3)
```

These forms only work inside a document, since they refer to other lines. They
return an error through the single-expression entry point, which has no document
to refer to.

## Related, document-aware forms

Three other forms read the whole note the same way, each with its own page:

- [Category tags](/syntax/category-tags/): label a line with `#tag` and total,
  average or count every line carrying it.
- [Goal seek](/syntax/goal-seek/): solve backwards for the input that makes a
  line reach a target.
- [Table columns](/syntax/table-columns/): name a markdown table column and
  summarise the numbers in it.
