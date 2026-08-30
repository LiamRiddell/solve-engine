---
title: "Displaying dates"
description: Choosing how a date is written out, spelled or numeric.
---

> **Package:** `DATETIME_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

The same date can be written out in different ways, spelled out in full or as a
compact numeric form. A host chooses which the engine shows, and the numeric
forms are locale-neutral while the spelled form follows the configured locale.

A date shows spelled out by default (`Tuesday, March 10, 2026`). A host chooses
another form with the `dateResult.format` formatting setting:

```ts
formatValue(value, { ...settings, dateResult: { format: "iso" } });
```

| `format` | `25/12/2023` shows as |
| --- | --- |
| `"long"` (default) | `Monday, December 25, 2023` |
| `"iso"` | `2023-12-25` |
| `"dmy"` | `25/12/2023` |
| `"mdy"` | `12/25/2023` |

The long form localises its weekday and month names through the configured
locale; the numeric forms are locale-neutral. A time of day is appended only
when the value carries one, so a bare date is never padded with `00:00:00`.
