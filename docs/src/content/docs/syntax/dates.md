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

Deadlines count working days, not calendar days. Weekends are always skipped.
An offset counts forward or back to a working day, and `between` counts the
working days in a window, both ends included.

| Expression | Result |
| --- | --- |
| `25/12/2023 + 5 workdays` | five working days later |
| `5 working days after 20/12/2024` | the same offset, in words |
| `3 business days from today` | three working days ahead |
| `2 working days before 25/12/2024` | counts backwards |
| `working days between 01/01/2024 and 31/01/2024` | `23`, every weekday in January |
| `workdays in 3 weeks` | `15`, the count in a span |

`working` and `business` days mean the same thing, and either reads in the
singular for a count of one (`1 working day after ...`).

### Public holidays

Holidays cannot be worked out from a date the way a weekend can: they depend on
the region and change year to year. So the engine excludes them only when the
host application supplies a calendar, the same way it takes a data source for
stocks or weather. Left unconfigured, working-day arithmetic skips weekends
only, and says as much rather than guessing a holiday it was never told about.

A host passes the calendar as a list of dates or a predicate function:

```ts
new ExpressionEngine("en", false, {
  date: { holidays: ["2024-12-25", "2024-12-26"] },
});
// or: { date: { holidays: (date) => isPublicHoliday(date) } }
```

With that calendar, `1 working day after 24/12/2024` steps over the 25th and
26th to the 27th, and `working days between ...` leaves them out of the count.
The offset forms, `between`, and `<date> + N workdays` all consult it.

`workdays in <span>` and the `is a workday` / `is a weekend` questions stay
weekends-only either way: the first has no date to look a holiday up on, and the
second reports the shape of the week (is this a weekday), not whether a
particular office is open.
