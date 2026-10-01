---
title: Labels
description: A few words that name a line's figure, with or without a colon, and which lines of prose stay prose.
---

A label is a name for the figure on a line: the `Rent` in `Rent: $1200`. It is
what turns a column of numbers into a budget you can read, and the engine keeps
it as text and works out the rest of the line. The answer is the figure alone,
so a `total above` or a lone `sum` under the column adds up the amounts, never
the words.

## A label before a colon

Words and then a colon make a label, whatever follows the colon: an amount, or a
whole expression.

```solve
Rent: $1200 // $1,200.00
pi approximation: 355/113 // 3.14
total: 5 + 3 // 8
Groceries: 45 // 45
```

The expression after the colon is read exactly as it would be on a line of its
own, colons of its own included. A range inside a call, the `1000:1002` of
`total(1000:1002)` (the whole numbers from 1,000 to 1,002), keeps its meaning
after a label: a label stands at the start of the line, never inside a bracket,
so a colon inside one is never taken for the label's. That line used to be
refused as the time of day "1000:1002".

```solve
Total: total(1000:1002) // 3,003
Total: total(1,000:1,002) // 3,003
Cost: total(10:12) // 33
Squares: sum(x^2, 1:3) // 14
```

One letter is a word too, so `x: 3` is a label, the way `A: 40` and `B: 55`
label a ledger. The label is only a name for the figure: it never reads or
changes a variable called the same, so with `x = 2` above it, `x: 3` is 3 and
`x` is still 2. A colon has no other meaning here to fall back on: a ratio is
written `ratio(x, 3)` (see [ratios](/syntax/ratios/)), a colon between two
numbers is a clock time, and a variable is set with `:x = 3` or `x = 3`.

```solve-doc
x = 2 // 2
x:3 // 3
x + 1 // 3
```

## What can stand before the colon

A label is a name, the way a ledger names a figure: words, with the numbers and
joining marks a name has. `Week 12`, `Year-end`, `Cost/unit` and `Food + drink`
are all names, so each is a label and the figure after the colon is the answer:

```solve
Week 12: 75 // 75
Item 2: 45 // 45
Weeks 1-2: 40 // 40
Year-end: 5 // 5
Food + drink: $40 // $40.00
Done?: 5 // 5
Orders over $100: 12 // 12
```

A number in a name and the figure after it can look like a clock time: in
`Item 2: 45` the 2 and the 45 are also a quarter to three. What tells them
apart is the space. A time is written with its colon touching the minutes, and
a label's colon has a space after it, as in prose, so when a name stands before
the number and a space follows the colon, the colon is the label's and the
figure is the answer. Without the space, `Item 2:45` is the word `Item` beside
the time 2:45, which the line cannot work out, and with no name before the
number, `9: 30` is still half past nine:

```solve-doc
Room 4: 12 // 12
Item 2:45 // ERROR: Expected an operator or the end of the line, but found "2:45"
9: 30 // Wednesday, March 11, 2026, 9:30:00 AM
```

A name here is a word with only the numbers and joining marks (`-`, `/`) of a
name between it and the colon, as in `Weeks 1-2` or `Part 1/2`. A word that
leads into a time is not a name, so `before 9: 30` keeps its time, and nor is an
operator or `=`: `x = 5: 6` sets `x` to the time 5:06.

A colon has other jobs too, and when the text before it is doing something
other than naming, reading it as a label would throw that text away and answer
with whatever followed: `1 + 24:00` used to answer 0. So the text before the
colon is refused, with what it is instead, when it is:

- **Part of a time.** A colon between two numbers belongs to a clock time, so a
  number that starts the line, follows an operator or follows a label's colon
  is an operand, and a pair that is no real time (`24:00`, a seconds field of
  99) is refused as one. A number that follows a word, as in `Week 12`, is part
  of the name.
- **A figure in another script's digits.** Numbers are read in the digits 0 to
  9 only. A figure written in another script's digits (Arabic-Indic `٢٤`,
  Devanagari `२४`, fullwidth `１２`) is not read as a number, and stood where a
  number would start, it is not a name either: `٢٤:00` is the time it looks
  like. It is refused by name, spelled in 0 to 9. After a word it is part of
  the name, as a number is (`Week ٢: 5`).
