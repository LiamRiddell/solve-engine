---
title: "Date arithmetic"
description: Adding and subtracting days, weeks and hours from a date.
---

> **Package:** `DATETIME_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

Adding a span to a date moves it forward, and subtracting one moves it back, so
you can ask what day falls twenty days after a fixed date, or three hours after
now. The forms anchored to a fixed date are proven here; the ones relative to
now resolve against the current date, so they compute rather than being
asserted.

A day count crosses month and year boundaries; the relative forms resolve
against now.

```solve
25/12/2023 + 20 days // Sunday, January 14, 2024
```

```solve
now + 3 hours
today - 1 week
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
3 days from today
```

The connector is only read this way when a span is in front of it, which is what
keeps `$1,000 after 3 years at 7%` an investment. `to` is deliberately not
claimed at all: `2 April 2026 to 6 September 2026` already means something, and
quietly turning it into an offset would take that away.

For a span that skips weekends and holidays, `30 working days from 3 March 2026`
is the sibling form; see [working days](/syntax/working-days/).
