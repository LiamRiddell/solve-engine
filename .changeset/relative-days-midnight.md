---
"solve-engine": minor
---

A host chooses where relative days start with `date.relativeDays`: with `"midnight"` (the default, see the note on the default below) `today`, `tomorrow`, `next friday` and `3 days ago` are dates with no time of day, and `days until` counts whole days

Every relative day has been the current instant moved by whole days, so at noon `tomorrow` is noon tomorrow and `today + 3 weeks` carries the minute the line was typed. That is a fair reading of a clock and the wrong one for a note that plans by the day, where `tomorrow` is a date and a deadline has no time. The new setting lets a host choose. It takes two values: `"midnight"`, which starts each relative day at the start of the day, and `"now"`, which is the reading every version before it had. The default is `"midnight"`; the second changeset of this release, `relative-days-default-midnight`, explains the change and how to keep the old reading.

```ts
createEngine({ config: { date: { relativeDays: "now" } } });
```

At noon on Wednesday 11 March 2026 in London:

| line | `"now"` | `"midnight"` (the default) |
| --- | --- | --- |
| `today` | Wednesday, March 11, 2026, 12:00:00 PM | Wednesday, March 11, 2026 |
| `tomorrow` | Thursday, March 12, 2026, 12:00:00 PM | Thursday, March 12, 2026 |
| `next friday` | Friday, March 13, 2026, 12:00:00 PM | Friday, March 13, 2026 |
| `3 days ago` | Sunday, March 8, 2026, 12:00:00 PM | Sunday, March 8, 2026 |
| `today + 3 weeks` | Wednesday, April 1, 2026, 12:00:00 PM | Wednesday, April 1, 2026 |
| `days until 25 december` | 288.50 days | 289 days |
| `tomorrow - today` | 24:00 | 1 day |
| `2 hours ago` | Wednesday, March 11, 2026, 10:00:00 AM | Wednesday, March 11, 2026, 10:00:00 AM |

The setting reaches `today`, `tomorrow`, `yesterday`, `next` and `last` with a weekday, `this friday` and a bare weekday in a sum, a span of a day or more before `ago`, and the count in `days until` and `days since` (in weeks, months or years too). Under `"midnight"` each is held as a calendar day, so two of them subtract to a count of days, as two written dates do. `today` compiles to a new opcode, `DATE_TODAY`, which pushes exactly what `DATE_NOW` does under `"now"`; `now` still compiles to `DATE_NOW`. A value that is neither `"now"` nor `"midnight"` raises the new `DATE_RELATIVE_DAYS_INVALID` when the engine is built, since a setting quietly ignored is every relative date quietly showing a time.

The boundary, and why. `now` is the current instant under both settings, and so is a span shorter than a day (`2 hours ago`, `hours until 5pm`): those ask about the clock. A time added to the start of the day is a time on it, so `today + 2 hours` is 2:00 AM under `"midnight"`, and `now + 2 hours` is the spelling for two hours from now. The relative dates page sets out both readings.

One repair rides with it, under either setting. On a day whose midnight the zone skips (Santiago springs forward at 00:00, so 6 September 2026 begins at 01:00) a date showed as `Sunday, September 6, 2026, 1:00:00 AM`, and a whole day stepped from it carried the hour on: `6 september 2026 + 1 day` was 1:00 AM on the 7th. A calendar day at the start of its day now shows as a date, and a whole number of days, weeks, months or years from it lands on the start of the day reached. A fraction of a day (`+ 1.5 days`) still lands on the time it names.

| line, in Santiago | before | now |
| --- | --- | --- |
| `6 september 2026` | Sunday, September 6, 2026, 1:00:00 AM | Sunday, September 6, 2026 |
| `6 september 2026 + 1 day` | Monday, September 7, 2026, 1:00:00 AM | Monday, September 7, 2026 |
