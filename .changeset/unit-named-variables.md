---
"solve-engine": patch
---

A variable named like a unit symbol divides as a variable: with `m` and `s` defined, `m/s^2` is their quotient

The lexer reads every word the unit table knows as a unit, including single letters people use as variable names, and three normaliser rules fused those words wherever they stood. With `m = 3` and `s = 2`, the acceleration rule turned `m/s^2` into the unit `mps2` and the line failed with "Undefined variable: mps2"; the compound-unit rule read `m/s` as a speed, and the bare-denominator rule read `/ s` as "per second". Each rule now leaves a unit-named word alone where the expression expects a value: at the start of a line, or after an operator, bracket, comma or `=`.

| document | before | now |
| --- | --- | --- |
| `m = 3`, `s = 2`, `m/s^2` | error: Undefined variable: mps2 | 0.75 |
| `m = 3`, `s = 2`, `m/s` | error: Undefined variable: m/s | 1.50 |
| `h = 4`, `km = 8`, `km/h` | error: Undefined variable: km/h | 2 |
| `9.81 m/s^2` | 9.81 m/s² | 9.81 m/s² |
| `100 km / h` | 100.00 km/h | 100.00 km/h |

A unit written after a value is fused exactly as before: after a number (`9.81 m/s^2`), a closing bracket (`(2+3) m/s^2`), a variable (`x m/s^2`) or a conversion keyword (`in km/h`). The position test is shared, in `normalizer/ValuePosition.ts`.

The boundary: this is about position, not about which names are defined. A unit-named variable written after a value is still read as a unit (`2 m` is two metres even with `m` defined), and a line that is only unit words with no variables defined (`m/s^2`) is refused as an undefined variable rather than read as an acceleration with no number.

## Verification

A new suite pins the reported document and its neighbours, and every rate, speed and acceleration form that still fuses after a value. The variables page gains a proven `solve-doc` example. `npm run verify:ci` passes: 9,745 tests across 493 suites, with the bundled-consumer contract.
