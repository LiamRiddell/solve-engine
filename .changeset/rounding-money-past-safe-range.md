---
"solve-engine": patch
---

`floor`, `ceil`, `round`, `trunc` and `int` round an amount of money from the decimal it keeps, so `floor($9007199254740993.5)` is $9,007,199,254,740,993.00

The rounding functions read a plain number's exact value before its double (`roundExactToWhole`), but a quantity's double only. Past 2^53 a double holds no fraction, and the double nearest $9,007,199,254,740,993.50 is $9,007,199,254,740,994, so `floor` answered a dollar above the amount. An amount of money keeps its exact decimal at any size, and the rounding now reads it, by the same rules a plain number's decimal is rounded by (`floor` down, `ceil` up, `trunc` and `int` toward zero, `round` a half away from zero), and keeps the currency. `as int` cuts the amount from its decimal too, and still answers a plain number. A plain number's path is unchanged and still allocates nothing.

| line | before | now |
| --- | --- | --- |
| `floor($9007199254740993.5)` | `$9,007,199,254,740,994.00` | `$9,007,199,254,740,993.00` |
| `trunc(-$9007199254740993.5)` | `-$9,007,199,254,740,994.00` | `-$9,007,199,254,740,993.00` |
| `$9007199254740993.5 as int` | `9,007,199,254,740,994` | `9,007,199,254,740,993` |
| `ceil($9007199254740993.5)` | `$9,007,199,254,740,994.00` | `$9,007,199,254,740,994.00` |
| `floor($2.50)` | `$2.00` | `$2.00` |

The boundary, and why it is drawn here: `floor((2^60 + 0.5) m)` is unchanged, because a length carries no exact value for a rounding to keep. The unit is attached to the double, so `(2^60 + 1) m` is already 1,152,921,504,606,846,976.00 m before any function sees it, and keeping a length exact is a change to how a unit is attached, not to rounding. The big integers page names money as the exception among quantities.

## Verification

`FoundBug_roundingMoneyPastSafeRange.spec.ts` holds 21 tests: each rounding of an amount past 2^53 in either sign and `as int`, the forms that must not change, and the length boundary; unit tests of `roundExactQuantityToWhole` (each mode either side of zero, a whole amount, trailing zeros, a negative zero, past 2^53, and a length, a plain number and text, which are null), of `roundExactToWhole` turning a plain double away, of `truncateToWhole` and of `wholeOfQuotientBig`; and the adversarial cases (prototype words with `Object.prototype` unchanged, a long sum, deep brackets, a huge power, text edges and look-alike digits, an amount from the line above with a what-if, a check and arithmetic through both document passes, and every numeric edge as money through each rounding). `AdversarialFeatureSweep.spec.ts` gains `floor($9007199254740993.5 + (X))` and `round(-(X) * $1)`.

The fast suite ran across 792 suites (27,759 of 27,763 tests passed, 4 skipped, none failed), and `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, the proven docs examples and the hardening and integration suites passed. `npm run verify` as one command and the benchmarks were not run.
