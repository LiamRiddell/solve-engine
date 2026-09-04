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
rather than in yours. A bare date means midnight, so `2026-04-03 in Tokyo` is
the moment that day starts in Tokyo, which for a reader in London is four in the
afternoon on the 2nd. A time of day works the same way: `6pm in Chicago` is six
in the evening there.

| Expression | Result |
| --- | --- |
| `2026-04-03 in Tokyo` | the start of that day in Tokyo |
| `3 April 2026 in Tokyo` | the same, written out |
| `2026-04-03T09:00 in Tokyo` | nine in the morning, Tokyo |
| `6pm in Chicago` | six in the evening, Chicago |
| `2026-04-03 in UTC` | midnight UTC that day |

The result is a date, not a quantity, which is what it used to be: before this,
`2026-04-03 in Tokyo` answered `1,775,170,800,000.00 Tokyo`, the date's internal
millisecond count in a unit named after a city.

A name that is not a zone is refused rather than answered. `2026-04-03 in
Atlantis` says it is not a zone the engine knows and points at the spellings that
work; `2026-04-03 in furlongs` says a date cannot be read in a unit of length,
because the two mistakes have different fixes. An ordinary number is untouched,
so `5 in Tokyo` is still `5.00 Tokyo` and `5 kg in lb` still converts.

The boundary: the zone is recorded on the answer but not yet shown. A date read
in Tokyo displays in your own zone for now, which is why `2026-04-03 in Tokyo`
reads as the afternoon of the 2nd in London rather than as midnight in Tokyo.
Showing an answer in the zone it names is a change to how every date is
displayed, and it is scheduled with the next major version. A host that wants the
whole document computed in one zone can pin it today: see
[dates on Temporal](/guide/dates-on-temporal/#choosing-a-zone-without-temporal).

## Frame rates and timecode

| Expression | Result |
| --- | --- |
| `30 fps` | a rate value |
| `01:02:03:04 at 30 fps` | a video timecode |
| `01:02:03:04 at 30 fps in frames` | the frame count |
