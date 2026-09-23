---
title: Category tags
description: Label lines with a #tag and total, average or count every line carrying it, wherever they sit in the note, or break the whole note down by tag.
---

> **Package:** `TAGS_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

A running note often groups its numbers by hand: a shopping list, a set of
expenses, a few figures that belong together. A `#tag` written mid-line labels a
line as belonging to a category, and the aggregates gather every line carrying
that tag, wherever they sit in the document.

The tag itself is dropped from the line it annotates, so a tagged line still
calculates to its own number:

```solve-doc
40 + 15 #grocery   // 55
```

## The aggregates

Four forms read the whole document and collect the lines that carry a tag. Each
reads the same set; they differ only in what they do with it.

| Expression | Meaning |
| --- | --- |
| `total of #grocery` | the sum of every line tagged `#grocery` |
| `sum of #grocery` | the same, `sum` is a synonym for `total` |
| `average of #grocery` | the mean of the tagged lines |
| `count of #grocery` | how many lines carry the tag |

A worked note. The tagged lines need not be adjacent; lines carrying other tags,
untagged lines, and blank lines between them are all ignored:

```solve-doc
40 + 15 #grocery
30 #transport

12.50 #grocery
total of #grocery   // 67.50
```

### Asking is not joining

A `#tag` after one of those four openers names the group; it does not join it.
So a tag can answer as many questions as you like, and each answers as though it
were the only one:

```solve-doc
40 #grocery
12.50 #grocery
total of #grocery // 52.50
average of #grocery // 26.25
count of #grocery // 2
```

A line can do both at once, because the rule is about each `#` rather than about
the line: the tag being asked about is a question, and any other tag on the line
is still a mark.

```solve-doc
40 #grocery #reviewed
12.50 #grocery
9 #reviewed
total of #grocery // 52.50
total of #reviewed // 49
```

The first line is counted in both totals, and neither aggregate line is counted
in either.

`count` answers presence rather than value: it counts every line that carries the
tag, and a non-numeric tagged line (a note to yourself) counts too, where `total`
and `average` would reject it.

```solve-doc
40 #grocery
12.50 #grocery
count of #grocery   // 2
```

Money and units carry through. A tag whose lines are all in dollars totals to
dollars:

```solve-doc
$40 #food
$25 #food
total of #food   // $65.00
```

## Every tag at once

A tagged list is usually kept to answer one question: where did it all go?
`total by tag` answers it in one line. It gathers every tag in the note and
gives each one's total and its **share**, the part of the whole that tag makes
up, as a percentage. The tags appear in the order they are first written.

```solve-doc
$40 #food
$25 #food
$30 #transport
total by tag   // food $65.00 (68%) · transport $30.00 (32%)
```

`sum by tag` is a synonym. Each amount is the one `total of #tag` gives for that
tag, and labels, headings, blank lines and untagged lines are passed over, the
same as for the single-tag totals:

```solve-doc
# Budget
Rent: $1200 #home
Power: $80 #home
Train: $60 #transport
Lunch: $45 #food
total by tag   // home $1,280.00 (92%) · transport $60.00 (4%) · food $45.00 (3%)
```

Each share is rounded to a whole percentage on its own, so the shares can add up
to 99% or 101%, as they do above. A share too small to round to 1% is shown as
`<1%` rather than as a `0%` that would read as nothing at all:

```solve-doc
$1000 #rent
$1 #snack
total by tag   // rent $1,000.00 (100%) · snack $1.00 (<1%)
```

The whole is every tagged line counted once; an untagged line is not part of
it. When each line carries one tag, the shares describe how the whole divides.
A line carrying two tags counts toward both, so overlapping tags can add up to
more than 100%, and each share still says what part of the whole that tag
covers. Here the whole is 61.50, and the first line is both groceries and
reviewed:

```solve-doc
40 #grocery #reviewed
12.50 #grocery
9 #reviewed
total by tag   // grocery 52.50 (85%) · reviewed 49 (80%)
```

The answer is a line of text, not a number: it holds several figures with their
labels, so it cannot be carried into arithmetic. `total of #food` is the form
that gives a figure to calculate with. The amounts inside the text are shown the
way the engine shows them by default; a host's own number formatting, another
locale's separators for example, is not applied inside it.

A breakdown needs a whole to divide, so each of these is an error rather than a
line of zeros: a note with no tags, a tagged line that is not a number, tags in
different measures (money under one, kilometres under another), and tagged lines
that add up to exactly zero.

```solve-doc
$40 #food
5 km #run
total by tag   // ERROR: money and length cannot be added. A breakdown needs every tagged line in one measure, so the tags share one whole.
```

## Boundaries

A few boundaries, each deliberate:

- **A tag that is a line's first token is a heading**, not a data line, so
  `#grocery list` at the top of a note is a title rather than a tagged figure.
- **The match is on the whole tag**, so a prefix does not collide: `#housing`
  does not gather `#housingcost`. Tag names are matched case-insensitively.
- **The `#` must sit at a boundary.** A `#` glued to the end of a word or number
  is not a tag: `100#food` and `a#food` are left whole and the `#` reads as an
  ordinary comment; only `100 #food`, with a space, tags the line. This keeps the
  tag the reader sees and the tag the totals count the same one.
- **A tag may be named after an ordinary word**, even one the grammar uses
  elsewhere. `#column` or `#assuming` is a category like any other, on a data
  line and in an aggregate alike:

```solve-doc
1200 #assuming
800 #assuming
total of #assuming   // 2,000
```

- **A clear error, never a silent figure.** Mixing units under one tag, or
  tagging a line that is not a number then asking for its `total`, is an error
  rather than a guessed number. No tagged lines at all is an error for `total`
  and `average`, and zero for `count`.

A tag name must start with a letter, which keeps it clear of the colour
literals: `#grocery` is a tag, `#c0ffee` is a [colour](/syntax/colours/), and
`#12a` (all hex digits) is a colour too, not a tag. A `#` followed by a space is
still an ordinary heading or comment.

Like [line references](/syntax/line-references/), these forms only work inside a
document, since they read other lines. They return an error through the
single-expression entry point, which has no document to gather from.

A tag gathers lines wherever they sit. To add up the lines under one heading
instead, name the heading: see [sections](/syntax/sections/).
