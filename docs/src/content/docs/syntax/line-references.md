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

```solve-doc
120
80
prev     // 80
line 1   // 120
```

`total above` and `average above` gather every line above them:

```solve-doc
10
20
30
total above   // 60
```

A blank line or a heading acts as a boundary, so `total above` sums the current
block rather than the whole document:

```solve-doc
10
20

100
total above   // 100
```

A subtotal inside the block is a summary of figures already counted, not
another figure, so a later `total above` leaves it out rather than counting
those figures twice:

```solve-doc
10
total above   // 10
5
total above   // 15
```

A line that is itself a total, `total above`, `sum(line 1 : line 3)`, a tag or
section total, is recognised from its text, with any label before a colon set
aside, which is the same test the [section totals](/syntax/sections/) use.

To total a block from somewhere else in the note, a summary at the bottom say,
name its heading instead: `total of section "Travel"` (see
[sections](/syntax/sections/)).

A `sum(...)` or `average(...)` over an explicit span reads exactly the lines it
names, so it can reach across a boundary a bare `above` would stop at:

```solve-doc
10
20
30
sum(line 1 : line 3)       // 60
average(line 1 : line 3)   // 20
```

A blank line or a heading inside the span has no figure to add and is passed
over, the way a spreadsheet's `SUM` passes over an empty cell, so pressing Enter
inside a summed block does not break the sum. A line of prose inside it is still
an error, since it is a line that failed rather than one left empty:

```solve-doc
10

30
sum(line 1 : line 3)   // 40
```

These forms only work inside a document, since they refer to other lines. They
return an error through the single-expression entry point, which has no document
to refer to.

## Two lines that read each other

A reference needs a line with an answer of its own. If line 1 reads line 2 and
line 2 reads line 1, neither has one: each is computed from the other, and there
is no value to start from. The engine reports that on each line rather than
settling on a number, and it reports the same thing however the text was
reached, typed out at once or edited into a note that used to say something
else:

```solve-doc
line 2 + 5    // ERROR: Line 2 has not been evaluated yet (forward reference, or out of range)
prev + 5      // ERROR: Line 1 has an error
```

Line 1 reports that line 2 has not been evaluated yet, which is what a line
below it is from where line 1 stands, and line 2 reports that line 1 has an
error. The same holds for a cycle that runs through a name (`:a = line 2 + 1`
above `a + 1`) or a running total (`spent += line 2` above `spent += 9`): every
line on it reports it, and none takes a number from the others.

A reference to a line further down is refused too, cycle or not. A note is
read from the top, so from where line 1 stands, line 2 has not been evaluated
yet. Put the line that is read above the line that reads it:

```solve-doc
line 2 + 1   // ERROR: Line 2 has not been evaluated yet (forward reference, or out of range)
7
```

## Related, document-aware forms

Six other forms read the whole note the same way, each with its own page:

- [Category tags](/syntax/category-tags/): label a line with `#tag` and total,
  average or count every line carrying it, or break the note down by tag.
- [Sections](/syntax/sections/): total, average or count the figures under a
  heading, by the heading's name.
- [Goal seek](/syntax/goal-seek/): solve backwards for the input that makes a
  line reach a target.
- [Table columns](/syntax/table-columns/): name a markdown table column and
  summarise the numbers in it.
- [Table lookups](/syntax/table-lookups/): read one cell of a table by the label
  on its row.
- [Banded rates](/syntax/banded-rates/): apply a table of bands, such as a tax or
  commission schedule, to an amount.
