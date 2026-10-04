---
"solve-engine": minor
---

`monthly payment on` is read as `monthly repayment on`, as are the daily, annual and total forms, and a compounding tail with no interval says so in the word that was written

A repayment is most often called a payment, and `monthly payment on $200,000 over 25 years at 4%` failed with a parser message (#746). `compounded monthly` beside `compounding monthly`, the issue's other request, had already landed with #801; what was left of it was the message for a tail with no interval, which showed `compounding ?:` whichever word was written.

| line | before | now |
| --- | --- | --- |
| `monthly payment on $200,000 over 25 years at 4%` | throws `Expected an operator or the end of the line, but found "payment"` | `$1,055.67` |
| `total payment on 200000 over 25 years at 4%` | throws `Expected an operator or the end of the line, but found "payment"` | `316,702.10` |
| `$1,000 after 3 years at 7% compounded` | `compounding ?: expected one of annually, ...` | `compounded needs an interval after it: expected one of annually, ...` |
| `$1,000 after 3 years at 7% compounded bananas` | `compounding bananas: expected one of ...` | `compounded bananas: expected one of ...` |

Only the three words together are claimed (`daily payment on`, `monthly payment on`, `annual payment on`, `total payment on`), so a variable named `payment` still works on its own and on the same line as the phrase: `payment = monthly payment on principal over 25 years at 4%` then `payment * 12` is `12,668.08`.

The boundary: `payment on` without a period is not read, and neither are the spreadsheet functions `pmt`, `fv` and `npv`. A spreadsheet's `PMT` takes the rate per period, the number of periods and the principal, in that order, and a call spelled the same way that read its arguments in another order would give a wrong answer without saying so; the interest page now says this, with the comma caveat inside a call. A repayment still takes no `compounding` tail, since it is worked out month by month.

## Verification

`Issue746_paymentOnAndCompounded.spec.ts` holds 21 tests: each period of `payment on` against `repayment on`, money, the rate first and any case, a variable principal and a variable named `payment`, the compounding tail after `after`, `for` and `compound interest on`, the refusals for an unknown interval, no interval and a repeated tail, unit tests of `readCompoundingInterval` with a stand-in parser (each word, no tail, prototype words), and adversarial numeric edges and prototype words through the forms. The full suite ran 25,631 tests in 734 suites (25,626 passed, 4 skipped); its one failure, `llms-full.txt` not yet regenerated for the new examples, is fixed and passes on a rerun. `npm run typecheck`, `typecheck:tests` (at its baseline of 94 errors in 30 files, none new), `lint`, `lint:comments`, `lint:messages`, `lint:error-codes` (534 codes), `lint:docs`, `lint:links`, `lint:cheatsheet`, `lint:sidebar`, `lint:keywords`, `lint:units`, `lint:dispatch-size` and `test:temporal` in three zones passed.
