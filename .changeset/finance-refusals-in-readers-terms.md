---
"solve-engine": patch
---

The finance refusals say the rate as the reader wrote it, rather than opening with an internal function's name

`compound interest on 1000 over 3 years at -150%` answered "compoundInterest: rate -1.5 makes (1 + rate) non-positive": the name of the function behind the phrase, the rate as a decimal fraction, and a formula the reader never wrote. `presentValue:`, `taxIn:`, `taxRemove:`, `compounding:`, `compoundInterestRate:`, `compoundInterestYears:`, `inflationAdjust:` and `fact:` did the same. Each is now said in the reader's terms, as `loanTermsRefused` did for a loan, through two shared helpers, `rateAtOrBelowMinusHundred` and `compoundingRefused`, with the rate written as a percentage by `ratePercent`. The earlier batch that reworded the loan refusals left these for a change of their own.

| line | before | now |
| --- | --- | --- |
| `compound interest on 1000 over 3 years at -150%` | compoundInterest: rate -1.5 makes (1 + rate) non-positive | A rate of -150% cannot be used: it must be more than -100%, since at -100% or less the amount falls to nothing or below. |
| `tax in 120 at -200%` | taxIn: rate -2 makes (1 + rate) non-positive | A tax rate of -200% cannot be used: ... |
| `interest on 1000 over 3 years at -2400% compounded monthly` | compounding: rate -24 over 12 periods per year is not usable | A rate of -2400% added 12 times a year is -200% each time, which cannot be used: each must be more than -100%. |
| `compoundInterestYears(1000, 1157.63, 0)` | compoundInterestYears: rate 0 is not usable (must be > -1 and not 0) | At a rate of 0% the amount never grows, so no number of years reaches it. |
| `inflationAdjust($100, 1700, 2020)` | inflationAdjust: fromYear 1700 or toYear 2020 is outside ... | Year 1700 is outside the bundled CPI table's range (1970-2026) |
| `fact(-1)` | fact: -1 is not a non-negative integer | A factorial is only defined for a whole number of zero or more, and -1 is not one. |
| `171!` | fact: 171! exceeds the maximum representable double ... | 171! is too large to hold as a number: 170! is the largest factorial that fits. |

The codes are unchanged, so a host that reads them sees no difference. The message lint gains a rule, `internal-name-prefix`: a line's result may not open with a camelCase name and a colon, so a new one is caught. A word the reader types before a colon (`npv:`, `irr:`) is not camelCase and is not caught, and an error a host receives may still name the host's own function.

## Verification

`FoundBug_financeRefusalsInReadersTerms.spec.ts` (28 tests) holds the lines above and that none of these refusals opens with a function's name, unit tests of `ratePercent` (a floating-point tail, zero, negative zero, the infinities, NaN, the largest double), `rateAtOrBelowMinusHundred` and `compoundingRefused`, the lint rule on real and near-miss messages, and the adversarial sides: prototype words as the amount and the rate, deep brackets, the rate from the line above through both passes, and every numeric edge as the rate and as the periods a year. `npm run lint:messages` passes over the engine's source.

Gates run: `npm run typecheck`, `typecheck:tests` (at the baseline, which fell by two), `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, `lint:units` and `lint:links` passed; the docs, hardening and integration suites passed (9,242 tests in 98 suites); the fast suite ran 25,718 tests in 764 suites, all passing but 4 skipped once one merged spec that used `0/0` as a NaN was moved to `1/0 - 1/0`. `executeBytecode` stays under its size margin. `npm run verify` and the bundled-consumer contract were not run.
