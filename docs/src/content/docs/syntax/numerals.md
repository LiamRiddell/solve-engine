---
title: Numerals
description: "Write a number in words, as an ordinal, or in Roman numerals, and read Roman numerals back."
---

> **Package:** `NUMERALS_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

The same number can be written more than one way: `2024`, "two thousand and
twenty-four", `MMXXIV`, or `2024th`. This page converts between the plain figure
and those spellings, useful for a heading, a contract, a clause number, or just
reading a Roman numeral off a monument.

## In words

`as words` spells a number out in full, British style, with the "and" of "one
hundred and five".

```solve
1234 as words // one thousand two hundred and thirty-four
105 as words // one hundred and five
1000000 as words // one million
```

A negative number is spelled with "minus", and a decimal is read digit by digit
after "point" (`3.5` is "three point five").

## As an ordinal

`as ordinal` gives the position form, the one with the little suffix, and gets
the awkward cases right (`11th`, not `11st`).

```solve
3 as ordinal // 3rd
22 as ordinal // 22nd
11 as ordinal // 11th
```

## Roman numerals

`as roman` writes a number in Roman numerals, and `from roman` reads one back.
The reverse takes the numeral in `"quotation marks"`, because the Roman letters
`M C D L X V I` are already used for units and names in the language (`V` is the
volt, `C` is a temperature), so a bare `MMXXIV` would be ambiguous.

```solve
2024 as roman // MMXXIV
1994 as roman // MCMXCIV
"MMXXIV" from roman // 2,024
```

Roman numerals cover the classic range 1 to 3999. A number outside that, or a
string that is not a valid Roman numeral (`"IIII"`, `"IC"`), is reported as an
error rather than guessed at.
