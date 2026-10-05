---
"solve-engine": patch
---

A working day added to a date read in a zone is counted on that zone's calendar: `2024-11-01 23:30 in New York + 1 workday` is Monday, November 4, 2024, 11:30:00 PM on every host

Days, weeks and months on a zoned date already stepped the zone's calendar, but working days still walked the host's. Half past eleven on a Friday night in New York is already Saturday in UTC, so a host there counted from Saturday and landed on a Sunday, which is no working day at all; only a host in New York said Monday. The spoken form, `3 working days after <date>`, also dropped the zone, so its answer was shown on the host's clock.

| line, on a host in UTC | before | now |
| --- | --- | --- |
| `2024-11-01 23:30 in New York + 1 workday` | Sunday, November 3, 2024, 10:30:00 PM | Monday, November 4, 2024, 11:30:00 PM |
| `2024-11-02 12:00 in New York + 3 workdays` | Wednesday, November 6, 2024, 11:00:00 AM | Wednesday, November 6, 2024, 12:00:00 PM |
| `3 working days after 2024-11-02 12:00 in New York` | Wednesday, November 6, 2024, 4:00:00 PM | Wednesday, November 6, 2024, 12:00:00 PM |
| `1 working day after 2026-01-01` | Friday, January 2, 2026 | Friday, January 2, 2026 |

The walk is handed the date the zone's calendar shows, and the zone's wall-clock time is put back on the date it lands on, the way the day and month steps keep it, so a change of clocks in between moves neither the day nor the time. The weekend, the host's holidays and the offset limits are the walk's own and are read on that date: a holiday on 4 November moves the first line to the Tuesday. `working days between` reads each zoned end as the day its own zone shows, and the spoken form keeps the date's zone and grain, as `+ 3 workdays` does.

The boundary: a date with no zone is counted on the engine's calendar as before, so every unzoned answer is unchanged. The fix closes the case the zoned day steps' spec held as a known failure.

## Verification

`FoundBug_zonedWorkdays.spec.ts` holds 22 tests, run on engines whose calendar sits in UTC, London, New York, Kiritimati and Kolkata with one answer required of all five, on both calendar backends: the reported lines, the spoken form, a change of clocks either way, `working days between` across two zones, a holiday and a Friday-and-Saturday weekend read on the zone's calendar, the offset limit and a seven-day weekend still refused, unit tests of `walkDatesInZone` and `zonedDateAsLocalMidnight` (a walk that gives up, an unreadable clock, an unknown zone, fixed offsets, an error that is not a range error), prototype words as a zone with `Object.prototype` unchanged, every numeric edge as the count, a document through both passes, and the first and last days a date holds. The date arithmetic and working days pages gain proven examples.
