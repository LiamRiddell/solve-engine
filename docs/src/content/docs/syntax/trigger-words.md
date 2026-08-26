---
title: Trigger words
description: Why ordinary English words are not keywords, and what that means for your notes.
---

> **Packages:** `MATHPHRASES_PACKAGE`, `MAPREDUCE_PACKAGE`, `FINANCE_PACKAGE`, `TAGS_PACKAGE`, `LINES_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register them explicitly (see [choosing packages](/getting-started/installation/)).

The most common worry about a calculator that reads prose is that it will start
mangling the prose. This page explains why that mostly does not happen.

## Words are not keywords

The engine needs `total`, `average`, `tax`, `sum`, `line` and many other ordinary
words. If each were claimed as a keyword, a note containing "the total was
disappointing" would start behaving strangely, and defining a variable named
`total` would become impossible.

So they are not keywords. They are recognised only as part of a longer phrase,
and only where that phrase forms a complete expression. `average of 1, 2, 3` is
recognised. A bare `average` is a name.

The same holds for the bill-split words: `split`, `ways` and `people` are read
as the split grammar only inside the full `split <amount> between <N>` or
`<amount> split <N> ways` shape, so `:split = 5` and a variable named `split`
keep working.

That is why this works:

```solve
:total = 100
:total + 5 // 105
```

## Function-like names need the parenthesis

`map`, `reduce`, `sum` and `prod` are treated as operations only when
immediately followed by an opening parenthesis. Otherwise they are ordinary
names.

```solve
:sum = 42
:sum + 8 // 50
```

## A mid-line `#word` is a category tag

A `#` followed by a letter, in the middle of a line, is read as a
[category tag](/syntax/category-tags/): `40 #grocery` tags that
line and still calculates to `40`. The boundaries keep it out of ordinary prose
and out of the other things `#` already means:

- A `#` at the very start of a line is a **heading**, not a tag, so a note's
  `#grocery list` title is left alone.
- A `#` followed by a space is a heading or comment as before: `5 # a note`.
- An all-hex run like `#c0ffee` is a [colour](/syntax/colours/), and a tag name
  must start with a letter, so `#12a` is a colour too, not a tag.

The words `total`, `sum`, `count` and `average` in `total of #grocery` are, as
above, recognised only as part of that whole phrase, so a variable named `total`
and the prose "the total of the day" keep working.

## Labels are preserved

A line starting with a label keeps the label and evaluates the rest.

```solve
total: 5 + 3 // 8
```

## When a line is not an expression

A line the engine cannot make sense of is left alone. It does not guess and it
does not partially evaluate. That is the intended behaviour for a document that
is mostly prose with occasional arithmetic in it.
