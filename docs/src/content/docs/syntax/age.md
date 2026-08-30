---
title: "Age"
description: Whole calendar years from a birth date, or the full breakdown.
---

> **Package:** `DATETIME_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

Age is how many whole calendar years have passed since a birth date. Solve
counts them the way a person does, walking the calendar, so the answer is right
across leap years, and it can give the full years, months and days instead of a
single count.

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
