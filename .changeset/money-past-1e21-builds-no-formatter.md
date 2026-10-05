---
"solve-engine": patch
---

Money and other quantities past 1e21 are written without building a new number formatter for each answer, so a long money chain shows as quickly as it did before its amounts were written in full digits.

Writing such an amount in full digits, rather than in JavaScript's exponent form (`$1.23e+34`), sent every answer through two `Intl` formatters built on the spot: one for the digits and one for their thousands separators, through `BigInt.prototype.toLocaleString`. A chain of multiplications that grows past 1e21 meets both on every line. The digits are now built from the number's own shortest text, which `Intl` writes the same way, and the separators come from one formatter cached per locale (`groupedIntegerFormatFor`), as plain numbers already did (#764).

| document | before | now |
| --- | --- | --- |
| 4,000 lines of `x = x * 1.123456789` from `$1`, formatting the answers | about 200 ms | about 55 ms |
| the same from `$1`, against the same from `1` | about 3.1 times | about 1.7 times |

Every answer reads exactly as before: the spec checks the new digits against `Intl` for every power of ten up to the largest double, in both signs and at several place counts, and the cached grouping against `toLocaleString` in eight locales. The timings are local medians on a shared machine.

The boundary: only the text is affected. A number below 1e21 was already written by `toFixed`, and still is.

## Verification

`packages/engine/__tests__/hardening/LargeDoubleDigitsReadNoFormatter.spec.ts` (14 tests), `Issue735_moneyDigitCeiling.spec.ts`, and the fast suite.

On top of main, the full suite ran 30,590 tests in 816 suites, all passing but 4 skipped, and `npm run test:temporal` passed its 3,527 tests.
