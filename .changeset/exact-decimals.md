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
| `12.3 kWh * $0.15/kWh` | $1.84 | $1.85 |
| `12.3 kg at $0.15/kg` | $1.84 | $1.85 |
| `$0.15 per kg * 12.3 kg` | $1.84 | $1.85 |
| `$0.15 * 12.3 kWh` | $1.84 | $1.85 |
| `$1.005/kg` | 1.00 USD/kg | 1.01 USD/kg |

Adding, taking away, multiplying, a remainder, a whole power and a percentage are exact. A division is exact where its decimal ends (`1 / 0.8` is 1.25) and is kept as the exact fraction where it does not, the way `1/3` already was, so `0.1 / 3 * 3 == 0.1` is true and a fraction meets a decimal as fractions (`1/3 + 0.1` is exactly 13/30). The comparisons and a conditional's test read the exact values, and so does rounding: `to N dp`, `round`, `floor` and `ceil` round the decimal itself, so a value exactly half way rounds away from zero, as money's half-cent does. The totals and averages of a list, of the lines above, of a range, of a category tag and of a table column are exact too. A figure that records where it came from, such as a converted amount read as a number, is exact on the same terms as one typed in, and it keeps its record, as an exact total of such figures keeps all of theirs: nine euros read as a number, times 0.15, is exactly 1.35 and still names the rate it was converted at.

A price per unit is money, and it keeps the decimal it was typed as, so the bill it gives is the plain product in every spelling. At 15 cents a kilowatt-hour, 12.3 kilowatt-hours cost exactly $1.845. `$0.15 * 12.3` always showed $1.85, but a price per unit was worked in floating point, where the product lands a hair under the half cent, so `12.3 kWh * $0.15/kWh`, `12.3 kg at $0.15/kg`, `$0.15 per kg * 12.3 kg` and `$0.15 * 12.3 kWh` showed $1.84. Each now comes to the plain product's $1.85. A price per unit on its own line rounds a half cent the way money does (`$1.005/kg` is 1.01 USD/kg, as `$1.005` is $1.01), and a price below a cent still shows its significant digits (`$0.001/kWh` is 0.001 USD/kWh), since a tenth of a cent a unit is a real price. The quantity is not money, so it is still held in floating point, and its decimal is read back from that number: a quantity typed as a decimal, or converted onto a short one (`12300 Wh` is 12.3 kWh), counts exactly, while a quantity that is floating point's rounding of a fraction, such as a third of a kilowatt-hour, is worked out in floating point as it was, so `(1/3) kWh * $30/kWh == $10` stays true. A price worked out by dividing (`$1.20 / 0.4 kg`) and a price per unit times another rate (`$0.15/kWh * 12.3 kWh/day`, whose answer is a rate, not an amount of money) are floating point too.

What is shown for an ordinary answer does not change. The lines that change are the ones where floating point had left a visible trace: a result that is a whole number no longer shows `.00`, a true half now rounds away from zero (`1.9 + 15%` is exactly 2.185, so 2.19 where it was 2.18), `as scientific` loses the trailing digits of the approximation, and a decimal quotient `as fraction` is the exact fraction rather than a close one (`1234.0765 / 1234.01` is 2468153/2468020, not 37115/37113).

The boundary, and why. An irrational answer (a square root, a logarithm, a trigonometric function, `pi`) has no exact decimal or fraction to keep, so it stays in floating point. Scientific notation is still read as floating point: it is how a magnitude is written, and it is what keeps a typed `1e16` from being given digits it never had, so `1e-1 + 2e-1 == 3e-1` is still false. An exact answer carries at most 34 digits, and 34 places, the precision of IEEE 754's decimal128 format; a longer one, such as `1.05 ^ 30` at 61 digits, is the floating-point answer it always was. A unit other than money, a measurement with an uncertainty, a statistic such as a median and a matrix entry stay in floating point, and so do the areas, reciprocals and rates other than prices that units now form when they multiply and divide. A negative zero keeps the sign floating point gives it, so `1 / (0.0 * -1)` is still -Infinity. The plain whole-number arithmetic is unchanged: two whole numbers never take the decimal path, and each exact path is a call behind a property test rather than code in the VM's dispatch loop, which keeps that loop under the size V8 will optimise.

Fixes #579.

## Verification

A new suite pins every operation above against its exact value and its nearest double, the rounding family, the percentage paths, the totals through both document passes, the fraction bridge, negative zero, a figure carrying its sources and the exact totals of such figures, every spelling of a price per unit against the plain product it abbreviates, and each boundary, including the 34-digit limit, a huge power refused before it is built, the unit products that stay in floating point, and a count or a price per unit that has no short decimal. The cross-path suite gains the decimal column, range, tag and table totals through `parseDocument` and `evaluateDocument`. The hardening suites that pinned the floating-point answers now pin the exact ones, with each reversal recorded, and still pin floating point through scientific notation.

An A/B against a build of the previous main ran 34,709 cases: every documented example, line by line and as whole documents through both document passes, every string the test suite evaluates, 6,000 generated decimal lines, 3,000 generated prices per unit in every spelling, and 360 generated documents with totals, tags and table columns. 1,598 answers differ, all of them the intended changes above: 1,313 carry the nearest double to the exact answer with the display unchanged, 142 comparisons are decided on the exact values, 54 bills through a price per unit or a quantity at a price round their half cent as the plain product does, 2 prices per unit on their own round a half cent as money does, 1 bill of a tenth of a cent is $0.00 as `$0.001` is, 29 whole results drop `.00`, 25 roundings take the exact half or the exact digits (`to N dp`, a percentage, a total), 10 `as scientific` and 2 `as fraction` readings lose the approximation, 5 remainders and 2 sums are exactly zero, 5 `floor`, `ceil` and `trunc` read the typed digits, 4 whole powers and 1 product past the safe range show their exact digits, and 3 conditionals take the other branch. Every documented example that differs is on a page this change updates. No answer changed type, and none became or stopped being an error.

The VM's dispatch loop, compiled the way Jest compiles it, is 46,898 bytes of bytecode against the previous 46,598, with 14,542 to spare below the 61,440 V8 will optimise. The benchmark comparison against the previous main, five alternating runs of the vm, pipeline and document-parse suites with Maglev and five with `--no-maglev` (what the benchmark job's Node 22 sees of an oversized loop), passes the regression gate on every pair: the suite geometric means of the per-case medians are 0.990, 0.995 and 1.004 with Maglev, and 0.982, 1.001 and 0.977 without it. The decimals page is rewritten, the fractions and exact coefficients pages updated, and the money precision page gains prices per unit, with proven examples. `npm run verify:ci` passes: TESTS tests across SUITES suites, with the bundled-consumer contract.
