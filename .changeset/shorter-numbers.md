---
"solve-engine": minor
---

Two opt-in formatting fields write answers shorter: `floatResult.trimTrailingZeros` shows `1.5` rather than `1.50`, and `floatResult.compactFrom` shows `1500000` as `1.5M`

A host could set places, grouping, the number locale, hex padding and the date form, but not the two shorter styles notepad readers ask for: decimals without the zeros that only pad them out to the place count, and large numbers in the compact form `as compact` writes on a single line (#750). Both fields are off by default, so no existing answer changes.

| line | default | `trimTrailingZeros: true, compactFrom: 1000000` |
| --- | --- | --- |
| `1.5` | 1.50 | 1.5 |
| `2.5 km` | 2.50 km | 2.5 km |
| `0.1 + 0.2` | 0.30 | 0.3 |
| `12.5%` | 12.50% | 12.5% |
| `1500000` | 1,500,000 | 1.5M |
| `1234567` | 1,234,567 | 1.23M |
| `$3,300,000` | $3,300,000.00 | $3.3M |
| `999999` | 999,999 | 999,999 |
| `$1.50` | $1.50 | $1.50 |
| `3.14159 to 4 dp` | 3.1416 | 3.1416 |
| `2^64` | 18,446,744,073,709,551,616 | 18,446,744,073,709,551,616 |

Trimming applies to a plain number, a list's entries, a quantity and a percentage. The compact form is the one `as compact` writes, with the suffixes `k`, `M`, `B` and `T` the engine reads back, in the locale's decimal mark (`1,5M` under `de-DE`), and applies to a plain number and a quantity, money included. The formatting guide gains a section on both.

The boundary: money keeps its currency's places (`$1.50` never becomes `$1.5`), because the cents of a price are how it is written rather than padding. A line that names its precision keeps every place it asked for and its full form, and a measurement with a tolerance keeps its full form, since the digits of the spread are the point of it. The compact form stops where the suffixes do: a number of a thousand trillion or more keeps its ordinary form, so an exact `2^64` is not rounded to `1.84e+19` on a line that asked for no rounding, and a threshold below 1,000 acts as 1,000. Compact is a display rounding to three significant figures, as `as compact` is: `1.5M` reads back as the same value but `1.23M` reads back as 1,230,000, and a de-DE engine does not read `1,5M` at all, so a host that writes answers back into a note leaves it off.

## Verification

`Issue750_shorterNumbers.spec.ts` holds 28 tests: the issue's table with both fields, each field alone, both off by default, the boundary (money, an explicit precision, a tolerance, an exact integer past 2^53, a figure past the trillions, read-back), unit tests of `autoFormatIntegerOrFloat` with and without trimming and of `compactText` with ordinary, boundary and hostile thresholds (zero, negative, NaN, infinity, a string) and in German and Arabic-Indic digits, and the adversarial cases (settings keyed by prototype words, a huge figure, a value from the line above, the worker DTO, German and French separators, and every numeric edge). Gates run: `npm run typecheck`, `npm run typecheck:tests` (no new errors), `npm run lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet` and `lint:sidebar` all clean; `lint:units` passed against a fresh build; and the full suite (`npm run test:full`) passed, 22,772 of 22,776 tests in 697 suites with 4 skipped. `npm run verify:ci` and the bundled-consumer contract were not run whole for this change; CI runs both.
