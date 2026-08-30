---
title: "The nth weekday"
description: The date of the nth, or last, occurrence of a weekday in a month.
---

> **Package:** `DATETIME_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

Some dates are defined by position rather than by number, like the second
Tuesday of a month or its last Friday. This form gives the date of the nth, or
last, occurrence of a weekday in a month.

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
