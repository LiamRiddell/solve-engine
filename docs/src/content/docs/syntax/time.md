---
title: Time
description: Clock times, intervals, frame rates and timezones.
---

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

| Expression | Result |
| --- | --- |
| `6pm Sydney in Chicago` | the corresponding local time |
| `time in Paris` | the current time there |
| `time difference between Seattle and Moscow` | the offset |

## Frame rates and timecode

| Expression | Result |
| --- | --- |
| `30 fps` | a rate value |
| `01:02:03:04 at 30 fps` | a video timecode |
| `01:02:03:04 at 30 fps in frames` | the frame count |
