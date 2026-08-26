---
title: Category tags
description: Label lines with a #tag and total, average or count every line carrying it, wherever they sit in the note.
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

- **One aggregate line per tag per note.** An aggregate line carries the tag it
  sums, so a second one would try to include the first, and each would wait on
  the other. The query line always skips itself; a second query is left out of
  scope rather than guessed at.
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
