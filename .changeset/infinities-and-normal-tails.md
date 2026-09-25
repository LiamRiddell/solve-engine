---
"solve-engine": patch
---

An infinite angle and a remainder with no value are refused by name, and the normal distribution's far tails answer 0 and 1

**An infinite angle, a remainder by zero and a remainder of an infinity are refused (#600).** Each has no value, and JavaScript's maths answered NaN for all of them, which `number-functions.md` calls "not an answer". They are now refused by name, as the functions outside their domain have been since #510.

| expression | before | now |
| --- | --- | --- |
| `sin(1/0)` | NaN | error: sin(Infinity) has no real value: sin is only defined for finite angles. |
| `5 mod 0` | NaN | error: 5 mod 0 has no value: nothing is left over from a division by zero, because it never ends. |
| `(1/0) mod 3` | NaN | error: Infinity mod 3 has no value: an infinite number has no remainder. |
| `5 mod (1/0)` | 5 | 5 |
| `sin(1e300)` | a number | a number |

**The normal distribution's far tails answer 0 and 1 (#601).** The exponential the tails are built from split its argument with `Math.trunc(x * 4096)`, which overflows near the top of the double range, so `normalcdf(1e308)` came out NaN. Past 40 standard deviations the exponential has underflowed to zero anyway, so it now answers 0 there without the arithmetic.

| expression | before | now |
| --- | --- | --- |
| `normalcdf(1e308)` | NaN | 1 |
| `normalcdf(-1e308)` | NaN | 0 |
| `normalpdf(1e308)` | NaN | 0 |
| `normalcdf(-10)` | 7.62e-24 | 7.62e-24 |

The boundary: `0/0` stays NaN and `1/0` stays infinity, the floating-point standard's defined answers, and a form fed `0/0` passes its NaN on (`sin(0/0)` is NaN) rather than blaming the function. A whole-number remainder by zero (`10n mod 0n`) keeps its own named error.

Both were found by the new adversarial sweep. The number-functions and operators pages carry proven examples.

## Verification

New tests pin each refusal and its message, finite angles up to the largest double, every sign of a finite remainder, exact and unit remainders, an infinity reached through a variable and a line reference, and the normal distribution finite at every power of ten up to the largest double. The existing modulo tests that pinned NaN now pin the refusal. `npm run verify:ci` passes.
