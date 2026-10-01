---
"solve-engine": patch
---

An amount of money written in scientific notation rounds to its currency's places as the same amount written with a point does: `$1e-3` is `$0.00`, as `$0.001` is, and `$1.005e0` is `$1.01`

A number literal written with a point (`0.001`) keeps its exact base-ten value beside its floating-point one, and money reads that exact value to round to the cent, half away from zero. A literal in scientific notation (`1e-3`, 1 times 10 to the power -3) was read as the nearest floating-point number alone, so as an amount of money it was shown as a converted amount is, with its small digits (`$0.001`), and a half cent rounded the way the floating-point number sitting just below it does (`$1.005e0` was `$1.00`; found while checking how a tiny value is shown). Where a literal in scientific notation is the amount of money, written straight after a currency symbol (a sign may sit between) or straight before a currency written after it, it is now read exactly, from its digits and its exponent with no floating-point step in between, and pushed as the point form is.

| line | before | now |
| --- | --- | --- |
| `$1e-3` | `$0.001` | `$0.00` |
| `$0.001` | `$0.00` | `$0.00` |
| `$1e-320` | `$1e-320` | `$0.00` |
| `$1.005e0` | `$1.00` | `$1.01` |
| `$2.675e0` | `$2.67` | `$2.68` |
| `1e-3 USD` | `$0.001` | `$0.00` |
| `1e-3 dollars` | `$0.001` | `$0.00` |
| `1e-3 €` | `€0.001` | `€0.00` |
| `$-1e-3` | `-$0.001` | `$0.00` |
| `$1e3` | `$1,000.00` | `$1,000.00` |
| `$1e400` | `$∞` | `$∞` |
| `1e-3` | `0.001` | `0.001` |

The boundary: only the amount of money is read this way. Scientific notation on its own stays a floating-point number, as it always has (`1e16 + 1 - 1e16` is still 0, and `1e30 in hex` is still the floating-point number's digits), because that is what the notation names in every other context. An exponent past 400 either way is not built exactly, since the floating-point number is already infinite or zero there and an exact form of `1e99999999` would be a hundred-million-digit integer; `$1e400` is `$∞`, as the same amount written out in full is, and `$1e-400` is `$0.00`. A conversion of a plain number into a currency (`1e-3 in USD`) is a conversion, as `0.001 in USD` is, and keeps its digits.

## Verification

`FoundBug_moneyInExponentForm.spec.ts` holds 89 tests: each amount the report named beside its point form, the half-cent cases, a currency after the amount, a sign, the other symbols and the currencies with other places, arithmetic on the amount, a plain number unchanged, and the lines through `evaluateLine`, `parseDocument` and `evaluateDocument`; unit tests of `decimalFromExponentLiteral` (ordinary forms, the limit either way, a leading-zero exponent, zero, a 35-digit mantissa, malformed text, look-alike digits, a ten-thousand-digit exponent in time, the prototype words), of `exponentLiteralValue` (an infinite or underflowed result keeps no exact value, the smallest double, text a hostile snapshot could carry), of `isMoneyAmount` (every symbol, a sign between, a unit that is not money, a name, the prototype words) and of the two parse tiers' choice of opcode; and the adversarial cases (prototype words around the amount with `Object.prototype` unchanged, a huge exponent, two thousand amounts, two hundred brackets and five hundred lines in time, look-alike digits, a zero-width character and a Cyrillic letter in the exponent, text edges, markup, typos in the exponent, the amount from the line above under a check and a what-if, a conversion, the German locale, a snapshot round trip, zero, negative zero, the smallest double, the 34-digit limit, every numeric edge as an amount, CRLF). Batch W's `test.failing` for `$1e-3` in `FoundBug_tinyValueShownAsZero.spec.ts` now passes and is an ordinary test. `AdversarialFeatureSweep.spec.ts` gains `$(X) * 1e-3` and `(X) * 1e-3 USD`.

Gates run for this batch, in the worktree: `npm run typecheck`, `npm run typecheck:tests` (no new errors), `npm run lint`, `lint:comments`, `lint:messages`, `lint:changeset`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet` and `lint:sidebar`; this spec and `FoundBug_unitConstantInAHeldExpression.spec.ts`, batch W's and batch S's found-bug specs (every `FoundBug_` spec), the constants, symbolic, format, decimal, units, errors, hardening, integration and docs suites (the proven examples, the guide snippets and the llms files), `FailingTestShape.spec.ts`, and the fast suite (833 suites, 32,958 passed and 5 skipped). `NormaliserRulesRejectCheaply.spec.ts`, which batch W saw fail once on the clock-time rule, passed in every run here: alone, three times in a shuffled order, eight times at once in shuffled orders, twice last in one process after the hardening, normaliser and time suites, and in the fast suite.
