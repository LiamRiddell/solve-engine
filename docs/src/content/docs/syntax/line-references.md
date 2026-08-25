---
title: Line references
description: Referring to previous lines and aggregating over them.
---

> **Packages:** `LINES_PACKAGE`, `GOALSEEK_PACKAGE`, `TABLES_PACKAGE`, `TAGS_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register them explicitly (see [choosing packages](/getting-started/installation/)).

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

## Goal seek

The engine computes forwards, so answering "what input gives me this result"
usually means editing a number and re-reading the answer until it looks right.
Goal seek does that search for you, against a line reference.

`solve line 4 for rate = 900` reads as "find the value of `rate` that makes line
four equal 900". The variable named after `for` must be one the target line
uses, since changing it is how the target moves. The result is that value.

| Expression | Meaning |
| --- | --- |
| `solve line 4 for rate = 900` | the `rate` that makes line four equal 900 |
| `solve line 2 for deposit = 1,200` | the `deposit` that makes line two equal 1,200 |

A worked document. Line three reads `deposit`, and the last line solves for it:

```
:deposit = 100000
:rate = 4%
monthly repayment on deposit over 25 years at rate
solve line 3 for deposit = 900
```

There are two mechanisms, chosen automatically. When the target line is closed
form in the variable, the answer is inverted exactly, the same algebra the
[`solve(...)`](/syntax/algebra/) verb uses. Otherwise (a finance formula, say)
a bounded numeric search narrows in on it, assuming the relationship rises or
falls steadily across the search and crosses the target once.

That search is deliberately fenced in, so a document can never make it spin. It
looks for a positive input up to a billion, and stops after a fixed number of
steps (`vm.maxGoalSeekIterations`, a hundred by default). A target no input in
range can reach, a relationship that jumps across the target rather than passing
through it, or the step limit, each ends in an error rather than a guess or a
hang. Solutions outside that range, or relationships with several crossings, are
out of scope for now.

## Table columns

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

## Category tags

A running note often groups its numbers by hand: a shopping list, a set of
expenses, a few figures that belong together. A `#tag` written mid-line labels a
line as belonging to a category, and the aggregates gather every line carrying
that tag, wherever they sit in the document.

The tag itself is dropped from the line it annotates, so a tagged line still
calculates to its own number:

```
40 + 15 #grocery      55
```

The aggregates read the whole document, collecting the lines that carry the tag:

| Expression | Meaning |
| --- | --- |
| `total of #grocery` | the sum of every line tagged `#grocery` |
| `sum of #grocery` | the same, `sum` is a synonym for `total` |
| `average of #grocery` | the mean of the tagged lines |
| `count of #grocery` | how many lines carry the tag |

A worked note. The tagged lines need not be adjacent, and prose and blank lines
between them are ignored:

```
40 + 15 #grocery      55
petrol this week
30 #transport         30

12.50 #grocery        12.50
total of #grocery     67.50
```

Like line references, these forms only work inside a document, since they read
other lines. They return an error through the single-expression entry point,
which has no document to gather from.

A few boundaries, each deliberate:

- A tag that is a line's first token is a **heading**, not a data line, so
  `#grocery list` at the top of a note is a title rather than a tagged figure.
- The match is on the whole tag, so a prefix does not collide: `#housing` does
  not gather `#housingcost`. Tag names are matched case-insensitively.
- The `#` must sit at a boundary. A `#` glued to the end of a word or number is
  not a tag: `100#food` and `a#food` are left whole and the `#` reads as an
  ordinary comment; only `100 #food`, with a space, tags the line. This keeps the
  tag the reader sees and the tag the totals count the same one.
- A tag may be named after an ordinary word, even one the grammar uses elsewhere:
  `#column` or `#assuming` on a data line is still a tag, not swallowed by a
  phrase built from the same words.
- Only one aggregate line per tag per note. An aggregate line carries the tag it
  sums, so a second one would try to include the first, and each would wait on
  the other. The query line always skips itself; a second query is left out of
  scope rather than guessed at.
- Money and units carry through: a tag whose lines are all in dollars totals to
  dollars. Mixing units under one tag, or tagging a line that is not a number,
  is a clear error rather than a silent figure. No tagged lines at all is an
  error for `total` and `average`, and zero for `count`.

A tag name must start with a letter, which keeps it clear of the colour
literals: `#grocery` is a tag, `#c0ffee` is a [colour](/syntax/colours/), and
`#12a` (all hex digits) is a colour too, not a tag. A `#` followed by a space is
still an ordinary heading or comment.
