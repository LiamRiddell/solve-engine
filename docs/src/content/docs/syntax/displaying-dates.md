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

## Dates before year 1

The calendar counts years from year 1, and a year before it belongs to the era
before the common era, written `BC`: the year before AD 1 is 1 BC, and there is
no year 0 in that count. A date the engine works out before year 1 (going back
far enough from a date it knows) is written with its era, so it cannot be read
as a year of the common era:

```solve
11 March 2026 - 3000 years // Saturday, March 11, 975 BC
1 Jan 0001 - 1 day // Sunday, December 31, 1 BC
1 Jan 0001 // Monday, January 1, 1
```

Only a date before year 1 carries an era; every later date is written as it
always was, with no `AD`. The era is spelled in the formatting locale, so
`de-DE` writes `v. Chr.`.

The numeric forms follow the same rule in their own way. `"dmy"` and `"mdy"`
put the era after the year (`11/03/975 BC`). `"iso"` follows ISO 8601, the
international standard for writing dates as numbers, which counts years
astronomically: 1 BC is year `0000`, 2 BC is `-000001`, and 975 BC is
`-000974`. A year before 0 or after 9999 is written with a sign and six digits,
and a year below 1000 keeps four (`0975-03-11`), which is how the standard
spells them.

| `format` | 3000 years before 11 March 2026 shows as |
| --- | --- |
| `"long"` (default) | `Saturday, March 11, 975 BC` |
| `"iso"` | `-000974-03-11` |
| `"dmy"` | `11/03/975 BC` |
| `"mdy"` | `03/11/975 BC` |

A year written with four digits is the year it says, the first century
included: `3 April 0026` is 26 AD, not 1926, and `1 Jan 0001` is the first day
of the common era.

```solve
3 April 0026 // Friday, April 3, 26
days between 1 Jan 0001 and 1 Jan 0002 // 365 days
```

The boundary: dates are worked out on the Gregorian calendar all the way back
(the proleptic Gregorian calendar, which `Date` and `Temporal` both use), not
on the Julian calendar in use before 1582, so a historical date is the day the
Gregorian rules name. A date before year 1 can be worked out and shown, but not
typed: `975 BC` is not read as a date, and neither is the expanded ISO spelling
`-000974-03-11` that the `"iso"` form writes.
