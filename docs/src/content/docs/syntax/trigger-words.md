---
title: Trigger words
description: Why ordinary English words are not keywords, and what that means for your notes.
---

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

## Labels are preserved

A line starting with a label keeps the label and evaluates the rest.

```solve
total: 5 + 3 // 8
```

## When a line is not an expression

A line the engine cannot make sense of is left alone. It does not guess and it
does not partially evaluate. That is the intended behaviour for a document that
is mostly prose with occasional arithmetic in it.
