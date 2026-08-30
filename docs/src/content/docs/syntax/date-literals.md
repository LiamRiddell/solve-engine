---
title: "Date literals"
description: Writing a date in several orders, and choosing how a numeric date is read.
---

> **Package:** `DATETIME_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

A date literal is one specific calendar day written out, like the 25th of
December 2023. Solve reads several orders, so you can write a date the way you
already do, and a setting fixes which order a purely numeric date is read in.

Several orders are recognised.

```solve
25/12/2023 // Monday, December 25, 2023
2023-12-25 // Monday, December 25, 2023
2024-5-3 // Friday, May 3, 2024
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

By default a slash date is read day first (`25/12/2023`) and a hyphen date
month first unless it starts with a four-digit year, which makes it ISO. A US
reader's `12/25/2023` therefore does not parse, because day 25 of month 12 is
read as month 25. Fix the order for every numeric separator with the
`date.inputOrder` setting:

```ts
new ExpressionEngine({ config: { date: { inputOrder: "MDY" } } });
```

| `inputOrder` | `12/25/2023` | `25/12/2023` | `2023/12/25` |
| --- | --- | --- | --- |
| `"auto"` (default) | not a date | 25 December 2023 | not a date |
| `"MDY"` | 25 December 2023 | not a date | not a date |
| `"DMY"` | not a date | 25 December 2023 | not a date |
| `"YMD"` | not a date | not a date | 25 December 2023 |

Only the all-numeric literals are affected. A spelled-out month (`March 9,
2024`) is never ambiguous, and a full ISO timestamp is always read as ISO.
