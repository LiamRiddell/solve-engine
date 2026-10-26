---
"solve-engine": minor
---

`today`, `tomorrow`, `yesterday` and the relative days (`next friday`, `3 days from today`, `today + 3 weeks`) now name a day, at local midnight, so they show as a date with no time of day; `now` stays the instant

A note that asks about a day expects a date back. `today + 3 weeks` showed `Wednesday, October 28, 2026, 3:01:59 PM`, the minute the line was typed carried onto a deadline. Relative days now start at the start of the day by default, so the same line shows `Wednesday, October 28, 2026`, and `now` is still the way to ask for the current instant with its time.

This changes the default of `date.relativeDays`, which was `"now"` and is now `"midnight"`. At noon on Wednesday 11 March 2026 in London:

| line | before | now |
| --- | --- | --- |
| `today` | Wednesday, March 11, 2026, 12:00:00 PM | Wednesday, March 11, 2026 |
| `tomorrow` | Thursday, March 12, 2026, 12:00:00 PM | Thursday, March 12, 2026 |
| `next friday` | Friday, March 13, 2026, 12:00:00 PM | Friday, March 13, 2026 |
| `3 days ago` | Sunday, March 8, 2026, 12:00:00 PM | Sunday, March 8, 2026 |
| `today + 3 weeks` | Wednesday, April 1, 2026, 12:00:00 PM | Wednesday, April 1, 2026 |
| `days until 25 december` | 288.50 days | 289 days |
| `tomorrow - today` | 24:00 | 1 day |
| `now` | Wednesday, March 11, 2026, 12:00:00 PM | unchanged |
| `2 hours ago` | Wednesday, March 11, 2026, 10:00:00 AM | unchanged |

## Upgrade note

If your app relies on `today` and its neighbours carrying the time of day, or on `days until` counting the part of today already gone, set the old reading back when you build the engine:

```ts
createEngine({ config: { date: { relativeDays: "now" } } });
```

Otherwise nothing needs doing. Check three places in your own code and tests:

- A line you display or compare that used `today` as "this instant" (a countdown, a timestamp, an elapsed time). Write `now` for it. `now`, a span shorter than a day (`2 hours ago`, `hours until 5pm`) and `now + 2 hours` are unchanged.
- A time added to `today`: `today + 2 hours` is 2:00 AM, the start of the day plus two hours, and no longer two hours from now.
- A count in days, weeks, months or years from today (`days until 25 december`) is a whole number of days. Two relative days subtract to a count of days, so `tomorrow - today` is `1 day` where it was `24:00`.

The default of a setting an app never set is the one thing that moves, which is why this is called out. The relative dates, date arithmetic, date differences, working days, cheatsheet and embedding pages are updated, and each example is checked against the engine by the documentation specs.

## Verification

The specs that pinned the old default were updated to the new answers, or pinned to `date.relativeDays: "now"` where the old reading is what they were about: `RelativeDaysMidnight`, `RelativeDays`, `Issue704_spokenRelativeDates`, `Issue721_engineFormatValue`, `Issue774_solveCli`, `Issue774_mcpServer`, `Issue823_datesBeforeYearOne`, `Issue827_workerEngineFormatting`, `DateTimeArithmetic`, `DatetimeWeekdayDuration`, `DatetimeParselets`, `DifferentialCalendar`, `WorkerHarness` and `CalendarBackendOption`. `RelativeDaysMidnight.spec.ts` gains a section on the default: midnight and the millisecond either side of it, a leap day, a year end, clocks going forward and back in London, New York and Sydney, a count of days across each change staying whole, a huge offset refused by name, and zones this runtime does not know.
