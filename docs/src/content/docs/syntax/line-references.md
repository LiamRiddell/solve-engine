---
title: Line references
description: Referring to previous lines and aggregating over them.
---

These forms only work inside a document, since they refer to other lines. They
return an error through the single-expression entry point, which has no document
to refer to.

| Expression | Meaning |
| --- | --- |
| `prev` | the result of the previous line |
| `line 3` | the result of line three |
| `sum(line 1 : line 4)` | the total of a span of lines |
| `average(line 1 : line 4)` | the mean of a span |
| `total above` | the total of every line above |
| `average above` | the same, averaged |

A blank line or a heading acts as a boundary, so `total above` sums the current
block rather than the whole document.