- **A choice written with `?` and `:`.** There is no such operator; the refusal
  spells the line as the `if ... then ... else` the engine reads (see
  [conditionals](/syntax/conditionals/)).
- **A comparison.** `>`, `<`, `>=`, `<=`, `==` or `!=` written as a symbol make
  the text a condition, not a name. The same idea written in words
  (`Orders over $100`) is a name and stays a label.
- **A figure with an invisible character in it.** Some characters take up no
  space on screen: the direction marks and overrides that tell a display which
  way text runs (used for right-to-left scripts such as Arabic and Hebrew), a
  zero-width joiner, a soft hyphen. Typed against a number, one makes it a word
  the engine cannot read as a number, so stood where a number would start, it
  is not a name either: `<U+202E>24:00` is the time 24:00 with a right-to-left
  override in front of it. It is refused by name, with the character written as
  its code point, so the reader can delete it. A direction mark or override
  gets the same refusal it gets in any name.
- **A calculation with no word in it**, such as `(1+2)`, which names nothing.
  A bracketed figure such as `(24)` or `[24]` is one too: brackets with no word
  beside them are an expression, not a name.

```solve-doc
1 + 24:00 // ERROR: "24:00" is not a valid time
1:23:99 // ERROR: "1:23:99" is not a valid time
Total: 24:00 // ERROR: "24:00" is not a valid time
Total: 1000:1002 // ERROR: "1000:1002" is not a valid time
true ? 25 : 30 // ERROR: There is no choice written with "?" and ":": write if true then 25 else 30
a > b: 1 // ERROR: "a > b" before the colon is a comparison, not a label: a label names the figure in words, and a choice is written if ... then ... else
(1+2): 5 // ERROR: "(1+2)" before the colon is a calculation, not a label: a label names the figure in words
(24):00 // ERROR: "(24)" before the colon is a calculation, not a label: a label names the figure in words
Total (2026): 500 // 500
```

A bracketed figure before a time's colon used to be read as a label: `(24):00`
was the label `(24)` and answered the 0 after the colon, and `[24]:00` and
`(9):30` did the same. A bracket beside a word is still part of a name, as in
`Total (2026)` above, and `(net): 5` is a label too.

A figure with an invisible character in it was read the same way, since the
character made the figure a word: a right-to-left override in front of
`24:00` answered 0. Each is now refused with the character named, as the
zero-width joiner here:

```solve-doc
‍24:00 // ERROR: "<U+200D>24" holds U+200D (zero width joiner), an invisible character, so it is read as a word and not as the number 24. A number cannot hold one: delete it and type the number again.
```

The boundary: a label of words keeps these characters, since a label is text,
and a right-to-left label needs the direction marks to show correctly, so
`Rent` followed by a right-to-left mark and `: 5` is still 5. A figure after a
word is part of the name, as it is for a number in 0 to 9. The zero-width space
and the byte-order mark are read as spaces wherever they stand, so a time with
one in front is the time it looks like.

The figure after a label is the start of the expression, so `Total: 24:00` is
the time 24:00 and is refused as `24:00` alone is. It used to be read as a second
label, `24`, and answered 0, and `Total: 1000:1002` answered 1,002. A pair like
`1000:1002` is no time, and at the start of an expression it is no range either
(a range is read only as the list of `sum`, `prod`, `map` or `reduce`), so it is
refused in the same words as on a line of its own; `Total: sum(1000:1002)` adds
the range up.

A figure in another script's digits used to be read as a label, since the
engine reads such a figure as a word: `٢٤:00` answered the `00` after the
colon, 0, and `Total: ٢٤:00` did the same. The line is now refused by name,
with the figure written in the digits the engine reads, so retyping it gives
the answer:

```solve-doc
٢٤:00 // ERROR: "٢٤" is written in digits the engine does not read: numbers are written in the digits 0 to 9, as in 24
Total: ٢٤:00 // ERROR: "٢٤" is written in digits the engine does not read: numbers are written in the digits 0 to 9, as in 24
Start: ٩:٣٠ // ERROR: "٩" is written in digits the engine does not read: numbers are written in the digits 0 to 9, as in 9
Week ٢: 5 // 5
```

