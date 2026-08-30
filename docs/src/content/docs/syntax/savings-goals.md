---
title: "Savings goals"
description: Working out how long, or how much per month, to reach a target.
---

> **Package:** `FINANCE_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

A savings goal is the interest maths run backwards: instead of asking what a sum
grows to, you ask how long it takes to reach a target, or how much you must put
aside each period to get there in time.

`how long to save <target> at <amount> <period>` answers the time, and `how much
per month to save <target> in <duration>` answers the contribution.

```solve
how long to save $10,000 at $500 monthly // 20 months
how much per month to save $12,000 in 2 years // $500.00
```

The interest-free forms are exact division. Add `at <rate>` and the money earns
interest on the way, so the goal arrives sooner or the monthly amount is smaller;
the rate compounds monthly.

```solve
how long to save $10,000 at $500 monthly at 12% // 19 months
how much per month to save $12,000 in 2 years at 6% // $471.85
```

The duration answers in the contribution's own unit (`weekly` reads in weeks),
and the count rounds up, because a part period has not yet reached the goal. The
per-month form takes a duration in months or years, and `reach` reads the same
as `save`. A bare-number target answers a bare number.
