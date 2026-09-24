---
"solve-engine": minor
---

Exact decimals for plain numbers

A number written with a decimal point now keeps the exact decimal it was written as through arithmetic, the way money always has, so a comparison agrees with the answer on screen. Before, a plain decimal was a binary floating-point number (the IEEE 754 double), which cannot hold a tenth exactly: `0.1 + 0.2` was 0.30000000000000004, shown as 0.30, and then compared unequal to 0.3 on the next line.

| expression | before | now |
| --- | --- | --- |
| `0.1 + 0.2 == 0.3` | false | true |
| `1.1 * 1.1 == 1.21` | false | true |
| `0.1 + 0.2 - 0.3` | 5.55e-17 | 0 |
| `0.3 / 0.1` | 3.00 | 3 |
| `floor((0.7 + 0.1) * 10)` | 7 | 8 |
| `100 + 10%` | 110.00 | 110 |
| `(0.5 + 0.505) to 2 dp` | 1.00 | 1.01 |
| `(0.1 + 0.2) to 17 dp` | 0.30000000000000004 | 0.30000000000000000 |
| `0.1 + 0.2` | 0.30 | 0.30 |

Adding, taking away, multiplying, a remainder, a whole power and a percentage are exact. A division is exact where its decimal ends (`1 / 0.8` is 1.25) and is kept as the exact fraction where it does not, the way `1/3` already was, so `0.1 / 3 * 3 == 0.1` is true and a fraction meets a decimal as fractions (`1/3 + 0.1` is exactly 13/30). The comparisons and a conditional's test read the exact values, and so does rounding: `to N dp`, `round`, `floor` and `ceil` round the decimal itself, so a value exactly half way rounds away from zero, as money's half-cent does. The totals and averages of a list, of the lines above, of a range, of a category tag and of a table column are exact too. A figure that records where it came from, such as a converted amount read as a number, is exact on the same terms as one typed in, and it keeps its record, as an exact total of such figures keeps all of theirs: nine euros read as a number, times 0.15, is exactly 1.35 and still names the rate it was converted at.

What is shown for an ordinary answer does not change. The lines that change are the ones where floating point had left a visible trace: a result that is a whole number no longer shows `.00`, a true half now rounds away from zero (`1.9 + 15%` is exactly 2.185, so 2.19 where it was 2.18), `as scientific` loses the trailing digits of the approximation, and a decimal quotient `as fraction` is the exact fraction rather than a close one (`1234.0765 / 1234.01` is 2468153/2468020, not 37115/37113).

The boundary, and why. An irrational answer (a square root, a logarithm, a trigonometric function, `pi`) has no exact decimal or fraction to keep, so it stays in floating point. Scientific notation is still read as floating point: it is how a magnitude is written, and it is what keeps a typed `1e16` from being given digits it never had, so `1e-1 + 2e-1 == 3e-1` is still false. An exact answer carries at most 34 digits, and 34 places, the precision of IEEE 754's decimal128 format; a longer one, such as `1.05 ^ 30` at 61 digits, is the floating-point answer it always was. A unit other than money, a measurement with an uncertainty, a statistic such as a median and a matrix entry stay in floating point, and so do the areas, reciprocals and rates that units now form when they multiply and divide. A price per unit such as `$0.15/kWh` is one of those rates until it is multiplied out, so the bill it gives is worked out in floating point and a half cent can land on either side: `12.3 kWh * $0.15/kWh` shows $1.84, where `$0.15 * 12.3` is exactly $1.845 and shows $1.85. A negative zero keeps the sign floating point gives it, so `1 / (0.0 * -1)` is still -Infinity. The plain whole-number arithmetic is unchanged: two whole numbers never take the decimal path, and each exact path is a call behind a property test rather than code in the VM's dispatch loop, which keeps that loop under the size V8 will optimise.

## Verification

A new suite pins every operation above against its exact value and its nearest double, the rounding family, the percentage paths, the totals through both document passes, the fraction bridge, negative zero, a figure carrying its sources and the exact totals of such figures, and each boundary, including the 34-digit limit, a huge power refused before it is built, and the unit products and prices per unit that stay in floating point. The cross-path suite gains the decimal column, range, tag and table totals through `parseDocument` and `evaluateDocument`. The hardening suites that pinned the floating-point answers now pin the exact ones, with each reversal recorded, and still pin floating point through scientific notation.

An A/B against a build of the previous main ran 31,687 cases: every documented example, line by line and as whole documents through both document passes, every string the test suite evaluates, 6,000 generated decimal lines, and 360 generated documents with totals, tags and table columns. 984 answers differ, all of them the intended changes above: 755 carry the nearest double to the exact answer with the display unchanged, 141 comparisons are decided on the exact values, 28 whole results drop `.00`, 28 roundings take the exact half or the exact digits (`to N dp`, a percentage, a total), 10 `as scientific` and 2 `as fraction` readings lose the approximation, 5 remainders and 2 sums are exactly zero, 5 `floor`, `ceil` and `trunc` read the typed digits, 4 whole powers and 1 product past the safe range show their exact digits, and 3 conditionals take the other branch. Every documented example that differs is on a page this change updates. No answer changed type, and none became or stopped being an error.

The VM's dispatch loop, compiled the way Jest compiles it, is 47,052 bytes of bytecode against the previous 46,598, with 14,388 to spare below the 61,440 V8 will optimise. The benchmark comparison against the previous main, five alternating runs of the vm, pipeline and document-parse suites with Maglev and five with `--no-maglev` (what the benchmark job's Node 22 sees of an oversized loop), passes the regression gate on every pair: the suite geometric means of the per-case medians are 0.96, 0.99 and 0.99 with Maglev, and 0.99, 1.01 and 1.01 without it. The decimals page is rewritten, and the fractions, money precision and exact coefficients pages updated, with proven examples. `npm run verify:ci` passes: TESTS tests across SUITES suites, with the bundled-consumer contract.
