---
title: "Relative dates"
description: Naming a day by its relation to today, like tomorrow or next friday.
---

> **Package:** `DATETIME_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

A relative date names a day by its relation to today rather than by its
calendar number, the way you would say tomorrow or next friday out loud. Each
resolves against the current date. The answers on this page are worked out for
one fixed moment, noon on Wednesday 11 March 2026 in London, so that they can be
checked; the notepad under each example works them out for your own today.

```solve
now // Wednesday, March 11, 2026, 12:00:00 PM
today // Wednesday, March 11, 2026, 12:00:00 PM
tomorrow // Thursday, March 12, 2026, 12:00:00 PM
yesterday // Tuesday, March 10, 2026, 12:00:00 PM
next friday // Friday, March 13, 2026, 12:00:00 PM
last monday // Monday, March 9, 2026, 12:00:00 PM
```

## What each one means

A few of these read differently from how they are often said, so each is set
out here, against the same fixed moment.

**`today` is the current instant, not the start of the day.** `today` and `now`
are the same moment, with the time of day included, so `tomorrow` and
`yesterday` are that same time a day later or earlier. A count of days from
today includes the part of today already gone, which is why it is usually not a
whole number: at noon, `days until 25 december` is 288.50 days rather than 289.

```solve
today // Wednesday, March 11, 2026, 12:00:00 PM
days until 25 december // 288.50 days
3 days from today // Saturday, March 14, 2026, 12:00:00 PM
3 days before today // Sunday, March 8, 2026, 12:00:00 PM
```

**`next` and `last` step over today.** `next friday` is the first Friday after
today and `last friday` the most recent one before it, so either one said on a
Friday is a week away rather than today. On Wednesday 11 March, `next friday` is
the 13th and `last friday` the 6th, and `next saturday` is the 14th, the day
after that Friday.

```solve
next friday // Friday, March 13, 2026, 12:00:00 PM
last friday // Friday, March 6, 2026, 12:00:00 PM
next saturday // Saturday, March 14, 2026, 12:00:00 PM
```

## The boundary

Some natural spellings are not read at all, and a line that uses one is refused
rather than guessed at. Each has a spelling that works:

| Not read | Write instead |
| --- | --- |
| `3 days ago` | `3 days before today`, or `today - 3 days` |
| `next week` | `today + 1 week` |
| `this friday` | `next friday` (the coming Friday, on any day but a Friday itself) |
| `end of month` | `next month - 1 day` |

Reading `today` as a date with no time of day, or counting `days until` in whole
calendar days, would change the answers described above, so neither is changed
within the current major version.
