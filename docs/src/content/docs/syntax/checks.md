---
title: Checks
description: Lines that state something the note must keep true, and say at once when it stops holding.
---

> **Package:** `CONDITIONALS_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

A **check** is a line that states something the note should always keep true:
a budget that must cover the spending, two totals that must agree, a formula that
must stay close to a known value. It is the notepad's version of an assertion in
a program, or of a spreadsheet cell that turns red when a figure goes wrong.

Write `check` and a comparison (see [conditionals](/syntax/conditionals/) for
the comparison signs). While it holds, the line shows a quiet tick; the moment an
edit breaks it, the line becomes an error that names both sides, so a mistake is
caught where it happens rather than three lines further down.

```solve-doc
:budget = $1950
:spent = $2010
check :spent <= :budget // ERROR: check failed: $2,010.00 is more than $1,950.00
check 1 km == 1000 m // ✓
```

A check usually reads the lines above it, by name or by line number, which is
why it belongs with the forms that work across lines. Change an input and every
check that depends on it is worked out again:

```solve-doc
:a = 3
:b = 4
check :a^2 + :b^2 == 25 // ✓
check :a^2 + :b^2 == 26 // ERROR: check failed: 25 is not equal to 26
```

## Exact values

A check compares the way the comparison does anywhere else in the note. A
decimal, a fraction, an amount of money and a whole number past 2^53 (the point
beyond which an ordinary floating-point number can no longer hold every whole
number) each hold their value exactly, and are checked on it; only a pair of
approximate numbers, such as the result of a unit conversion, is allowed the
conversion's own rounding. A failed check shows both sides to as many decimal
places as it takes to tell them apart, since at the usual two places `1.845` and
`1.85` would both read `1.85`:

```solve
check 2^53 + 1 > 2^53 // ✓
check 1.845 == 1.85 // check failed: 1.845 is not equal to 1.850
check 10 > 20 // check failed: 10 is not more than 20
```

## Allowing a margin

Two numbers worked out in different ways rarely match to the last digit, so a
check can allow a margin, a tolerance for how far apart the two sides may be and
still count as agreeing. `≈` (or `~=`) means approximately equal, and `within`
says how close is close enough, as a percentage of the right-hand side or as an
amount in the same unit. A passing approximate check says how far apart the two
sides were, and a failing one says by how much it missed.

```solve
check 22/7 ≈ pi within 0.1% // ✓ (differs by 0.04%)
check 5 m ≈ 5.01 m within 1 cm // ✓ (differs by 0.01 m)
check 1/3 ≈ 0.33 within 1% // check failed: 0.333333 differs from 0.33 by 1.01%, more than 1%
```

Without a `within`, `≈` reads the right-hand side as written to the decimal
places it has: the check asks whether the left side is that figure to those
places. Sixty miles an hour is 96.56064 km/h, so it is 96.56 km/h to two places
and not 96.5 to one. A whole number on the right allows no rounding, so `5.4 ≈ 5`
fails, and a figure worked out to every digit, such as `pi`, is held to the
engine's own rounding. Say how close is close enough with `within` whenever the
margin you mean is wider than the last written place.

```solve
check 60 mph ≈ 96.56 km/h // ✓ (differs by 0.000398 mph)
check 60 mph ≈ 96.5 km/h // check failed: 60 mph is not equal to 96.5 km/h
check 1/3 ≈ 0.333 // ✓ (differs by 0.000333)
check 5.4 ≈ 5 // check failed: 5.4 is not equal to 5
```

## Several things at once

One check can state more than one thing. A chain of comparisons, such as
`0 < :a < 10`, says that a value lies between two others: it is read as every
link at once (`0 < :a` and `:a < 10`), the way it is written in mathematics,
and the middle value is worked out once for both links. Comparisons joined
with `and` (or `&&`) are one check of all of them. Either way the check passes
when everything it states holds, and a failure names the first comparison that
does not:

```solve-doc
:a = 3
:b = 4
check 0 < :a < 10 // ✓
check :a > 0 and :b > 0 // ✓
check 1 == 1 == 1 // ✓
check :a > 0 and :b > 10 // ERROR: check failed: 4 is not more than 10
```

A `within` margin belongs to the comparison it is written after, so each part
of a joined check can have its own, and a passing check says how far apart each
approximate part was:

```solve
check 22/7 ≈ pi within 0.1% and 5 m ≈ 5.01 m within 1 cm // ✓ (differs by 0.04% and by 0.01 m)
```

A check states what must hold, so it is not joined with `or`, which would let
a broken part pass unnoticed. To check that one of two things holds, compare
the yes-or-no answer itself (see the next section). Anything else written after
a check's comparison, such as a `|`, is refused rather than applied to the
check's tick:

```solve-doc
check 1 == 1 or 1 == 2 // ERROR: a check states things that must all hold, so it joins them with "and", not "or". To check that one of two things holds, compare the answer, as in "check (:a > 0 or :b > 0) == true"
check (1 == 1 or 1 == 2) == true // ✓
```

A comparison outside a check is unchanged: `1 < 2 < 3` still reads from the
left, as `(1 < 2) < 3`, and the word `and` between two numbers still adds them
(`5 and 3` is 8).

## Yes or no answers

A comparison answers true or false, and two such answers compare as equal or
not, as two pieces of text do. They have no order, so `<` between them is
refused, and `true` is not the number 1.

```solve
check !(1 > 2) == true // ✓
check (2 > 1) == (3 > 2) // ✓
check true == false // check failed: true is not equal to false
```

## Conversions on either side

A side of a check can carry a conversion: a quantity put into another unit
(`in m`), or a number shown in another base (`in hex`, `as binary`; see
[number bases](/syntax/number-bases/)). The conversion belongs to the side it
is written on, and the check compares what the two sides are, not how they are
written. A number shown in hexadecimal is still that number, so it passes
against the same value in decimal, as a kilometre shown in metres passes
against 1,000 metres:

```solve
check 255 in hex == 255 // ✓
check 255 in binary == 0xff in octal // ✓
check 1 km in m == 1000 m // ✓
check 256 in hex == 255 // check failed: 0x100 is not equal to 255
```

The same holds for values from the lines above:

```solve-doc
A = 255
B = 0xff
check A in hex == B in hex // ✓
```

## Colours and addresses

A colour is three channels of light (red, green and blue), and an IP address
is a number that names a machine on a network, often with a prefix (`/24`)
that makes it a block of addresses. Neither is an amount, but either can be
checked for being the same as another, and a check decides it the way `==`
and `!=` do: two colours are equal when their channels are, however each was
written, and two addresses when their family, address, prefix and zone all
match.

```solve
check #ff0000 == rgb(255, 0, 0) // ✓
check #ff0000 != #00ff00 // ✓
check 192.168.1.0/24 != 192.168.1.0/25 // ✓
check fe80::1%eth0 == fe80::1 // check failed: fe80::1%eth0 is not equal to fe80::1
```

Addresses of one family are in order, lowest first, as `<` puts them, so a
check can ask whether one comes before another. A colour has no order, an IPv4
and an IPv6 address have none between them, and a margin means nothing between
two values that are either the same or not, so each of those is refused:

```solve
check 192.168.1.1 < 192.168.1.2 // ✓
check fe80::2 <= fe80::1 // check failed: fe80::2 is more than fe80::1
check #ff0000 < #00ff00 // check: a colour has no order, so two colours can only be compared with == or !=, not <
check 192.168.1.1 < fe80::1 // check: an IPv4 and an IPv6 address have no order between them, so they can only be compared with == or !=, not <
```

A colour or an address against a number is still refused as incomparable: a
check says something about two things of one kind.

## Checks among the other lines

A check line is a statement about the numbers around it, not one of them, so a
`total above` beneath it steps over it, passed or failed:

```solve-doc
£900
£300
check line 1 + line 2 <= £1,000 // ERROR: check failed: £1,200.00 is more than £1,000.00
total above // £1,200.00
```

A program embedding the engine gets a count of passed and failed checks on the
parse result (`checks`, a `{ passed, failed }` pair present only when the
document has any; see [TypeScript usage](/guide/typescript-usage/)), so it can
flag a note whose checks have started failing. Only a line written with `check`
is counted: a piece of text that happens to begin with a tick is text.

## The boundary

`check` only means this at the start of a line that compares two things, so a
variable called `check` (a restaurant bill, say) keeps working:

```solve
check = 45
check * 2 // 90
```

Things that cannot be compared are refused as incomparable rather than reported
as a failed check, since "a metre is not a kilogram" is not a fact about the
note. Text can only be checked for being equal or not, because there is no order
between two pieces of text that a note would mean:

```solve
check 1 m == 1 kg // check: length and mass cannot be compared
check "a" == "a" // ✓
check "a" > "b" // check: text can only be compared with == or !=, not >
check "a " == "a" // check failed: "a " is not equal to "a"
```

A piece of text is quoted in a check's message, so two texts that differ only
by a space can be told apart. Text and a number are two kinds of thing, even
when they read the same, so a check between them is refused and the message
says which side is the text. When the text holds a number, `as number` turns it
into one, and the check can then compare it:

```solve
check 255 == "255" // check: "255" on the right is text and 255 is a number, so they cannot be compared. To read the text as a number, write "255" as number
check (255 in hex) == "0xFF" // check: "0xFF" on the right is text and 0xFF is a number, so they cannot be compared. To read the text as a number, write "0xFF" as number
check "255" as number == 255 // ✓
```

A plain comparison, without `check`, reads the same pair the same way, as two
kinds of thing: `==` answers false and `!=` true, as they do for a length
beside a mass, and an order between text and a number is refused (see
[conditionals](/syntax/conditionals/#comparing-text)). `check` refuses the `==`
too, since a check that cannot hold is a fault in the note, not a failure of
the figures.
