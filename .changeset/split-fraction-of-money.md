---
"solve-engine": patch
---

`split 1/2 KWD between 3` splits half a dinar to the fils, rather than answering a rate per dinar

Three parts of the line went wrong in turn. After the word `split` the fraction was not read as the amount it is, so `1/2 KWD` became one over two dinars; the between-unit rule then read `KWD between` as the start of `days between`; and half a dinar, held as the fraction 1/2 rather than a decimal, was split as a double rather than to the currency's minor unit. The `split` word is now a place a value starts (`expectsValueAt`), so the fraction is bracketed as it is on a line of its own; a unit straight after a closing bracket is that amount's unit to the between-unit rule; and a fraction that ends in base ten is exact money (`terminatingDecimal`), as the literal `0.5` is. This was found by an earlier adversarial batch.

| line | before | now |
| --- | --- | --- |
| `split 1/2 KWD between 3` | 0.17 /KWD each | 0.166 KWD each, with 2 shares paying 0.167 KWD |
| `split 3/8 KWD between 2` | 0.19 /KWD each | 0.187 KWD each, with 1 share paying 0.188 KWD |
| `split 1/2 USD between 3` | 0.17 /USD each | $0.16 each, with 2 shares paying $0.17 |

The boundary: a fraction that recurs (a third) is its nearest decimal, as before, and so is one that ends past the 34 places an exact decimal holds. The splitting page no longer says `split 10 KWD between 3` needs brackets, since it already splits, and shows the fraction form, proven.

## Verification

`FoundBug_splitFractionOfMoney.spec.ts` (21 tests) holds the lines above, the bracketed and decimal spellings, `days between` unchanged, a count of zero refused by name, unit tests of `terminatingDecimal` (twos and fives, a recurring fraction, a denominator that is not positive, the 34-place ceiling, a denominator of 2^10000 answered quickly), `moneyExactMagnitude`, `expectsValueAt` and the between-unit rule, and the adversarial sides: prototype words as the currency and the count, a million shares within budget, markup, the amount from the line above through both passes, and every numeric edge as the numerator.

Gates run: `npm run typecheck`, `typecheck:tests` (at the baseline, which fell by two), `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, `lint:units` and `lint:links` passed; the docs, hardening and integration suites passed (9,242 tests in 98 suites); the fast suite ran 25,718 tests in 764 suites, all passing but 4 skipped once one merged spec that used `0/0` as a NaN was moved to `1/0 - 1/0`. `executeBytecode` stays under its size margin. `npm run verify` and the bundled-consumer contract were not run.

On top of main, the full suite ran 27,327 tests in 778 suites, all passing but 4 skipped once the guide manifest and one zone assertion followed main (both in this change), and `npm run test:temporal` passed its 3,477 tests.
