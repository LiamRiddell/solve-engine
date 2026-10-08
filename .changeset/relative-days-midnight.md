---
"solve-engine": minor
---

A host can start relative days at midnight: with `date.relativeDays: "midnight"`, `today`, `tomorrow`, `next friday` and `3 days ago` are dates with no time of day, and `days until` counts whole days

Every relative day has been the current instant moved by whole days, so at noon `tomorrow` is noon tomorrow and `today + 3 weeks` carries the minute the line was typed. That is a fair reading of a clock and the wrong one for a note that plans by the day, where `tomorrow` is a date and a deadline has no time. The new setting lets a host choose. It takes two values: `"now"`, the default, which is the reading every version before it had, and `"midnight"`, which starts each relative day at the start of the day.

```ts
createEngine({ config: { date: { relativeDays: "midnight" } } });
```

At noon on Wednesday 11 March 2026 in London:

| line | `"now"` (the default, unchanged) | `"midnight"` |
| --- | --- | --- |
| `today` | Wednesday, March 11, 2026, 12:00:00 PM | Wednesday, March 11, 2026 |
| `tomorrow` | Thursday, March 12, 2026, 12:00:00 PM | Thursday, March 12, 2026 |
| `next friday` | Friday, March 13, 2026, 12:00:00 PM | Friday, March 13, 2026 |
| `3 days ago` | Sunday, March 8, 2026, 12:00:00 PM | Sunday, March 8, 2026 |
| `today + 3 weeks` | Wednesday, April 1, 2026, 12:00:00 PM | Wednesday, April 1, 2026 |
| `days until 25 december` | 288.50 days | 289 days |
| `tomorrow - today` | 24:00 | 1 day |
| `2 hours ago` | Wednesday, March 11, 2026, 10:00:00 AM | Wednesday, March 11, 2026, 10:00:00 AM |

The setting reaches `today`, `tomorrow`, `yesterday`, `next` and `last` with a weekday, `this friday` and a bare weekday in a sum, a span of a day or more before `ago`, and the count in `days until` and `days since` (in weeks, months or years too). Under `"midnight"` each is held as a calendar day, so two of them subtract to a count of days, as two written dates do. `today` compiles to a new opcode, `DATE_TODAY`, which pushes exactly what `DATE_NOW` does under the default; `now` still compiles to `DATE_NOW`. A value that is neither `"now"` nor `"midnight"` raises the new `DATE_RELATIVE_DAYS_INVALID` when the engine is built, since a setting quietly ignored is every relative date quietly showing a time.

The boundary, and why. `now` is the current instant under both settings, and so is a span shorter than a day (`2 hours ago`, `hours until 5pm`): those ask about the clock. A time added to the start of the day is a time on it, so `today + 2 hours` is 2:00 AM under `"midnight"`, and `now + 2 hours` is the spelling for two hours from now. The default stays `"now"` within the current major version, because changing it would change answers documented and relied on; the relative dates page sets out both readings.

One repair rides with it, under either setting. On a day whose midnight the zone skips (Santiago springs forward at 00:00, so 6 September 2026 begins at 01:00) a date showed as `Sunday, September 6, 2026, 1:00:00 AM`, and a whole day stepped from it carried the hour on: `6 september 2026 + 1 day` was 1:00 AM on the 7th. A calendar day at the start of its day now shows as a date, and a whole number of days, weeks, months or years from it lands on the start of the day reached. A fraction of a day (`+ 1.5 days`) still lands on the time it names.

| line, in Santiago | before | now |
| --- | --- | --- |
| `6 september 2026` | Sunday, September 6, 2026, 1:00:00 AM | Sunday, September 6, 2026 |
| `6 september 2026 + 1 day` | Monday, September 7, 2026, 1:00:00 AM | Monday, September 7, 2026 |

## Verification

`RelativeDaysMidnight.spec.ts` holds 68 tests on engines pinned to the docs moment and to the edges of a day: the first and last millisecond, a leap day, a month and a year end, London's and New York's changes of clock, a day in Santiago whose midnight is skipped, and a day that is already tomorrow in Tokyo. They cover every form under both settings with the default checked against the historic answers, both document passes agreeing value for value on a document that tags, checks, what-ifs and traces the forms, a snapshot round trip, a typo near a relative day, prototype words beside one, a refused setting (with `Object.prototype` unchanged) and a document of 2,000 relative days within budget. `calendar/RelativeDays.spec.ts` holds 73 unit tests of `resolveRelativeDays`, `relativeDayInstant`, `isDayOrLonger`, the `DATE_TODAY` opcode and the weekday finders, with ordinary, boundary and hostile arguments. The adversarial sweep gains the relative-day forms on a `"midnight"` engine over the numeric and text edges and the prototype words. Both specs pass under `SOLVE_CALENDAR=temporal` as well. The relative dates, date differences, cheatsheet, embedding and error codes pages are updated, and the table above is the one the spec asserts.

`npm run verify` passed (37,562 tests in 888 suites under `test:ci`, the build and the five smoke checks). `npm run test:full` ran 37,923 tests in 892 suites, all passing but 5 skipped, `npm run test:temporal` passed its 3,984 tests in 99 suites in each of its three zones, and the bundled-consumer contract passed (27 checks against an installed copy, including 2,417 documented examples). `lint`, `lint:comments`, `lint:messages`, `lint:docs`, `lint:cheatsheet`, `lint:error-codes`, `lint:links`, `lint:units`, `lint:keywords`, `lint:dispatch-size`, `lint:stats` and `typecheck:tests` passed. The package is 179,427 bytes minified and compressed with brotli, 338 more, measured on Node 22.22.0.
