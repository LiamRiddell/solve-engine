---
"solve-engine": patch
---

An exact amount of money keeps at most 34 significant digits, the ceiling a plain decimal has

Money keeps the decimal it is, so a column of prices adds up to the cent, and nothing bounded that decimal across lines. Each line is a new evaluation, so a chain such as `x = x * 1.123456789`, line after line, added nine digits a line, and each multiplication cost more than the last: 4,000 lines from `$1` carried a 36,203-digit coefficient, where the same chain from `1` stops being exact after line 4 (#735). An exact amount is now held to 34 significant digits and 34 places, the precision of IEEE 754's decimal128 format and the ceiling plain decimals already had. Past it the amount is rounded to fit, half away from zero, rather than dropped to floating point as a plain number is, because rounding at the 34th digit moves it by less than one part in 10^33 and so leaves the half-cent rule exact for any amount a till could hold. An amount whose whole part alone is longer than 34 digits keeps only its floating-point value.

| document | before | now |
| --- | --- | --- |
| `x = $1`, then 2,000 lines of `x = x * 1.123456789`, `parseDocument` | 1,347 ms | 119 ms |
| the same with 4,000 lines | 7,966 ms | 142 ms |
| the same from `x = 1`, 4,000 lines, for comparison | 178 ms | 174 ms |
| `x = $100`, then 30 lines of `x = x * 1.05`: the last line | $432.19, 63 digits kept | $432.19, 34 digits kept |
| the last line of the 4,000-line chain from `$1` | `$16,807,070,918,084,257,711,…` (276 characters) | `$1.6807070918084162e+202` |
| `$0.00499999999999999999999999999999999` (35 places) | $0.00 | $0.01 |

Measured on a shared Linux container (4 cores, Node 22.22.2, load average about 4 from other work), with the engine's source bundled by esbuild, one run each, both builds in the same few minutes. The absolute figures run high on a busy machine; the shape is the point. The engine kept 311 MB after the 4,000-line chain from `$1` before, and 10.5 MB now, the same as the plain chain.

The last row is the boundary the money precision page now names: an amount written past 34 places is rounded at the 34th, where this one is exactly half a cent. Written to 34 places it is kept as it is and shows $0.00. Every amount a person types, and every ordinary chain, shows the same cents as before; the tests check a chain that crosses the ceiling on a half cent, a division chain, and the sum and difference of two amounts each just under it. Arithmetic across two currencies goes through a floating-point rate and is not affected.

## Verification

`Issue735_moneyDigitCeiling.spec.ts` holds 29 tests: `decimalWithinDigits` at its edges (the same object inside the ceiling, too many places, too many digits, a rounding that carries into a new digit, a whole part past the ceiling, zero at any scale, a smaller ceiling), `uomValueExact` holding and dropping the decimal, the issue's chain within 34 digits on every line, a scaling check against the plain chain, thirty years of 5% growth, a division chain, and the adversarial cases (a half cent past the ceiling, an amount typed to 35 places, two amounts just under the ceiling added and subtracted, a whole part at and past 34 digits, a chain shrinking by tenths, zero, negative zero and negatives, the numeric edges as a factor, a tax and a percentage through a chain, prototype words as the name the chain steps, look-alike text between the steps, 4,000 lines through both passes). The fast suite (`npm run test:ci`, run with the worktree path let through its ignore list) passed, 18,328 of 18,332 tests in 651 suites with 4 skipped. `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar` and `lint:changeset` passed, as did the proven docs examples; the dispatch loop was measured by hand the way `lint:dispatch-size` measures it, at 46,042 bytecode bytes, since that script's jest run skips a worktree. `npm run verify` was not run.
