---
"solve-engine": patch
---

The year of an inflation question is a plain whole number, and an operator after it applies to the answer: `what is $100 from 1990 + $5` is the 1990 figure plus $5

The year after `from`, `in` or `worth in` was read to the end of the line, so `what is $100 from 1990 + $5` added the money to the year and answered `$217.31`, the figure for 1995, with nothing to say the year had moved (found bug, no issue). The year's number was then taken whatever the value was, so `from $1990` and `from 1990 kg` were the year 1990, and `from 1990.5` was looked up as 1990. The year is now read as one factor, the way the target of a conversion `in` is one term, so whatever follows it belongs to the line: `what is $100 from 1990 + $5` adds $5 to the answer, as `$100 in 1990 dollars + $5` and `5 km in m + 3 m` add to theirs. A year that is not a plain whole number (money, a quantity, a date, text or a fraction) is refused by name, with the new code `INFLATION_EXPECTED_YEAR`, in every inflation form, `inflationAdjust(...)` and `<amount> in <year> dollars` included.

| line | before | now |
| --- | --- | --- |
| `what is $100 from 1990 + $5` | `$217.31` (the year read as 1995) | `$258.39`, as `(what is $100 from 1990) + $5` |
| `what is $100 from 1990 + 5` | `$217.31` (the year read as 1995) | `$258.39`: the 5 is added to the answer |
| `what is $100 from (1990 + 5)` | `$217.31` | `$217.31` (unchanged) |
| `what was $100 worth in 1990 + $5` | `$46.02` (the year read as 1995) | `$44.46` |
| `what is $100 in 1990 worth in 2010 + $5` | `$181.34` (the second year read as 2015) | `$171.84` |
| `what is $100 from 1990.5` | `$253.39` (looked up as 1990) | `the year of an inflation question is a plain whole number, such as 1990, and 1990.5 is not a whole number` |
| `what is $100 from $1990` | `$253.39` | `... and this one is money` |
| `inflationAdjust($100, 1990.5, 2010)` | `$166.84` | refused with `INFLATION_EXPECTED_YEAR` |

The `from` figures are on a clock in 2026 and move each January.

The boundary: a whole number is a year even when no index covers it, so `from -1990` and `from 1e9` are still refused by the index (`INFLATION_YEAR_OUT_OF_RANGE`), which names the years it holds. A year held in a name (`year = 1990`, then `from year`) is read, and a sum as a year is written in brackets. Between two named years a sum written as the first year is refused with `INFLATION_EXPECTED_FROM_OR_IN`, pointing at the brackets, rather than read: the first year is followed by `worth in`, not by an operator. `value of $X in <year> assuming N% inflation` states a rate rather than reading an index and is not changed here.

## Verification

`FoundBug_inflationYear.spec.ts` holds 19 tests: the line through `evaluateLine`, `parseDocument` and `evaluateDocument`; the `what was`, two-year and `in <year> dollars` forms; each decision (`from 1990 + 5`, `from (1990 + 5)`, `from 1990.5`, `from -1990`, `from 1e9`, a year from the line above); unit tests of the new `inflationYear`, `parseInflationYear` and `worthInRefusal` and of the three handlers with ordinary, boundary and hostile arguments; and adversarial cases from the kit (prototype words as the year, sized and deep input, look-alike digits and markup, a check, a name changed to money, CRLF, and the numeric edges as each year). The adversarial sweep has the new templates, and the interest and inflation page has proven examples.

`Issue700_cpiTableFromBls.spec.ts` and `Issue756_ukAndEuroPriceIndices.spec.ts` pinned a fractional year (`1912.999`, `1799.999`) as out of range; it is now `INFLATION_EXPECTED_YEAR`, and the two specs say so.

Gates run: `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:changeset`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`; the docs, hardening, integration, errors, inflation and aggregate suites; and the fast suite. `npm run verify` and the bundled-consumer contract were not run.
