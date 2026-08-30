---
title: "Recurring schedules"
description: Totalling a payment that repeats over a period, exactly for money.
---

> **Package:** `FINANCE_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

A payment that repeats, a subscription, a salary, an instalment plan, adds up to
a total over the time it runs. `<amount> <period> for <duration>` works that
total out in place, so the sum does not have to be calculated elsewhere and typed
back in.

```solve
450 monthly for 18 months // 8,100
12.99 monthly for 2 years // 311.76
2000 every 2 weeks for 6 months // 26,000
```

The period is `daily`, `weekly`, `monthly`, `yearly` (also `annually`), or
`every N days/weeks/months/years`. Money rides along and, where the amount is
exact, so is the total.

```solve
$12.99 monthly for 2 years // $311.76
```

The total is the result. The number of payments is how it is reached, one per
whole period on a scheduling year where a month is one of twelve and a week one
of fifty-two, so `every 2 weeks for 6 months` is thirteen payments over half a
year. A final part-period has not come due, so it is not counted.

```solve
2000 every 2 weeks for 5 weeks // 4,000
```
