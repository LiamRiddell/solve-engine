---
"solve-engine": patch
---

The year of `value of $X in <year> assuming N% inflation` is a plain whole number, as in every other inflation form: `in 2030.5` and `in $2030` are refused with `INFLATION_EXPECTED_YEAR`

The flat-rate projection took its year's number whatever the value was (found bug, no issue). `in 2030.5` discounted over four and a half years, and `in $2030`, `in 2030 kg`, `in "2030"` and `in 2030-01-01` were each read as a year, every one answered with a confident figure. The other inflation forms already refuse such a year by name through `inflationYear`; this one was left out because it states a rate rather than reading an index. Its year now goes through the same guard, with the same code and words.

| line | before | now |
| --- | --- | --- |
| `value of $100 in 2030 assuming 3% inflation` | `$88.85` | `$88.85` (unchanged) |
| `value of $100 in 2030.5 assuming 3% inflation` | `$87.55` | `the year of an inflation question is a plain whole number, such as 1990, and 2030.5 is not a whole number` |
| `value of $100 in $2030 assuming 3% inflation` | `$88.85` | `... and this one is money` |
| `value of $100 in 2030 kg assuming 3% inflation` | `$88.85` | `... and this one is a mass` |
| `value of $100 in 2030-01-01 assuming 3% inflation` | `$0.00` | `... and this one is a date or time (write its year on its own, such as 1990)` |
| `value of $100 in 1e400 assuming 3% inflation` | `$0.00` | `... and this one is not a finite number` |

The figures are counted from 2026 and move each January.

The boundary: a whole number is a year, as in the other forms, and this form reads no index, so a year in the past (`in 1990`) still discounts backwards and a distant one (`in 2^53`) still answers `$0.00`. The year is read to `assuming`, so `in 2030 + 1` is 2031.

## Verification

`FoundBug_inflationFutureValueYear.spec.ts` holds 9 tests: the lines through `evaluateLine`, `parseDocument` and `evaluateDocument` on a clock stopped in 2026, a year held in a name included; the forms that stay as they were; unit tests of `inflationFutureValueHandler` with ordinary, boundary and hostile arguments (a rate of zero, a fraction, a non-finite number, no year, minus zero, money, a quantity, text, a date, a percentage, prototype words, a fault and a pending value passed through); and adversarial cases from the kit (prototype words as the year, a long sum, deep brackets, a huge power, look-alike digits, invisible characters and markup, a year from the line above changed to money, a check, typos, the numeric edges as the year, CRLF). The adversarial sweep has the new templates, and the interest and inflation page has proven examples.

Gates run: `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:changeset`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`; the docs, hardening, integration, bugs, time, map-reduce, aggregate and inflation suites; and the fast suite. `npm run verify` and the bundled-consumer contract were not run.

On top of main, the full suite ran 35,461 tests in 864 suites, all passing but 5 skipped, and `npm run test:temporal` passed its 3,777 tests.
