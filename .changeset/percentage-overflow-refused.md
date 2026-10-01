---
"solve-engine": patch
---

A number too large for its percentage to be held is refused by name, so `1e308 as %` no longer shows `Infinity%`

A percentage is its number a hundred times over. 1e308 is an ordinary finite number, and the conversion refused only a value that was not finite, but a hundred times 1e308 is past the largest number a double holds (about 1.8e308), so the formatter's multiplication overflowed and the line printed `Infinity%`. Every form that writes a number as a percentage (`as %`, `in %`, `to %`, `as percent`, `is what % of`, and a parts-per quantity such as `1e308 permille as %`) now refuses a value whose percentage would overflow, above zero and below it, with the new `PERCENTAGE_OVERFLOW`, and so does a sum on a percentage that overflows (`50% + 1e308`). The closest existing refusal, `PERCENTAGE_NOT_FINITE`, says the value is what a division by zero gives, which is wrong for a real number, so it keeps that case and the overflow has a code of its own, as `FACTORIAL_OVERFLOW` and `PERMUTATION_OVERFLOW` do.

| line | before | now |
| --- | --- | --- |
| `1e308 as %` | `Infinity%` | This is too large to write as a percentage: a percentage is a hundred times the number, and that is past about 1.8e308, the largest number that can be held. |
| `-1e308 in %` | `-Infinity%` | the same refusal |
| `1e308 to %` | `Infinity%` | the same refusal |
| `1e308 as percent` | `Infinity%` | the same refusal |
| `1e307 is what % of 1` | `Infinity%` | the same refusal |
| `50% + 1e308` | `Infinity%` | the same refusal |
| `1/0 as %` | `PERCENTAGE_NOT_FINITE` | `PERCENTAGE_NOT_FINITE` |
| `0.5 as %` | `50.00%` | `50.00%` |

The boundary: a number that is itself past the largest double (`1e309`, or `2^2000`, which is computed in doubles) is not finite, and keeps `PERCENTAGE_NOT_FINITE`; a whole number written with `n` (`2n^2000`) is finite, and is refused as too large. Arithmetic other than adding to or taking from a percentage is unchanged. The percentages page explains the refusal under "A number as a percentage", and the big integers page points to it.

## Verification

`FoundBug_percentageOverflow.spec.ts` holds 27 tests: the lines that exposed it in each form and either sign, the largest fraction that fits and the first that does not, the forms that must not change, the boundary; unit tests of `toPercentage` (zero, negative zero, 2^53 ± 1, a 34-digit decimal, the largest and smallest doubles, the infinities, NaN, a permille quantity, a big integer, text, a boolean and a length), of `percentageTooLarge` and of `hasFiniteExactReading`; and the adversarial cases (prototype words with `Object.prototype` unchanged, a long sum, deep brackets, a huge power, text edges, digits from another script and a zero-width space, a value from the line above with a what-if through both document passes, a check, a typo, and every numeric edge through each form). `ErrorCodeReachability.spec.ts` reaches the new code with `1e308 as %`, and `AdversarialFeatureSweep.spec.ts` gains `(X) * 1e306 as %`, `-(X) * 1e306 in %` and `50% + (X) * 1e308`.

The fast suite ran across 780 suites (26,930 of 26,934 tests passed, 4 skipped, none failed), with `guide/error-codes.md` and `docs/public/llms-full.txt` regenerated. `npm run typecheck`, `typecheck:tests` (at its baseline of 92 errors in 29 files, none new), `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, `lint:links`, the proven docs examples and the hardening and integration suites passed. `npm run verify` as one command was not run.
