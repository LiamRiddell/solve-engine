---
"solve-engine": minor
---

The spoken relative dates: `3 days ago`, `next week`, `end of month`, `noon`, `this friday` and `2nd Tuesday of March` with no year

After `next friday`, `3 days before today` and `2nd Tuesday of March 2027`, these are the next most common ways people write a date or a time, and each was refused (#704). Each now reads as the shipped form it means.

| line | before | now (at noon on 11 March 2026, London) |
| --- | --- | --- |
| `3 days ago` | `Unexpected token after expression: "ago"` | Sunday, March 8, 2026, 12:00:00 PM |
| `next week` | `"next" must be followed by a day of the week` | Monday, March 16, 2026 |
| `next year` | `"next" must be followed by a day of the week` | Friday, January 1, 2027 |
| `end of month` | `Undefined variable: end` | Tuesday, March 31, 2026 |
| `start of year` | `Undefined variable: start` | Thursday, January 1, 2026 |
| `noon` | `Undefined variable: noon` | 12:00:00 PM |
| `this friday` | `Unexpected token after expression: "friday"` | Friday, March 13, 2026, 12:00:00 PM |
| `friday + 1 week` | `No prefix parselet found for token: FRIDAY` | Friday, March 20, 2026, 12:00:00 PM |
| `first Monday of next month` | `Unexpected token after expression: "Monday"` | Monday, April 6, 2026 |
| `2nd Tuesday of March` | `Undefined variable: March` | Tuesday, March 10, 2026 |
| `9am until 5pm` | `Unexpected token after expression: "until"` | 480 minutes |

- **Days ago.** A length of time and `ago` is that length before now, as `3 days before today` is, so it keeps the time of day.
- **Weeks, months and years.** `next week`, `this week`, `last week` and the same for `year` join `next month`, each the first day of its period; a week runs Monday to Sunday. `start of`, `beginning of` and `end of` take a period (`month`, `next week`, `last year`) and give its first or last day, as a calendar day.
- **Days of the week.** `this friday` is the coming Friday, today when today is one, where `next friday` steps over today. A weekday name inside an expression (`friday + 1 week`, `days until friday`) reads the same way.
- **Clock times.** `noon` and `midnight` are 12:00 and 0:00, the clock times `12pm` and `12am` are, and `until` joins `to` between two clock times.
- **The nth weekday.** The ordinal can be a word from `first` to `fifth`, and a month with no year is this year's, the year `9 March` takes.
- **Dates past the calendar.** A date moved so far that no calendar holds it (`99999999999 days ago`, past AD 275760) is refused with `DATE_OUT_OF_RANGE` rather than shown as `Invalid Date` (or, formatted with a zoned calendar, thrown as `Invalid time value`).

The words these forms use stay free elsewhere. `start`, `end`, `this` and `ago` are claimed only as the whole phrase, so `start = 5`, `end - start` and `3 days ago I paid` are unchanged. A weekday name alone on a line is refused with a message suggesting `this friday`, so a note can head a day with it; `Friday: 3 hours` is unaffected. `noon` and `midnight` are read as times wherever they are not being assigned, so a variable with either name is read with its colon, `:noon`, the convention for any name the engine also reads as a word.

The boundary: `today` is still an instant, so `3 days ago` carries the time of day, and a month with no year is this year's even when it has passed. `in 3 days`, `a week ago`, `the day after tomorrow`, `Monday next week`, `tomorrow at noon`, `next weekend` and `end of quarter` are not read, and relative-dates.md lists the spelling that works for each. The week starts on Monday; a configurable first day of the week is #702. A date before AD 1 is still shown without its era, which is #823.

## Verification

`Issue704_spokenRelativeDates.spec.ts` holds 90 tests, run on the `Date` and the Temporal backends: each form at the docs moment and against the shipped form it means, a month end, a leap February, a year end, a Sunday and a Friday, the daylight-saving changes in London and New York, the words kept free in prose and as names, dates past the calendar's range, and words naming inherited properties.

The full suite (`npm run test:full`) passed, 16,937 of 16,941 tests in 627 suites with 4 skipped, and `npm run verify:ci` passed end to end, including the three-zone temporal run (3,220 tests in 94 suites each) and the bundled-consumer contract (25 checks against an installed copy, including 1,584 documented examples).
