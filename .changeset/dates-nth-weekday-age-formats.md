---
"solve-engine": minor
---

Add calendar-aware date forms and configurable date formats (issues #182, #183).

The datetime package gained the two calendar forms it was missing, and dates
became configurable at both ends: the order an ambiguous numeric literal is read
in, and the form a date is displayed in.

## The nth weekday of a month

The date of the nth, or last, occurrence of a weekday in a month, computed from
a fixed month or a relative one.

| expression | result |
| --- | --- |
| `2nd Tuesday of March 2026` | `Tuesday, March 10, 2026` |
| `4th Thursday of November 2026` | `Thursday, November 26, 2026` |
| `last Friday of November 2026` | `Friday, November 27, 2026` |
| `1st Monday of next month` | the first Monday of next month |

The result is an ordinary date, so it composes (`2nd Tuesday of March 2026 as
weekday` is `Tuesday`). An occurrence the month does not have is refused rather
than wrapped: April 2026 has four Fridays, so `5th Friday of April 2026` is an
error, not the first Friday of May. The bare `next Friday` and `last Monday`
forms are untouched: only an ordinal weekday followed by `of` reads this way.

`next month`, `this month` and `last month` come with it, each the first of its
month, the same anchor `March 2026` gives.

## Age

Whole calendar years from a birth date, reckoned at now unless an `on <date>`
gives another reference, or the full years/months/days breakdown.

| expression | result |
| --- | --- |
| `age of 15/06/1990 on 25/12/2030` | `40 years` |
| `age of 15/06/1990 on 26/08/2026 in years, months and days` | `36 years, 2 months, 11 days` |

Age walks the calendar rather than dividing a fixed-length span, so the leap
cases are right: a 29 February birth is a year older on 1 March in a non-leap
year, where `years between` (which divides by a 365-day year) drifts. The two
sit side by side: `years between` for a rough span, `age of` for the count a
birthday gives.

## Choosing the input order

A numeric date was read by its separator: a slash date day first, a hyphen date
month first unless it opened with a four-digit year. A US reader's `12/25/2023`
therefore did not parse at all, because day 25 of month 12 is not a date. The
new `date.inputOrder` setting fixes the order for every numeric separator.

| `inputOrder` | `12/25/2023` | `25/12/2023` | `2023/12/25` |
| --- | --- | --- | --- |
| `"auto"` (default, as before) | not a date | 25 December 2023 | not a date |
| `"MDY"` | 25 December 2023 | not a date | not a date |
| `"DMY"` | not a date | 25 December 2023 | not a date |
| `"YMD"` | not a date | not a date | 25 December 2023 |

```ts
new ExpressionEngine({ config: { date: { inputOrder: "MDY" } } });
```

Only the all-numeric literals are affected: a spelled-out month (`March 9,
2024`) is never ambiguous, and a full ISO timestamp is always read as ISO.

## Choosing the output format

A date showed spelled out and nothing else. The new `dateResult.format`
formatting setting picks the form.

| `format` | `25/12/2023` shows as |
| --- | --- |
| `"long"` (default, as before) | `Monday, December 25, 2023` |
| `"iso"` | `2023-12-25` |
| `"dmy"` | `25/12/2023` |
| `"mdy"` | `12/25/2023` |

```ts
formatValue(value, { ...settings, dateResult: { format: "iso" } });
```

The long form still localises its weekday and month names through the configured
locale; the numeric forms are locale-neutral. The field is optional, so a host
that built a `FormattingSettings` before it existed keeps the long form.

## Boundaries

- **`inputOrder` is per engine, read live by the literal rule.** It is
  registered against the engine's own config, so a slimmer engine built without
  the datetime package neither reads nor fuses a date literal.
- **`dateResult` flows per render.** It reaches the formatter with the other
  formatting settings, so no engine rebuild is needed to change it.
- **The nth-weekday month anchor is a month, not a day.** Only the anchor's year
  and month are read, so `2nd Tuesday of 15/03/2026` and `2nd Tuesday of March
  2026` agree.

## Verification

`npm run verify` (typecheck, 7,783 tests across 345 suites, build, the package
smoke script and the bundled-consumer tree-shaking contract) passes, along with
`npm run lint`, the comment-style and doc-coverage checks, and the docs example
suite. The calendar arithmetic is proven on its own in `DateArithmetic.spec.ts`,
and the grammar and both settings through the engine in `NthWeekdayAndAge.spec.ts`
and `DateFormatConfig.spec.ts`.
