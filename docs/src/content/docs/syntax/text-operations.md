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
"11:00 PM" + 2 // ERROR: Text and a number cannot be added: + joins text only to other text. To add a number held as text, convert it first with "as number".
"5" * 2 // ERROR: Text cannot be used in arithmetic: only numbers and quantities can. To use a number held as text, convert it first with "as number".
```

To join, quote both sides. To do arithmetic with a number that arrives as text,
from a pasted value or a decoded field, convert it first with `as number`, which
reads text only when the whole of it is a number:

```solve
("5" as number) + 5 // 10
"1,234.5" as number // 1,234.50
```

```solve-doc
"11:00 PM" as number // ERROR: "11:00 PM" is not a number: "as number" reads text that is a number and nothing else.
```

Text can hold a number written in another base, as a colour code or a log line
does: hexadecimal (base 16) after `0x`, binary (base 2) after `0b`, octal (base
8) after `0o`. `as number` reads the same prefixes a number typed in a line
does (see [number bases](/syntax/number-bases/)), in either case and after a
sign, and keeps every digit of a large one:

```solve
"0xFF" as number // 255
"0b101" as number // 5
"0o17" as number // 15
"-0xff" as number // -255
"0x20000000000001" as number // 9,007,199,254,740,993
```

A prefix with nothing after it, or a digit its base does not have, is refused
by name, saying which digits the base has:

```solve-doc
"0xZZ" as number // ERROR: "0xZZ" is not a number: after 0x, a hexadecimal number has only the digits 0 to 9 and the letters A to F.
"0b102" as number // ERROR: "0b102" is not a number: after 0b, a binary number has only the digits 0 and 1.
"0x" as number // ERROR: "0x" is not a number: 0x starts a hexadecimal number, and no digits follow it.
```

`int` and `float`, which also read a number out of text, read the same
prefixes and refuse a malformed one with the same message:

```solve
int("0xFF") // 255
float("0b101") // 5
```

```solve-doc
int("0xZZ") // ERROR: "0xZZ" is not a number: after 0x, a hexadecimal number has only the digits 0 to 9 and the letters A to F.
```

The boundary: a base number in text is a whole number, so a point in it
(`"0xFF.8"`) is refused.

A sign before text is arithmetic too. A minus sign turns a number into its
negative, and text has no number to turn, so `-"abc"` is refused rather than
read as 0, and so is `-"5"`, whose digits are still text. The minus binds to
the text before `as number` does, so `-"0xFF" as number` negates the text first
and is refused, with the line it was meant as in the message: put the
conversion in brackets, and the minus applies to the number.

```solve-doc
-"abc" // ERROR: Text cannot be negated: a minus sign works on numbers and quantities, not text. To negate a number held as text, convert it first with "as number", in brackets.
-"0xFF" as number // ERROR: Text cannot be negated: a minus sign works on numbers and quantities, not text. To negate the number "0xFF" holds, convert it first, in brackets: -("0xFF" as number).
```

```solve
-("0xFF" as number) // -255
"-5" as number // -5
```

A plus sign before text is refused the same way, since it is not a conversion
either: `+"5"` points at `"5" as number`.

Earlier
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
with no pattern matching. To find text by its shape rather than its exact
characters, a pattern (a regular expression) does it: see `match` on the
[pasted text page](/syntax/pasted-text/), which also reads the numbers, the
amounts of money and the fields of JSON out of a piece of text.

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

The counts also go by the one-word names spreadsheets and editors use,
`wordcount`, `charcount` and `linecount`, and the case changes by `titlecase`
and `slugify`:

```solve
wordcount("the quick brown fox") // 4
charcount("hello") // 5
linecount("one line") // 1
titlecase("hello world") // Hello World
slugify("Hello World") // hello-world
```

The boundary for counting lines: a quoted string cannot hold a line break, since
the engine reads one line at a time and has no escape for a new line. So `\n`
inside quotes is two characters, a backslash and an `n`, and a quoted string
always has one line.

```solve
lines in "a\nb" // 1
length of "a\nb" // 4
```
