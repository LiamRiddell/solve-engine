---
title: Dates
description: Date literals, arithmetic, relative dates and calendar questions.
---

> **Package:** `DATETIME_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

Every example below is live: edit it and the answer follows. The forms anchored
to a fixed date are proven by the documentation test suite; the ones relative to
now (`next friday`, `age of` today) resolve against the current date, so they
compute here rather than being asserted.

## Literals

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

### Choosing the input order

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

## Arithmetic

A day count crosses month and year boundaries; the relative forms resolve
against now.

```solve
25/12/2023 + 20 days // Sunday, January 14, 2024
```

```solve
now + 3 hours
today - 1 week
```

## Relative dates

```solve
now
today
tomorrow
yesterday
next friday
last monday
```

## Relative months

Each resolves to the first of its month, the same anchor `March 2026` gives, so
it drops in wherever a month is wanted.

```solve
this month
next month
last month
```

## The nth weekday of a month

The date of the nth, or last, occurrence of a weekday in a month. The month is
a fixed anchor (`March 2026`) or a relative one (`next month`), and the result
is an ordinary date that composes further.

```solve
2nd Tuesday of March 2026 // Tuesday, March 10, 2026
4th Thursday of November 2026 // Thursday, November 26, 2026
last Friday of November 2026 // Friday, November 27, 2026
```

```solve
1st Monday of next month
```

An occurrence the month does not have is refused, never wrapped into the next
month: April 2026 has four Fridays, so `5th Friday of April 2026` is an error
rather than the first Friday of May. The bare `next Friday` and `last Monday`
above are untouched: only an ordinal weekday followed by `of` is read this way.

## Age

Whole calendar years from a birth date, reckoned at now unless an `on <date>`
gives another reference. `in years, months and days` asks for the full
breakdown instead of a single count.

```solve
age of 15/06/1990 on 25/12/2030 // 40 years
age of 15/06/1990 on 26/08/2026 in years, months and days // 36 years, 2 months, 11 days
```

```solve
age of 15/06/1990
```

The count walks the calendar rather than dividing a fixed-length span, so the
leap cases are right: a 29 February birth is a year older on 1 March in a
non-leap year, where a 365-day division would drift. This is the calendar-aware
counterpart of `years between`, which divides and is the right tool for a rough
span.

## Differences

A `between` of two fixed dates is proven; a duration to or from now moves with
the day.

```solve
weeks between 01/01/2024 and 01/06/2024 // 21.71 weeks
```

```solve
days until 25/12/2026
days since 01/01/2023
```

## Working days

Deadlines count working days, not calendar days. Weekends are always skipped.
An offset counts forward or back to a working day, and `between` counts the
working days in a window, both ends included.

```solve
25/12/2023 + 5 workdays // Monday, January 1, 2024
working days between 01/01/2024 and 31/01/2024 // 23
workdays in 3 weeks // 15
```

```solve
3 business days from today
```

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
new ExpressionEngine({
  config: { date: { holidays: ["2024-12-25", "2024-12-26"] } },
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

## Displaying dates

A date shows spelled out by default (`Tuesday, March 10, 2026`). A host chooses
another form with the `dateResult.format` formatting setting:

```ts
formatValue(value, { ...settings, dateResult: { format: "iso" } });
```

| `format` | `25/12/2023` shows as |
| --- | --- |
| `"long"` (default) | `Monday, December 25, 2023` |
| `"iso"` | `2023-12-25` |
| `"dmy"` | `25/12/2023` |
| `"mdy"` | `12/25/2023` |

The long form localises its weekday and month names through the configured
locale; the numeric forms are locale-neutral. A time of day is appended only
when the value carries one, so a bare date is never padded with `00:00:00`.
