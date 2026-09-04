---
title: "Date literals"
description: Writing a date in several orders, and choosing how a numeric date is read.
---

> **Package:** `DATETIME_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

A date literal is one specific calendar day written out, like the 25th of
December 2023. Solve reads several orders, so you can write a date the way you
already do, and a setting fixes which order a purely numeric date is read in.

Several orders are recognised. Slashes, hyphens and dots all work, and the
month may be spelled out.

```solve
25/12/2023 // Monday, December 25, 2023
2023-12-25 // Monday, December 25, 2023
2024-5-3 // Friday, May 3, 2024
25.12.2023 // Monday, December 25, 2023
March 9, 2024 // Saturday, March 9, 2024
```

Write a literal as one run of characters, with no spaces around its
separators. That is what tells a date from the arithmetic it is spelled
identically to: `2024-5-3` is a date, and the same digits spaced out are
subtraction.

```solve
2024 - 5 - 3 // 2,016
```

Spacing decides it on its own, so a padded chain like `2024 - 05 - 03` is
subtraction too.

## Choosing the input order

An all-numeric date can mean two different days. `03/04/2026` is the 3rd of
April to most of the world and the 4th of March in the United States, and
nothing in the characters says which. The input order is how you settle it.

By default a slash date is read day first (`25/12/2023`) and a hyphen date
month first (`12-25-2023`), unless it starts with a four-digit year, which
makes it ISO. Fix the order for every numeric separator with the
`date.inputOrder` setting:

```ts
new ExpressionEngine({ config: { date: { inputOrder: "MDY" } } });
```

| `inputOrder` | `12/25/2023` | `25/12/2023` | `2023/12/25` | `2023-12-25` | `25.12.2023` |
| --- | --- | --- | --- | --- | --- |
| `"auto"` (default) | refused | 25 December 2023 | 6.74 | 25 December 2023 | 25 December 2023 |
| `"MDY"` | 25 December 2023 | refused | 6.74 | 25 December 2023 | refused |
| `"DMY"` | refused | 25 December 2023 | 6.74 | 25 December 2023 | 25 December 2023 |
| `"YMD"` | refused | refused | 25 December 2023 | 25 December 2023 | refused |

"Refused" means the line reports what is wrong with the date rather than
answering something else; the next section covers what it says and how to turn
it off. `2023/12/25` is the one cell that stays arithmetic: a four-digit group
at the START of a slash run is ordinary division, because `1000/10/5` is 20
and people write that constantly.

Only ambiguous literals are affected. A spelled-out month (`March 9, 2024`) is
never ambiguous, and neither is a hyphen date that starts with a four-digit
year: `2023-12-25` has no reading but year, month, day, so it is read as ISO
whichever order is set, timestamp or not.

## Reading the order from the reader's machine

A host that runs on the reader's own machine can ask the machine instead of
choosing for everybody. `"locale"` reads the day, month and year order the
operating system writes dates in, so a British notepad reads day first and an
American one month first, with no setting to explain to anybody:

```ts
const engine = createEngine({ config: { date: { inputOrder: "locale" } } });
```

A host that is not the reader (a server rendering someone else's document)
names the reader instead, with a BCP-47 language tag:

```ts
createEngine({ config: { date: { inputOrder: "locale", inputLocale: "en-US" } } });
```

`inputLocale` is read only when `inputOrder` is `"locale"`. Setting it beside
any other order changes nothing at all, which is deliberate: a field that
quietly switched inference on would turn a predictable mistake into a wrongly
read document rather than into no change.

Whatever you choose, `getDateReading()` reports what the engine settled on,
and where it came from. It is what a settings panel shows and what a bug
report should carry:

```ts
createEngine({ config: { date: { inputOrder: "locale" } } }).getDateReading();
// { order: "DMY", orderSource: "host-locale", locale: "en-GB" }
```

`orderSource` is one of `"config"` (you named an order), `"locale"` or
`"host-locale"` (it was read from a tag), `"separator"` (the `"auto"`
default), or `"fallback"`, which means inference was asked for and could not
be made, so the engine is reading dates exactly as `"auto"` does. A
`"fallback"` is worth surfacing: it is the case where a reader should be
offered the choice by hand.

## When a date cannot be read

A run of digits that is shaped like a date but that the chosen order cannot
read is not answered as arithmetic. It says what is wrong.

There are two things that can be wrong, and they are separate because their
fixes are. The order might be wrong, in which case the reading that would work
is named:

```solve-doc
12/25/2023 // ERROR: "12/25/2023" is not a date read day first: there is no month 25. Read month first it is 25 December 2023. Set date.inputOrder to "MDY" to read numeric dates month first.
```

Or the date might not exist in any order, in which case no order is suggested,
because none would help:

```solve-doc
31/04/2026 // ERROR: "31/04/2026" is not a real date: April 2026 has 30 days.
2026-02-29 // ERROR: "2026-02-29" is not a real date: February 2026 has 28 days.
29 February 2026 // ERROR: "29 February 2026" is not a real date: February 2026 has 28 days.
```

Both are ordinary error results on the line, not exceptions, and they carry
through the rest of the expression, so `31/02/2026 + 1 day` reports the date
rather than answering a day count built on one that does not exist.

Before this behaviour existed, each of those lines answered a number instead:
`12/25/2023` was 0.00, `31/04/2026` was 0.00, `2026-02-29` was 1,995, and
`29 February 2026` was a fourteen-digit number, 29 multiplied by the instant
of the 1st of February. If a document relied on one of them,
`date.onAmbiguous` puts every one of those numbers back:

```ts
new ExpressionEngine({ config: { date: { onAmbiguous: "arithmetic" } } });
```

The boundary, deliberately: only a run that could not be arithmetic is
refused. A four-digit group at the START of a slash run is left alone
(`1000/10/5` is 20, `1024/8/2` is 64), and so is a run whose groups are all
one or two digits (`12/13/14` is 0.07), because a two-digit year is too weak a
signal to hang a refusal on.

```solve
1000/10/5 // 20
1024/8/2 // 64
12/13/14 // 0.07
```

The one refusal `onAmbiguous` cannot switch off is the dot form, and it is the
one place this release takes an answer away. The dot form used to ignore
`date.inputOrder` altogether and always read day first, so a month-first engine
answered `25.12.2026` as 25 December while refusing `12.25.2026` outright. Both
were wrong for that reader, and in opposite directions.

| on a month-first engine | before | now |
| --- | --- | --- |
| `25.12.2026` | Friday, December 25, 2026 | refused: not a date read month first |
| `12.25.2026` | a parse error | Friday, December 25, 2026 |

There is no arithmetic reading to fall back to here, because two dots are not
division, which is why the setting cannot restore the old answer.
