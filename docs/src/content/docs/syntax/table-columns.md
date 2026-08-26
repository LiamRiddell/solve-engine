---
title: Table columns
description: Name a markdown table column and total, average or summarise the numbers in it.
---

> **Package:** `TABLES_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

A markdown table is otherwise the one block the engine reads and skips, so the
numbers in it cannot be totalled from where they sit. A column can be named and
read as data instead:

| Expression | Meaning |
| --- | --- |
| `sum of column "cost" in table above` | the total of the named column |
| `average of column "cost" above` | the mean of the named column |
| `min of column "cost" above` | the smallest cell |
| `max of column "cost" above` | the largest cell |
| `count of column "cost" above` | how many numeric cells it has |
| `median of column "cost" above` | the middle cell |

`total of column` and `mean of column` are accepted as synonyms of `sum` and
`average`. The address is optional: with only the nearest table to read from,
`sum of column "cost"`, `sum of column "cost" above`, and
`sum of column "cost" in table above` all mean the same thing.

The table's rows must start with a pipe, and the header needs a `|---|`
separator under it, as in:

```
| item | cost |
| ---- | ---- |
| rent | 1200 |
| food |  300 |
| taxi |   12 |

sum of column "cost" in table above       1,512
average of column "cost" above               504
```

The column name is matched case-insensitively. A cell that is not a plain
number, a label, a blank, or a currency or unit value, is skipped rather than
counted, so a stray row does not break an otherwise-numeric column. A column
with no numbers at all, or a name that is not one of the headers, is a clear
error rather than a silent zero.

Currency and unit cells are not read yet, and a table whose rows do not start
with a pipe is not recognised. Both are deliberately left for a later slice.

Like [line references](/syntax/line-references/), a column read only works inside
a document, since it reads a table elsewhere in the note.
