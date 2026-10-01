---
"solve-engine": patch
---

A small figure in a list or a tolerance keeps its digits: `[1e-6, 1]` is `[1e-6, 1]` and `0.004 ± 0.001` is `0.004 ± 0.001`, where both showed zeros

A result too small for the two decimal places the engine shows is written to three significant digits, as a decimal while the zeros are countable and in exponent form after, so a value that is not zero never reads as one: `1e-6` is `1e-6` and `1 Hz in MHz` is `1e-6 MHz`. A cell of a list of plain numbers and both sides of a tolerance were rounded to the places without that rule, so `[1e-6, 1]` was `[0.00, 1]` and `0.004 kg ± 0.001 kg` was `0 ± 0.0`, a measurement and its error both shown as nothing (found while checking how a tiny quantity is shown). Each now follows it, and a zero centre is written without a sign, as a zero result is.

| line | before | now |
| --- | --- | --- |
| `[1e-6, 1]` | `[0.00, 1]` | `[1e-6, 1]` |
| `[1, 2; 3e-7, 4]` | `[1, 2; 0.00, 4]` | `[1, 2; 3e-7, 4]` |
| `0.004 ± 0.001` | `0 ± 0.0` | `0.004 ± 0.001` |
| `1e-6 ± 1e-7` | `0 ± 0.0` | `1e-6 ± 1e-7` |
| `-0.004 kg ± 0.001 kg` | `-0 ± 0.0` | `-0.004 ± 0.001` |
| `0 ± 0.001` | `0 ± 0.0` | `0 ± 0.001` |
| `[1e-6 km, 1 km]` | `[1e-6 km, 1.00 km]` | `[1e-6 km, 1.00 km]` |
| `12.3 ± 0.5` | `12.3 ± 0.5` | `12.3 ± 0.5` |

The boundary: `1e-320 km / 1e10`, which led here, still shows `0.00 km`, and that is right. A number is held as a double, which reaches down to about 4.94e-324, so that quotient is zero before it is shown, exactly as `1e-320 / 1e10` is 0 and as a result past about 1.8e308 is `∞`; every quantity that is not zero, down to the smallest double, already shows its digits, and the spec pins that across the range. Money is unchanged: it rounds to its currency's minor unit, so `$0.001` is `$0.00`. Found and not fixed here: an amount typed in exponent form (`$1e-3`) carries no exact decimal, since a literal with an `e` stays a double, and so is shown as a conversion's amount is, `$0.001`, where `$0.001` typed with a point is `$0.00`; it is pinned as a failing test. The tolerance still drops its unit, as the uncertainty page documents.

## Verification

`FoundBug_tinyValueShownAsZero.spec.ts` holds 94 tests: small cells of a list and of a matrix, small tolerances either sign, what already read unchanged, the reported quotient and its plain twin as the zero a double gives, money to its minor unit, and the lines through `evaluateLine`, `parseDocument` and `evaluateDocument`; unit tests of the list cell and the tolerance display, called with built values (a small, a whole and a placed cell, the budget's edge, zero, negative zero, the smallest double either sign, an infinity, the largest double, zero either side of a tolerance, a negative spread, a zero-place budget); a sweep of twelve magnitudes from the smallest subnormal up, each signed both ways, that no quantity, cell or tolerance that is not zero reads as zero; and the adversarial cases (prototype words in a list and a tolerance with `Object.prototype` unchanged, five thousand small cells and five hundred tolerance lines in time, digits from another script and a zero-width character, text edges, the value from the line above under a check and a what-if, a list mixing units, every numeric edge beside a small cell and with a small spread, CRLF). `FoundBug_infiniteDateOffset.spec.ts` pins `∞ days from today` and its relatives as failing tests naming #832, which refuses them. `AdversarialFeatureSweep.spec.ts` gains `[X, 1e-6]` and `(X) +/- 1e-6`.

Gates run for this batch, in the worktree: `npm run typecheck`, `npm run typecheck:tests` (no new errors), `npm run lint`, `lint:comments`, `lint:messages`, `lint:changeset`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet` and `lint:sidebar`, the four specs above, batch S's and batch O's found-bug specs, the symbolic, format, hardening, integration, errors and docs suites (the proven examples, the guide snippets and the llms files), `FailingTestShape.spec.ts`, and the fast suite (834 suites, 31,981 passed and 6 skipped; one run of `NormaliserRulesRejectCheaply.spec.ts` failed once on the clock-time rule under load and passed on its own twice, a rule this batch does not touch).
