---
title: "Date differences"
description: The span between two dates, or the time until or since one.
---

> **Package:** `DATETIME_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

A date difference measures the span between two dates, in whichever unit you
ask for, or the time until or since a single date reckoned from now. The
`between` of two fixed dates is proven here; a duration to or from now moves
with the day.

A `between` of two fixed dates is proven; a duration to or from now moves with
the day.

```solve
weeks between 01/01/2024 and 01/06/2024 // 21.71 weeks
```

```solve
days until 25/12/2026
days since 01/01/2023
```
