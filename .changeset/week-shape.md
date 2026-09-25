---
"solve-engine": minor
---

The weekend and the first day of the week are configurable, and read from the locale's region: under `ar-SA`, one working day after Thursday 1 January 2026 is Sunday 4 January

Working-day arithmetic always skipped Saturday and Sunday. Where the weekend is Friday and Saturday no configuration could say so: the only hook was a holiday predicate, and a predicate can only remove days, so Sunday never became a working day (#702).

| engine | line | before | now |
| --- | --- | --- | --- |
| `date: { weekend: ["friday", "saturday"] }` | `1 working day after 2026-01-01` | setting ignored: Friday, January 2, 2026 | Sunday, January 4, 2026 |
| `locale: "ar-SA"` | `1 working day after 2026-01-01` | Friday, January 2, 2026 | Sunday, January 4, 2026 |
| `locale: "ar-SA"` | `2026-01-02 is a weekend` | false | true |
| `date: { firstDayOfWeek: "sunday" }` | `start of week`, on Wednesday 11 March 2026 | not a form yet (#704) | Sunday, March 8, 2026 |
| default | `1 working day after 2026-01-01` | Friday, January 2, 2026 | Friday, January 2, 2026 |

- **Two settings.** `config.date.weekend` names the weekend days and `config.date.firstDayOfWeek` the day a week starts on, both by name. An empty weekend makes every day a working day. A name that is not a day is refused when the engine is built, with `DATE_WEEKDAY_INVALID`, rather than quietly ignored.
- **From the locale.** Left unset, each comes from the engine's locale tag when the tag names a region and the runtime reports that region's week through `Intl.Locale` (`getWeekInfo()`, or the `weekInfo` getter on Node 22): `ar-SA` and `he-IL` keep Friday and Saturday with a Sunday start, `fa-IR` Friday alone with a Saturday start, `en-US` a Sunday start. A bare language such as the default `en` names no region, so the default engine keeps Saturday and Sunday and a Monday start. A runtime that reports no week leaves the default in place. Each setting stands on its own, so a host can name the weekend and let the locale choose the first day.
- **One reading.** The working-day walk, the working-day count, `is a weekend` and `is a workday` read the one weekend, where the predicates held a second hard-coded copy; the week forms (`this week`, `start of week`) begin on the first day. A weekend of all seven days has no working day to land on, and a working-day offset is refused at once rather than after walking the whole hundred-year limit to find that out.

The boundary: the ISO week number (`week number of`) stays Monday-based, as ISO defines it. `workdays in <span>` and the `workday` unit in a rate stay a fixed five working days to seven, since neither has a date to read a week from. The engine's `locale` still chooses the language pack by its language alone; only the week reads its region.

## Verification

`Issue702_weekShape.spec.ts` holds 45 tests: the default unchanged, a configured weekend on each day of a week, a weekend with a holiday predicate, an empty weekend and one of seven days, a configured first day, five inferred locales, an explicit setting over the locale, invalid names refused, and runtimes with no week information, an older getter, a throwing constructor and out-of-range days.

The full suite (`npm run test:full`) passed, 16,937 of 16,941 tests in 627 suites with 4 skipped, and `npm run verify:ci` passed end to end, including the three-zone temporal run (3,220 tests in 94 suites each) and the bundled-consumer contract (25 checks against an installed copy, including 1,584 documented examples).
