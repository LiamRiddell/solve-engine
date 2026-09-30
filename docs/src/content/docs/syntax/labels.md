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
