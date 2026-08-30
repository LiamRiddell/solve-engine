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
