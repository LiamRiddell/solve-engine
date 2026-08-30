---
title: "Relative dates"
description: Naming a day by its relation to today, like tomorrow or next friday.
---

> **Package:** `DATETIME_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

A relative date names a day by its relation to today rather than by its
calendar number, the way you would say tomorrow or next friday out loud. Each
resolves against the current date, so it computes here rather than being
asserted.

```solve
now
today
tomorrow
yesterday
next friday
last monday
```
