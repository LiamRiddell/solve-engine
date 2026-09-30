---
"solve-engine": patch
---

`0/0` is refused by name as the quotient with no single answer, rather than answered with NaN

A number divided by something ever closer to zero grows without limit, so `5/0` answers infinity, the floating-point standard's answer, and that is unchanged. Zero over zero has no such limit: every number times zero is zero, so every number is an equally good quotient, and JavaScript's NaN reached the reader with nothing to say why. An infinity over an infinity is the same case from the other end. Both are now refused with `QUOTIENT_UNDEFINED`, as `0 mod 0` already was, by `indeterminateQuotient`, which the division asks only when a quotient of two numbers comes out NaN, and before any other division. This was found by an earlier adversarial batch.

| line | before | now |
| --- | --- | --- |
| `0/0` | NaN | 0 divided by 0 has no single answer: every number times 0 is 0, so no one quotient is right. |
| `0 m / 0 s` | NaN m/s | the same refusal |
| `(1/0)/(1/0)` | NaN | ∞ divided by ∞ has no single answer: two infinities have no size to compare, so no one quotient is right. |
| `5/0` | ∞ | ∞ |

The boundary is the division itself. A NaN that is not a quotient (`1/0 - 1/0`) keeps its NaN, and a list divided cell by cell (`[0, 1] / 0`) keeps a NaN cell, since one cell of a list has no room for a refusal. The operators page explains the difference between `5/0` and `0/0`, with both proven.

## Verification

`FoundBug_zeroOverZero.spec.ts` (21 tests) holds the lines above with either zero signed, as a quantity, a percentage and money, unit tests of `indeterminateQuotient` (finite, x over zero, zero over an infinity, NaN operands, text and prototype words), and the adversarial sides: prototype words over zero, a thousand `0/0` terms within budget, markup, a zero from the line above and a total through both passes, and every numeric edge over zero, under it, and over itself. `QUOTIENT_UNDEFINED` is catalogued with a line in `ErrorCodeReachability.spec.ts`. The specs that used `0/0` as a way to make a NaN (the worker and JSON DTOs, conditionals, bases, converters, the calendar, percentages, big integers) now use `1/0 - 1/0`, and the four that pinned `0/0` as NaN pin the refusal.

Gates run: `npm run typecheck`, `typecheck:tests` (at the baseline, which fell by two), `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, `lint:units` and `lint:links` passed; the docs, hardening and integration suites passed (9,242 tests in 98 suites); the fast suite ran 25,718 tests in 764 suites, all passing but 4 skipped once one merged spec that used `0/0` as a NaN was moved to `1/0 - 1/0`. `executeBytecode` stays under its size margin. `npm run verify` and the bundled-consumer contract were not run.
