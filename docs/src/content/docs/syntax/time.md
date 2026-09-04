---
title: Time
description: Clock times, intervals, frame rates and timezones.
---

> **Package:** `TIME_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

## Clock times

| Expression | Result |
| --- | --- |
| `9:00am + 3 hours` | `12:00:00 PM` |
| `16:00` | a time value |

## Intervals

```solve
7:30 to 20:45 // 795 minutes
```

Intervals crossing midnight are handled, so `4pm to 3am` is eleven hours rather
than a negative span.

## Timezones

A time zone is a region that keeps the same clock: when it is nine in the
morning in London it is five in the evening in Tokyo, because the two are eight
hours apart, and that gap changes twice a year where the clocks go forward and
back. Name a city, a country or a standard abbreviation and the engine looks the
zone up for you, using the same zone database your operating system reads, so
the answers follow whatever the rules are this year.

| Expression | Result |
| --- | --- |
| `6pm Sydney in Chicago` | the corresponding local time |
| `time in Paris` | the current time there |
| `time difference between Seattle and Moscow` | the offset |

### A date or a time in a zone

Writing `in <zone>` after a date, or after a time of day, reads it in that zone
rather than in yours, and shows it there. A bare date means midnight, so
`2026-04-03 in Tokyo` is the day that starts in Tokyo, shown as that day. A time
of day works the same way: `6pm in Chicago` is six in the evening there.

| Expression | Result |
| --- | --- |
| `2026-04-03 in Tokyo` | `Friday, April 3, 2026` |
| `3 April 2026 in Tokyo` | the same, written out |
| `3 April 2026 in New York` | `Friday, April 3, 2026`, a two-word name |
| `2026-04-03T09:00 in Tokyo` | `Friday, April 3, 2026, 9:00:00 AM` |
| `6pm in Chicago` | `Friday, September 4, 2026, 6:00:00 PM` |
| `2026-04-03 in UTC` | midnight UTC that day |

The result is a date, not a quantity, which is what it used to be: before this,
`2026-04-03 in Tokyo` answered `1,775,170,800,000.00 Tokyo`, the date's internal
millisecond count in a unit named after a city.

A name that is not a zone is refused rather than answered. `2026-04-03 in
Atlantis` says it is not a zone the engine knows and points at the spellings that
work; `2026-04-03 in furlongs` says a date cannot be read in a unit of length,
because the two mistakes have different fixes. An ordinary number is untouched,
so `5 in Tokyo` is still `5.00 Tokyo` and `5 kg in lb` still converts.

The boundary is how the zone is written. A city name works, including a
two-word one, and so does a standard abbreviation or `UTC`. A signed offset
does not: `2026-04-03 in GMT+9` is read as `(2026-04-03 in GMT) + 9`, which
adds nine milliseconds rather than shifting nine hours, so write `in Tokyo` or
`in JST` instead. A host that wants the whole document computed in one zone can
pin it today: see
[dates on Temporal](/guide/dates-on-temporal/#choosing-a-zone-without-temporal).

## Frame rates and timecode

| Expression | Result |
| --- | --- |
| `30 fps` | a rate value |
| `01:02:03:04 at 30 fps` | a video timecode |
| `01:02:03:04 at 30 fps in frames` | the frame count |
