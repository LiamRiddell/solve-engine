---
title: Dates
description: Date literals, arithmetic, relative dates and calendar questions.
---

Results depend on the current date, so these are shown rather than asserted by
the documentation test suite.

## Literals

Several orders are recognised, resolved by the active locale where ambiguous.

| Expression | Meaning |
| --- | --- |
| `25/12/2023` | day, month, year |
| `2023-12-25` | ISO order |
| `2024-5-3` | ISO order, unpadded |
| `25.12.2023` | dot separated |

Write a literal as one run of characters, with no spaces around its
separators. That is what tells a date from the arithmetic it is spelled
identically to: `2024-5-3` is a date, and `2024 - 5 - 3` is 2016. Spacing
decides it on its own, so a padded chain like `2024 - 05 - 03` is subtraction
too.

## Arithmetic

| Expression | Result |
| --- | --- |
| `25/12/2023 + 20 days` | `Sunday, January 14, 2024` |
| `now + 3 hours` | three hours from now |
| `today - 1 week` | this day last week |

## Relative dates

| Expression | Result |
| --- | --- |
| `now`, `today`, `tomorrow`, `yesterday` | the obvious thing |
| `next friday` | the coming Friday |
| `last monday` | the previous Monday |

## Differences

| Expression | Result |
| --- | --- |
| `days until 25/12/2026` | a duration in days |
| `days since 01/01/2023` | a duration in days |
| `weeks between 01/01/2024 and 01/06/2024` | a duration in weeks |

## Working days

Weekends are excluded. Public holidays are not, because that needs a
region-specific and continuously updated calendar, and quietly guessing would be
worse than not offering it.

| Expression | Result |
| --- | --- |
| `25/12/2023 + 5 workdays` | five working days later |
| `workdays in 3 weeks` | the count of working days |
