---
title: Text operations
description: "Measure, test and reshape a piece of text: length, case, trimming, membership and counts."
---

> **Package:** `TEXT_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

A piece of text in quotation marks, `"hello"`, is a value the same way a number
is. This page is what you can *do* with one: measure how long it is, ask whether
it contains something, and reshape it, uppercase it, trim the stray spaces off
it, turn a title into the hyphenated form a web address uses. It is the everyday
string handling a note often needs alongside its sums, kept in the same place as
the sums.

Everything here works on text. Give an operation a number or another kind of
value and it reports an error rather than guessing, the same discipline the rest
of the engine follows.

## Joining text

A plus joins text to text, end to end.

```solve
"hello" + " world" // hello world
```

The two sides must both be text to join. When one side is a number there is no
answer the engine could give honestly: `"5" + 5` could mean 10 or `55`, and a
time written as text, `"11:00 PM"`, is not a number of hours to add 2 to. So
arithmetic with text on either side is refused by name, for `-`, `*` and `/` as
well as `+`.

```solve-doc
"11:00 PM" + 2 // ERROR: Text and a number cannot be added: + joins text only to other text. Write the number without quotes to add it.
"5" * 2 // ERROR: Text cannot be used in arithmetic: only numbers and quantities can. Write the number without quotes.
```

To add, write the number without quotes; to join, quote both sides. Earlier
versions read the text as a number instead, its leading digits or 0, so
`"11:00 PM" + 2` answered 13, which is why it is now an error rather than a
guess.

## Measuring text

`length of` counts the characters. `words in`, `characters in` and `lines in`
count what they name, a word being a run of non-space characters, a line being a
stretch between line breaks.

```solve
length of "hello" // 5
words in "the quick brown fox" // 4
characters in "hello" // 5
```

Counting is by the characters a reader sees, not by how the text is stored.
Some characters on screen are several pieces underneath: a thumbs-up with a skin
tone is the thumb plus a tone modifier, a flag is two letter-like symbols, and an
accent can be a separate mark laid over its letter. Each of those counts as the
one character it looks like, and `reverse` keeps each one whole rather than
splitting the tone from its thumb.

```solve
characters in "👍🏽" // 1
length of "🇬🇧" // 1
reverse "👍🏽a" // a👍🏽
```

The boundary: this uses the runtime's text segmenter (`Intl.Segmenter`), which
every current browser and Node.js provide. On an older runtime without one,
counting falls back to Unicode code points, which keeps an emoji whole but counts
a skin tone or a flag as two.

## Testing text

`contains` asks whether one piece of text appears inside another; `starts with`
and `ends with` ask about the two ends. Each answers `true` or `false`, so they
sit naturally inside a condition.

```solve
"hello" contains "ell" // true
"hello" starts with "he" // true
"report" ends with "port" // true
```

## Reshaping text

`trim` removes the leading and trailing spaces (the ones that creep in from a
copy and paste); `reverse` turns the characters back to front; `X repeated N
times` repeats the text.

```solve
trim "  spaced out  " // spaced out
reverse "hello" // olleh
"ha" repeated 3 times // hahaha
```

`replace` swaps every occurrence of one piece of text for another. It is written
as a function, `replace(text, find, replacement)`, rather than the sentence
"replace A with B in C", because "with" already means addition in this language
(`40 with 2` is 42), so the sentence form would be read as a sum.

```solve
replace("banana", "a", "@") // b@n@n@
```

The replacement is literal: `find` is matched exactly, character for character,
with no pattern matching. (Regular expressions are a possible later addition.)

## Changing case

`as upper`, `as lower`, `as title` and `as slug` convert the case. A **slug** is
the lowercase, hyphenated form a title takes in a web address, so
`"Hello, World!"` becomes `hello-world`.

```solve
"hello world" as upper // HELLO WORLD
"HELLO" as lower // hello
"the lord of the rings" as title // The Lord Of The Rings
"Hello, World!" as slug // hello-world
```

## Function spellings

Every measuring and reshaping form also has a call spelling, for when that reads
more naturally in the middle of a longer line: `length("hi")`, `upper("hi")`,
`slug("A B C")`, `words("one two")`, `replace(...)`. They are the same
operations under a different notation.

```solve
length("hello") // 5
upper("hi there") // HI THERE
```