The boundary: only a figure that stands before a colon, where a label would
otherwise swallow it, is refused this way. The same figure elsewhere on a line
is a word the engine does not know, and is refused as one (`٢٤ + 1` names `٢٤`
as an undefined name), so no line answers a number for digits the engine
cannot read. Reading those digits as numbers is a larger change to how a line
is read, and is not made here.

When the expression after a label cannot be worked out, the line says what is
wrong with the expression, in the words that expression gets on a line of its
own. It used to report only that the label's colon was unexpected, which is true
of the line but says nothing a reader can act on.

```solve-doc
Total: average(10:12) // ERROR: In average(...), 10:12 is a clock time, not a range, and a time cannot be averaged: a colon between two numbers is a range only as the list of sum, prod, map or reduce. To average numbers, list them with commas, as in average(1, 2, 3).
Total: (1 + 2 // ERROR: The line ends where ")" was expected
Rent: $1200 + // ERROR: The line ends after "+", where a value was expected
```

A colon followed by `=` keeps the line's own wording, since `x := 5` is an
assignment written another language's way, and that refusal says to assign
with `=` on its own.

The boundary: arithmetic between words stays a label (`Food + drink`,
`Year-end`, `Q1/Q2`), since that is how ledgers name things and the figure after
the colon is still the one the reader wrote. A question mark that ends the
label (`Done?: 5`) is part of the name, but one with more words after it
(`Paid? yes: 5`) reads as the start of a choice and is refused. And a pair
after an operator is read as a time only when it is written as one, with the
colon touching both numbers: in `Score >= 90: 12` the colon has a space after
it, so the text before it is judged as a label, and refused as a comparison
rather than as the time 90:12.

## A label without the colon

The colon is the part people leave out, and other notepads read a line without
it. A run of words followed by one amount of money or one quantity reads the
same way: the words are the label and the amount is the answer.

```solve
Rent $1200 // $1,200.00
Flight to Paris $450 // $450.00
Petrol 40 l // 40.00 l
Fees 45 EUR // €45.00
```

So a budget typed that way totals as it is written:

```solve-doc
Rent $1200 // $1,200.00
Food $300 // $300.00
sum // $1,500.00
```

The label's words can include a word the engine also reads, such as the `to`
in `Flight to Paris`, since it is the amount at the end of the line that makes
the line a label. A markdown list marker in front and a `#tag` or a `//`
comment after are read as they are anywhere else.

## Which lines stay prose

A note is mostly prose, and a sentence often has a number in it. Only a line
that does not work out as it stands can become a label, and only in the shape
a ledger line has, so these stay sentences:

```solve-doc
I walked 5 km to the shop // ERROR: Expected an operator or the end of the line, but found "walked"
Meeting at 3 in room 4 // ERROR: Expected an operator or the end of the line, but found "at"
Chapter 12 // ERROR: Expected an operator or the end of the line, but found "12"
Back in 5 min // ERROR: Expected an operator or the end of the line, but found "5"
Remember the $5 // ERROR: Expected an operator or the end of the line, but found "the"
```

What makes the difference, line by line:

- **The amount ends the line.** Anything after it (`5 km to the shop`) leaves
  the line alone.
- **The amount is money or a quantity.** A bare number after words is not
  taken, because nothing tells `Groceries 45` from `Chapter 12`, `Room 4` or
  `Page 3`, which are names rather than amounts. Write the colon for a plain
  number: `Groceries: 45`.
- **The label is only words and ends on one that names something.** A number
  inside it, or a word that only leads into the amount (`in`, `at`, `to`,
  `the`, `my`, `about`, `is`), makes the line a sentence about the amount
  rather than a line naming it.

The boundary: a line that already works out is never read as a label, and nor
is one that parses and fails as it runs. `Refund -$50` is the subtraction
`Refund - $50`, which fails because nothing defines `Refund`; write the colon
for a negative amount.

```solve-doc
Refund -$50 // ERROR: Undefined variable: Refund
Refund: -$50 // -$50.00
```

A line of words ending in an amount is read as a label wherever it stands, a
sentence such as `I paid $5` included, since that is the ledger's own shape.
The totals that read a column, and how a lone `sum` or `total` totals the block
above it, are on [line references](/syntax/line-references/).
