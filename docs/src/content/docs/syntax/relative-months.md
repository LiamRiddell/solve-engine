---
title: "Relative months"
description: Naming a month by its relation to now, like this month or next month.
---

> **Package:** `DATETIME_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

A relative month names a month by its relation to now rather than by name, the
way you would say this month or next month. Each resolves against the current
date, so it computes here rather than being asserted.

Each resolves to the first of its month, the same anchor `March 2026` gives, so
it drops in wherever a month is wanted.

```solve
this month
next month
last month
```
