---
"solve-engine": minor
---

A number divided by a quantity is its reciprocal

A plain number divided by a quantity kept the quantity's unit, so `1 / (2 m)` was reported as half a metre when it is half of one per metre, and `10 / (5 s)` as two seconds when it is two a second. The answer is now the reciprocal: a per-unit rate, written the way the engine already writes a count per something (`/m`, `/s`), which cancels against the quantity again.

| expression | before | now |
| --- | --- | --- |
| `1 / (2 m)` | 0.50 m | 0.50 /m |
| `10 / (5 s)` | 2.00 s | 2.00 /s |
| `1 / (2 m) * 4 m` | 2.00 m2 | 2 |
| `1 / (60 km/h)` | 0.02 km/h | 1:00 /km |
| `1 / (50 Hz)` | 0.02 Hz | 0.02 s |
| `1 / (2/week)` | 0.50 /week | 0.50 week |
| `1 / (20 C)` | 0.05 C | error: no unit |
| `1 / 2 hour` | 0.50 hour | 0.50 hour |
| `3 / 4 cup` | 0.75 cup | 0.75 cup |

A rate turns over, so the reciprocal of a speed is a time per distance (`1 / (60 km/h)` is a minute a kilometre, `h/km`), a count per something turns into that something, and a frequency turns into its period in seconds. A temperature is measured from a zero point of its own and has no reciprocal, so it is refused by name as `UNIT_RECIPROCAL_UNSUPPORTED`, as is a label that is not a unit.

A fraction written in front of a unit is still that much of the unit. The unit binds to the number beside it before any operator does, which is why `1 / 2 hour` was one over two hours all along and only looked right; the uom package now brackets such a fraction before the unit binds, where the source still shows it was written as one amount. It applies to a fraction that starts an amount: a quantity or a symbol before the slash (`100 km / 2 h`, `$10 / 2 h`) is a division, as is a number straight after another division or a power (`6 / 3 / 2 h`), and a bracket (`1 / (2 hour)`) asks for the reciprocal.

The boundary: a reciprocal is a per-unit rate, not a named unit. Ten per second is `10.00 /s` rather than ten hertz, and the two do not convert into each other. A percentage or a big integer divided by a quantity keeps its existing reading.

Fixes #570.

## Verification

The unit algebra suite gains the reciprocals above, the cancellation back to a number, a variable holding a quantity, the refused temperature, and the fractions that stay amounts. The multiplying and dividing units page gains a proven section on reciprocals and loses the boundary note that described the old reading. `npm run verify:ci` passes: 11,654 tests across 535 suites, with the bundled-consumer contract.
