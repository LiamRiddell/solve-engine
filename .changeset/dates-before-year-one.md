---
"solve-engine": patch
---

A date before year 1 is written with its era, the zone-bound calendar reads those years correctly, and a year from 0 to 99 is the year it says: `11 March 2026 - 3000 years` is `Saturday, March 11, 975 BC`, and `1 Jan 0001` is a real day

Three faults met at the start of the calendar (#823). No backend wrote an era, so 975 BC was shown as `975`, which reads as AD 975, and the ISO form wrote `-974-03-11`, which is not ISO 8601. The zone-bound `Date` backend (`dateCalendarInZone`) read `Intl`'s year of the era as a signed year, so 975 BC came back as AD 975 and the arithmetic built on it landed in 2924. And every backend built a date through `Date`'s reading of a year from 0 to 99 as the 1900s, so `1 Jan 0001` became 1 January 1901, failed the check that the day read back as written, and was refused with a reason that did not explain it: "January 1 has 31 days". The shared Gregorian helpers and each backend's `localMidnight` now read the year as written, the zone-bound backend reads the era, and a spelled-out date before year 1 asks `Intl` for its era. The zone-bound backend also resolves a wall clock to the second, so London before 1847, whose local mean time was 1 minute 15 seconds behind UTC, no longer puts midnight fifteen seconds into the day before.

| line | before | now |
| --- | --- | --- |
| `11 March 2026 - 3000 years` | Saturday, March 11, 975 | Saturday, March 11, 975 BC |
| `11 March 2026 - 3000 years`, ISO | -974-03-11 | -000974-03-11 |
| `11 March 2026 - 3000 years`, day first | 11/03/-974 | 11/03/975 BC |
| `11 March 2026 - 3000 years`, zoned in London | Friday, March 9, 2924, 11:59:45 PM | Saturday, March 11, 975 BC |
| `1 Jan 0001` | "1 Jan 0001" is not a real date: January 1 has 31 days. | Monday, January 1, 1 |
| `1 Jan 0001 - 1 day` | "1 Jan 0001" is not a real date: January 1 has 31 days. | Sunday, December 31, 1 BC |
| `3 April 0026` | "3 April 0026" is not a real date: April 26 has 30 days. | Friday, April 3, 26 |
| `11 March 2026 - 1051 years`, ISO | 975-03-11 | 0975-03-11 |
| `1 Jan 1800`, zoned in London | "1 Jan 1800" is not a real date: January 1800 has 31 days. | Wednesday, January 1, 1800 |

A date in the common era is written exactly as before, with no `AD`: the era is asked for only when the date falls before year 1, and a modern date pays one comparison for the check. The ISO form counts years astronomically, as the standard does (1 BC is `0000`), and writes a year outside 0 to 9999 with a sign and six digits, the form `Date` and `Temporal` both write. The `CalendarBackend` contract now says `localMidnight` and `localWallClock` take the year as written; no caller relied on the 1900s window, since every year the engine passes is read off a date or written out in full, and a two-digit year a reader types is still windowed by the date reader before it reaches a backend. A zone-bound backend asked about an instant past the range a date can hold now answers `NaN` and `Invalid Date`, as its contract says, rather than letting `Intl`'s `RangeError` through.

The boundary: dates are Gregorian all the way back (the proleptic calendar `Date` and `Temporal` use), not Julian before 1582. A date before year 1 can be worked out and shown but not typed: `975 BC` and the expanded ISO spelling `-000974-03-11` are not read as date literals. A date past the whole range still shows `Invalid Date` on this release; refusing it by name is separate work. The displaying-dates page explains eras and the astronomical count before it shows them, and the Temporal guide says the two-digit window is gone on both backends.

## Verification

`Issue823_datesBeforeYearOne.spec.ts` holds 54 tests: the era in the long, ISO, day-first and month-first forms on the `Date` backend, the zone-bound backend in London and New York and the `Temporal` backend; a common-era date unchanged; the era in `de-DE` and `en-GB`; the zone-bound backend agreeing with `Temporal` instant for instant; year 1 and the first century on every backend; the refusal for a day year 1 does not have; London before standard time; the parts (`utcMs`, `dayNumber`, `isoWeekNumber`, `daysInMonth`, `localDate`, `zonedFields`, `mayPrecedeYearOne`, `longDateOptions`, `longDateInZone`, `dateInZone`, `namedZoneWallClockToUtcMs`, `isoYear`, `slashYear`, `describeUnrealDay`, the `Temporal` backend's day and month steps in the first century, and the zone-bound backend past the range); and the adversarial cases (prototype words where the year goes, look-alike digits and markup, a step back past the range, a first-century date from the line above through both document passes, the era either side of year 1, year 0's leap day, and the 99 to 100 roll). The adversarial feature sweep gained four date templates (a step either side of year 1, a step back by years, and a month step across the 99 to 100 roll) run over the numeric edges. Two calendar specs had their descriptions of the old window updated, and the displaying-dates page now carries proven examples, so it left the docs spec's `unprovable` map.

The date and time suites ran under the `Temporal` backend in Europe/London, America/New_York and Pacific/Auckland (`npm run test:temporal`, 3,224 tests in 94 suites each), with this change's spec and the sweep run the same way in each zone; the fast suite (`npm run test:ci`, 16,842 of 16,846 tests in 625 suites, 4 skipped), the proven docs examples, `npm run typecheck`, `lint`, `lint:comments`, `lint:docs` and `lint:cheatsheet` passed.
