---
"solve-engine": patch
---

A large percentage, quantity or amount of money is written in full digits, as a plain number is, so `1e306 as %` no longer shows `1e+308%`

A plain `1e22` has always shown every digit of its whole part, but the percentage, quantity and money formatters wrote their figures with JavaScript's `toFixed`, which writes a number of 1e21 or more the way `String` does, in exponent form. So `1e306 as %` showed `1e+308%`, `1e308 ppm as %` showed `1.0000000000000001e+304%`, `1e22 m` showed `1e+22 m`, and a check's message wrote its sides as `1e+22 m`. Each now writes such a number through the same `Intl` path a plain number takes, grouped and localised as it is, and a check's message writes its sides in full. The ordinary path is unchanged: below 1e21 it is still `toFixed`, behind one comparison.

| line | before | now |
| --- | --- | --- |
| `1e22 as %` | `1e+24%` | `1,000,000,000,000,000,000,000,000.00%` |
| `1e22 m` | `1e+22 m` | `10,000,000,000,000,000,000,000.00 m` |
| `1e22 days` | `1e+22 days` | `10,000,000,000,000,000,000,000 days` |
| `$1e40 + $1` | `$1e+40` | `$10,000,000,000,000,000,000,000,000,000,000,000,000,000.00` |
| `check 1e22 m == 2e22 m within 1%` | `check failed: 1e+22 m differs from 2e+22 m by 50%, more than 1%` | `check failed: 10000000000000000000000 m differs from 20000000000000000000000 m by 50%, more than 1%` |
| `1e22` | `10,000,000,000,000,000,000,000` | `10,000,000,000,000,000,000,000` |

The boundary: past about 2^53 the digits are the floating-point number's, as a plain number's are, so about the first sixteen are the value's and the zeros after them fill the places; the money precision page now says so for an amount past a decillion, where it said the amount was shown in scientific notation. A value too small to show in its places keeps the engine's own exponent form (`1 Hz in MHz` is `1e-6 MHz`), and `as compact` keeps its exponent past its largest suffix, since both are forms the engine chose rather than a fallback.

## Verification

`FoundBug_exponentTextInAResult.spec.ts` holds 17 tests: the lines that exposed it as a percentage, a quantity, a day count, money and a check's message; the forms that must not change; unit tests of `fixedDecimalText` (ordinary places, just below and at 1e21 either sign, the largest and smallest doubles, zero and negative zero, a hundred places, the infinities and NaN) and `shortestText`; `formatValue` under English and German; and the adversarial cases (prototype words with `Object.prototype` unchanged, a long sum, deep brackets, a huge power, text edges, look-alike digits and markup, a value from the line above with a conversion and a what-if through both document passes, and every numeric edge as a percentage, a length and money). `Issue735_moneyDigitCeiling.spec.ts` and `FoundBug_arithmeticOnBigBase.spec.ts` pinned the exponent text and now pin the full digits. `AdversarialFeatureSweep.spec.ts` gains `(X) * 1e22 as %` and `(X) * 1e22 m`.

The fast suite ran across 792 suites (27,759 of 27,763 tests passed, 4 skipped, none failed). `npm run typecheck`, `typecheck:tests` (at its baseline of 92 errors in 29 files, none new), `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, the proven docs examples and the hardening and integration suites passed, with `docs/public/llms-full.txt` regenerated. `npm run verify` as one command and the benchmarks were not run.

On top of main, the full suite ran 30,590 tests in 816 suites, all passing but 4 skipped, and `npm run test:temporal` passed its 3,527 tests.
