---
title: Table lookups
description: Read one cell of a markdown table by the label on its row, the way you read a price off a list.
---

> **Package:** `TABLES_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

A lookup reads one value out of a table by naming where it is: which column, and
which row. It is what you do by eye with a price list, finding the line for the
thing you want and reading across to the price. A spreadsheet calls this a
lookup (`VLOOKUP`, or `XLOOKUP`), and a table in a note can be read the same way,
so a figure that already sits in a table does not have to be typed again.

A markdown table's rows are skipped by the engine, since they are not
calculations. `column "..." for "..."` reads a cell from the nearest table above
the line instead:

| Expression | Meaning |
| --- | --- |
| `column "cost" for "food"` | the `cost` cell on the row labelled `food` |
| `column "cost" for "food" in table above` | the same; the address is optional |
| `column "price" for 3` | the `price` cell on the row labelled `3` |

The row's label is its first cell, and the match ignores case, so `"Taxi"` finds a
`taxi` row. `above`, `table above` and `in the table above` can follow the label
and all mean the same thing, since the nearest table above is the only one a
lookup reads.

```solve-doc
| item | cost |
| ---- | ---- |
| rent | 1200 |
| food |  300 |
| taxi |   12 |

column "cost" for "food"                  // 300
column "cost" for "rent" in table above   // 1,200
column "cost" for "Taxi" above            // 12
column "cost" for "food" * 12             // 3,600
```

The answer is an ordinary value, so arithmetic after a lookup applies to what it
found: `column "cost" for "food" * 12` is a year of food at 300 a month.

## Money and percentages

A cell can hold an amount of money (`$3.40`, `£12,570`, `1,200 EUR`) or a
percentage (`10%`), and a lookup answers with that value, not only with plain
numbers. Money is read exactly, digit for digit, so a looked-up price behaves in
arithmetic the way a typed one does.

```solve-doc
| item   | price | discount |
| ------ | ----- | -------- |
| coffee | $3.40 | 10%      |
| cake   | $4.25 | 0%       |

column "price" for "coffee"                                   // $3.40
column "price" for "coffee" * 3                               // $10.20
column "price" for "coffee" - column "discount" for "coffee"  // $3.06
```

## Labels that are numbers, and labels in a variable

A row can be labelled with a number, and looked up by that number. The label can
also come from a variable or a line reference, which is how one lookup follows a
choice made elsewhere in the note.

```solve-doc
| size | price |
| ---- | ----- |
| 1    | 4     |
| 2    | 7     |
| 3    | 9     |

column "price" for 2     // 7
:size = 3
column "price" for size  // 9
```

The label is one value, read before any arithmetic, so `column "price" for 2 * 3`
triples the price of size 2. A label that has to be worked out is written in
brackets: `column "price" for (1 + 2)`.

## When a lookup refuses

A lookup answers with the one cell it was asked for, or says why it cannot. It
never answers with a zero it made up.

```solve-doc
| item | cost | note  |
| ---- | ---- | ----- |
| rent | 1200 | fixed |
| food |  300 |       |
| food |   40 | snack |

column "cost" for "fuel"    // ERROR: The table above has no row labelled "fuel" in its first column. Its rows are: "rent", "food", "food".
column "cost" for "food"    // ERROR: The table above has 2 rows labelled "food" (lines 4 and 5), so the lookup cannot tell which one is meant.
column "note" for "rent"    // ERROR: The "note" cell on line 3 reads "fixed", which is not a number, an amount of money or a percentage.
column "price" for "rent"   // ERROR: The table above has no column named "price". Its columns are: "item", "cost", "note".
```

Two rows with the same label are refused rather than resolved to the first,
because either could be the one meant. A cell of text is refused rather than
answered with its text, since text in a calculation reads as nothing, and an
empty cell is refused rather than read as zero. A column named twice in the
header is refused the same way.

## What a lookup does not do

- **It matches the label exactly.** To find the row an amount falls within, such
  as a tax band or a postage weight, use a band lookup:
  `column "rate" for 45,000 in bands above`, on
  [banded rates](/syntax/banded-rates/).
- **It reads the first column as the label.** Put the labels there; a label in
  any other column is not searched.
- **Units in cells are not read yet.** A cell such as `12 kg` is text to a lookup,
  and is refused. Money and percentages are read; a unit of measurement is left
  for a later change.
- **Only the nearest table above is read,** as with
  [table columns](/syntax/table-columns/), and only tables whose rows start with a
  pipe.

Like the other [cross-line forms](/syntax/line-references/), a lookup only works
inside a document, since it reads a table elsewhere in the note. Typed on its own,
it answers with an error that says a document is needed.
