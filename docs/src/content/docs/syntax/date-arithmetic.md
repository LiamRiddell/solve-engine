---
title: "Date arithmetic"
description: Adding and subtracting days, weeks and hours from a date.
---

> **Package:** `DATETIME_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

Adding a span to a date moves it forward, and subtracting one moves it back, so
you can ask what day falls twenty days after a fixed date, or three hours after
now. A form relative to now resolves against the current date. The answers
shown for those are worked out for noon on Wednesday 11 March 2026 in London, the fixed moment these pages are checked against, and the notepad works them out for
your own now.

A day count crosses month and year boundaries; the relative forms resolve
against now.

```solve
25/12/2023 + 20 days // Sunday, January 14, 2024
```

```solve
now + 3 hours // Wednesday, March 11, 2026, 3:00:00 PM
today - 1 week // Wednesday, March 4, 2026, 12:00:00 PM
```

## The same sum in words

`from`, `after` and `before` put the span in front of the date, which is how a
deadline, a notice period or an invoice term is usually written down. They are
the operators above in words, so they answer the same thing.

```solve
30 days from 3 March 2026 // Thursday, April 2, 2026
2 weeks after 3 March 2026 // Tuesday, March 17, 2026
30 days before 3 March 2026 // Sunday, February 1, 2026
3 months from 3 March 2026 // Wednesday, June 3, 2026
```

`from` and `after` count forward and `before` counts back. The anchor can be any
date the engine reads, including a relative one:

```solve
3 days from today // Saturday, March 14, 2026, 12:00:00 PM
```

The connector is only read this way when a span is in front of it, which is what
keeps `$1,000 after 3 years at 7%` an investment. `to` is deliberately not
claimed for an offset, because between two dates it already means something:
the span from the first to the second, in days, which `in weeks` converts. A
later date first gives a negative span, as subtracting them does. Between two
numbers the same word is a [percentage change](/syntax/percentages/), and a
date against a number has neither reading, so it is refused.

```solve
2 April 2026 to 6 September 2026 // 157 days
(1 Jan 2026 to 1 Mar 2026) in weeks // 8.43 weeks
1 Mar 2026 to 1 Jan 2026 // -59 days
```

Two dates on a midnight are counted in calendar days, as `days between` counts
them, so a change of clocks inside the span does not make it a day short.

For a span that skips weekends and holidays, `30 working days from 3 March 2026`
is the sibling form; see [working days](/syntax/working-days/).
