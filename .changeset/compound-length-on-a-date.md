---
"solve-engine": patch
---

A length written in several units is added to a date a part at a time, largest first, so `2026-01-31 + 1 month 1 day` is March 1, as `2026-01-31 + 1 month + 1 day` is, rather than March 3

A length such as `1 month 1 day` was summed into its smallest unit before it reached the date, and the unit table's month is 30 days, so the date moved 31 days instead of a month and then a day. On a date a month is a step of the month field, clamped to the month's last day (31 January plus a month is 28 February), which is what `2026-01-31 + 1 month` alone has always done. A length led by a day or longer, on the right of a `+` or `-`, is now applied one part at a time, the largest first, the way an ISO 8601 duration such as `P1M1D` already was; `after`, `from` and `before` apply the parts in the same order. The same cause made `1 day 2 hours` across a change of clocks twenty-six elapsed hours rather than a calendar day and two hours. Found while checking month-end arithmetic; no issue was filed.

| line | before | now |
| --- | --- | --- |
| `2026-01-31 + 1 month 1 day` | Tuesday, March 3, 2026 | Sunday, March 1, 2026 |
| `2024-01-31 + 1 month 1 day` | Saturday, March 2, 2024 | Friday, March 1, 2024 |
| `2026-03-31 - 1 month 1 day` | Saturday, February 28, 2026 | Friday, February 27, 2026 |
| `2024-02-29 - 1 year 1 day` | Tuesday, February 28, 2023 | Monday, February 27, 2023 |
| `2026-01-31 + 1 year 1 month 1 day` | Wednesday, March 3, 2027 | Monday, March 1, 2027 |
| `1 month 1 day after 2026-01-31` | Tuesday, March 3, 2026 | Sunday, March 1, 2026 |
| `1 month 1 day before 2026-03-31` | Saturday, February 28, 2026 | Friday, February 27, 2026 |
| `2024-03-30 12:00 + 1 day 2 hours` (London) | Sunday, March 31, 2024, 3:00:00 PM | Sunday, March 31, 2024, 2:00:00 PM |
| `2024-02-29 + 1 year 1 day` | Saturday, March 1, 2025 | Saturday, March 1, 2025 |
| `1 month 1 day` | 31 days | 31 days |

The same reading also closes a crash in the date offset's connector lookup: `5 days constructor 3` and `5 days __proto__ 3` threw a raw `TypeError` (`startType.startsWith is not a function`), because the lookup of `from`, `after` and `before` found the inherited `Object` function for a word that names a property every object has. It now reads its own entries only, and those lines are an ordinary parse error.

The boundary: only a length led by a day or longer is applied in parts, since a length in hours and minutes is fixed and sums to the same answer. The parts are written largest first, and `1 day 1 month` is refused rather than reordered, because the two orders give different dates and the reader's order cannot be guessed. A length in brackets, scaled, converted or kept in a variable (`2026-01-31 + (1 month 1 day)`, `span = 1 month 1 day`) is one quantity by then, and is summed as before. The date arithmetic page sets out the order with proven examples.

## Verification

`FoundBug_compoundLengthOnADate.spec.ts` holds 43 tests: the reported lines and their leap-year, negative, year and offset variants; the compound form against the chained form on every month end of 2024 and 2026, added, taken away and after; a length on its own and between two lengths; the three entry points agreeing; a day and two hours across London's spring change and New York's autumn change on four host zones, through both document passes; unit tests of `readCompoundQuantity`, `isCalendarLength`, `spreadOperatorBefore`, `connectorAt`, the compound-quantity rule and the compound date offset rule (ordinary, boundary and hostile arguments); the boundary (brackets, a variable, a scale, a conversion, the parts written smallest first); and the adversarial cases (prototype words naming the date and standing as the connector, with `Object.prototype` unchanged, text edges, two thousand compound steps on one line, a thousand-line document, a check, a what-if, a zone, a typo, every numeric edge as an added count and as a factor, 2^53 counts, CRLF). A date pushed past the calendar's range by such a length still shows `Invalid Date`, as a one-unit length does; that is pinned as a `test.failing` naming #832, which refuses it. `AdversarialFeatureSweep.spec.ts` gains six templates and the prototype-word and text-edge cases for the form, and the spec joins the `test:temporal` suites.

The fast suite ran across 810 suites (30,206 of 30,210 tests passed, 4 skipped, none failed). The date and time suites ran under the `Temporal` backend in Europe/London, America/New_York and Pacific/Auckland (3,513 tests in 95 suites each, this spec included). `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:changeset`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar` and the proven docs examples passed, and `llms-full.txt` was regenerated for the new section. `npm run verify` as one command, the bundled-consumer contract and the benchmarks were not run.
