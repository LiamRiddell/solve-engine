---
title: "Relative months"
description: Naming a month by its relation to now, like this month or next month.
---

> **Package:** `DATETIME_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

A relative month names a month by its relation to now rather than by name, the
way you would say this month or next month. Each resolves against the current
date. The answers shown are for 11 March 2026, the fixed date these pages are
checked against, and the notepad works them out for your own today.

Each resolves to the first of its month, the same anchor `March 2026` gives, so
it drops in wherever a month is wanted.

```solve
this month // Sunday, March 1, 2026
next month // Wednesday, April 1, 2026
last month // Sunday, February 1, 2026
```
