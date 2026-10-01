---
"solve-engine": patch
---

An inflation question reads a sum as its amount: `what is $300 + $50 from 2003` adjusts $350

The amount of `what is $X from <year>` is read at a binding power above the conversion `in`, so that the `in` of `what is $X in <year> worth in <year>` stays the question's. A sum binds looser than that, so the amount stopped at the first `+` or `-`, and the line was refused at the sign the reader typed, quoting it as the token found (found bug, no issue). Only the bracketed `($300 + $50)` answered. The amount is now its terms joined by `+` and `-`, each read at the same guarded binding power, so the `in` is still the question's and the sum is read. Reading the sign makes no form ambiguous: the year always follows `from`, `in` or `worth in`, so a sign before that word can only belong to the amount.

| line | before | now |
| --- | --- | --- |
| `what is $300 + $50 in 1990 worth in 2010` | `Expected "from <year>" or "in <year> worth in <year>" after "what is <amount>", but found "+"` | `$583.93`, as `what is ($300 + $50) in 1990 worth in 2010` |
| `what is $300 + $50 from 2003` | the same refusal | the bracketed form's answer |
| `what is $300 - $50 from 2003` | the same refusal, `found "-"` | the answer for $250 |
| `what was $300 + $50 worth in 1965` | the same refusal | the bracketed form's answer |
| `what is $100 * 2 from 1990` | `$506.78` | `$506.78` (unchanged) |

The boundary: only `+` and `-` between the amount's terms are joined; a word that is not a sign, as in `what is $300 and $50 from 2003`, is still refused with `INFLATION_EXPECTED_FROM_OR_IN`. A sign after the year belongs to the year's expression, as before, so `what is $100 from 1990 + $5` reads the year as 1995; that reading is unchanged here and noted separately. A counted word followed by a sign (`what is 100 apples + 5 from 1990`) is reported as an undefined name, not with the counted-word refusal, which reads only a count directly before the keyword.

## Verification

`FoundBug_inflationAmountSum.spec.ts` holds 11 tests: the line through `evaluateLine`, `parseDocument` and `evaluateDocument`, both named-year forms and `what was`, minus, several terms, a product inside a term, a percentage, pounds, unit tests of the new `parseInflationAmount` on a bare parser (ordinary, boundary and hostile input), and adversarial cases from the kit (prototype words, sized input, look-alike and markup text, a value from the line above, a check, a half-typed sign, an unindexed currency, the numeric edges, CRLF). The interest and inflation page has proven examples.

Gates run: `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:changeset`, `lint:docs`; the docs, hardening, integration and finance suites.

`FoundBug_inflationAmountInWords.spec.ts` pinned `what is $300 + $50 from 2003` as refused at the `+`; it now expects the bracketed form's answer. The fast suite ran 31,651 tests in 827 suites: 31,645 passed, 5 were skipped, and the one failure was that pinned line, passing since. `npm run verify` and the bundled-consumer contract were not run.
