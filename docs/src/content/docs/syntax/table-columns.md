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
| `standard deviation of column "cost" above` | how spread out it is |
| `variance of column "cost" above` | the squared spread |
| `spread of column "cost" above` | largest minus smallest |
| `mode of column "cost" above` | the most frequent cell |

`total of column` and `mean of column` are accepted as synonyms of `sum` and
`average`. The address is optional: with only the nearest table to read from,
`sum of column "cost"`, `sum of column "cost" above`, and
`sum of column "cost" in table above` all mean the same thing.

The table's rows must start with a pipe, and the header needs a `|---|`
separator under it. That separator is what makes the rows a table: without it,
a line starting with a pipe is an expression, since `|` is also bitwise or
(`5 | 3` is 7). With it, every row is markup, answering nothing and reporting
no error, and the table ends a block for `total above` the way a heading does.
A cell may still hold an inline solve, which is worked out as it would be in a
line of prose.

Every summary form the table above names, read from the same column:

```solve-doc
| item | cost |
| ---- | ---- |
| rent | 1200 |
| food |  300 |
| taxi |   12 |

sum of column "cost" in table above     // 1,512
average of column "cost" above          // 504
min of column "cost" above              // 12
max of column "cost" above              // 1,200
count of column "cost" above            // 3
median of column "cost" above           // 300
```

The [spread and shape](/syntax/statistics/) aggregates read a column too, so a
table of readings can be summarised where it sits:

```solve-doc
| reading | score |
| ------- | ----- |
| a       |     2 |
| b       |     4 |
| c       |     4 |
| d       |     4 |
| e       |     5 |
| f       |     5 |
| g       |     7 |
| h       |     9 |

standard deviation of column "score" above  // 2
variance of column "score" above            // 4
spread of column "score" above              // 7
mode of column "score" above                // 4
```

The column name is matched case-insensitively.

A column of money totals in its currency, the way the same figures typed as lines
do under `total above`. A cell reads as money when a currency symbol comes before
the amount (`$200`, `£12,570`) or a currency code after it (`1,200 GBP`), and a
plain number in the same column joins it as an amount in that currency:

```solve-doc
| item | cost  |
| ---- | ----- |
| rent | 500   |
| food | $200  |
| car  | 1,200 |

total of column "cost" above   // $1,900.00
count of column "cost" above   // 3
max of column "cost" above     // $1,200.00
```

Two currencies in one column are refused by name, as `total above` refuses them,
and so is the variance of a column of money, which would be in square dollars;
its standard deviation is in dollars.

A cell with no figure in it, a label, a blank, or a figure with a unit such as
`5 km`, is skipped rather than counted, so a stray row does not break an
otherwise-numeric column. Thousands have to be grouped in threes to read as one
number: `4,812` is 4812, and `12,57` is text, since a misplaced comma is more
likely a typo or a decimal comma than a thousands separator. A percentage cell is
counted by `count`, and refused by the summaries that add or compare, because a
percentage is a proportion rather than one of the figures. A column with no
number or money cells at all, or a name that is not one of the headers, is a
clear error rather than a silent zero.

Unit cells are not read by a column summary yet, and a table whose rows do not
start with a pipe is not recognised. Both are left for a later slice.

To read one cell rather than a whole column, name its row with a
[table lookup](/syntax/table-lookups/): `column "cost" for "food"`. A lookup
reads cells the same way, and answers a percentage cell as a percentage. A table of thresholds and rates can be applied
to an amount as [banded rates](/syntax/banded-rates/).

Like [line references](/syntax/line-references/), a column read only works inside
a document, since it reads a table elsewhere in the note.
