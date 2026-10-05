---
"solve-engine": patch
---

A variable named `salary` is read before `after tax`, rather than swallowed into the phrase

The payroll package fused `salary after tax` and `salary per month after tax` as whole phrases, so the word was claimed wherever it stood, and `salary = £50,000` then `salary after tax` left the form nothing to take home from. The phrases are now `after tax` and `per month after tax` alone, and `salaryWordNormalizerRule` drops `salary` as a flourish only after an amount (`£50,000 salary after tax`), so a `salary` that starts a value is the variable. This was found by an earlier adversarial batch.

| line | before | now |
| --- | --- | --- |
| `salary = £50,000`, then `salary after tax` | Expected a value, but found "salary after tax" | £39,519.60 |
| `salary = £50,000`, then `salary per month after tax` | Expected a value, but found "salary per month after tax" | £3,293.30 |
| `£50,000 salary after tax` | £39,519.60 | £39,519.60 |

The boundary: the word is dropped after a number, a closing bracket, a percentage or a word, and never after a typed operator, an `=` or a `:`, so `(salary) after tax` and `:net = salary after tax` read the variable. An unbracketed `check ... after tax > £30,000` still takes the whole comparison as the salary, as it does for a literal amount; bracket the form. The payroll page shows the variable form, proven.

## Verification

`FoundBug_salaryVariableAfterTax.spec.ts` (12 tests) holds the lines above, a capitalised, bracketed and multiplied name, an undefined `salary` named as undefined, unit tests of `salaryFlourishAt` and the rule (every token that ends a value, the inserted multiplication, positions past the end, prototype words), and the adversarial sides: prototype words as the variable, markup, five hundred repeated words, a check and a what-if through both passes, and a zero, negative and non-pound salary.

Gates run: `npm run typecheck`, `typecheck:tests` (at the baseline, which fell by two), `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, `lint:units` and `lint:links` passed; the docs, hardening and integration suites passed (9,242 tests in 98 suites); the fast suite ran 25,718 tests in 764 suites, all passing but 4 skipped once one merged spec that used `0/0` as a NaN was moved to `1/0 - 1/0`. `executeBytecode` stays under its size margin. `npm run verify` and the bundled-consumer contract were not run.

On top of main, the full suite ran 27,327 tests in 778 suites, all passing but 4 skipped once the guide manifest and one zone assertion followed main (both in this change), and `npm run test:temporal` passed its 3,477 tests.
