---
"solve-engine": patch
---

A negative half rounds away from zero, a zero has no sign, `m/s²` reads back and is named in words, a function refuses a quantity it has no reading of, and an odd root of a negative number is real

Six gaps older than this release, found by the cross-feature review before it and the same in 2.39.0.

**A half rounds away from zero, however rounding is written (#584).** `round(-2.5)`, `-2.5 rounded` and `to nearest` took a half towards positive infinity, while `round(-2.5, 0)` and `to N dp` took it away from zero, so one function gave two answers. Every form now takes a half away from zero, the rule a spreadsheet's `ROUND` follows. `rounded up` and `rounded down` name their own direction and are unchanged.

| expression | before | now |
| --- | --- | --- |
| `round(-2.5)` | -2 | -3 |
| `-2.5 rounded` | -2 | -3 |
| `-25 to nearest 10` | -20 | -30 |
| `round(-$2.50)` | -$2.00 | -$3.00 |
| `-2.5 to 0 dp` | -3 | -3 |
| `-2.5 rounded up` | -2 | -2 |

**A zero is written without a sign (#585).** A double has a negative zero, equal to zero in every comparison, and the formatter wrote its sign. The value keeps it, since `1 / (0 * -1)` is -∞ where `1 / 0` is ∞; only the display drops it.

| expression | before | now |
| --- | --- | --- |
| `ceil(-0.5)` | -0 | 0 |
| `0 * -1` | -0 | 0 |
| `-0.001%` | -0.00% | 0.00% |

**`m/s²` reads as the acceleration the engine writes (#586).** The lexer reads `s²` as one word, and no unit is spelled that way, so the answer `9.81 m/s²` could not be typed back.

| expression | before | now |
| --- | --- | --- |
| `9.81 m/s²` | error: Undefined variable: s² | 9.81 m/s² |
| `10 kg * 9.81 m/s²` | error: Undefined variable: s² | 98.10 N |

**A function refuses a quantity it has no reading of (#587).** A sine, a logarithm or an exponential of a length has no meaning, and read as its bare number the answer depended on the unit written: `sin(1 m)` was 0.84 and `sin(100 cm)` -0.51. These are refused by name, as `sqrt(4 m)` already was. An angle, a plain number and a ratio that cancels still answer.

| expression | before | now |
| --- | --- | --- |
| `sin(1 m)` | 0.84 | error: sin takes an angle or a plain number, not a length |
| `log(10 kg)` | 2.30 | error: log takes a plain number, not a mass |
| `sin(30 degrees)` | 0.50 | 0.50 |
| `sin(1 m / 2 m)` | 0.48 | 0.48 |

**An odd root of a negative number is real, and an even one is refused (#588).** A negative number to a fractional power answered NaN. The exponent is known as a fraction when written as one (`1/3`) or typed as a decimal (`0.2` is a fifth), so an odd denominator gives the real root and anything else has no real value, refused by name as `log(-1)` is.

| expression | before | now |
| --- | --- | --- |
| `(-8)^(1/3)` | NaN | -2 |
| `(-8)^(2/3)` | NaN | 4 |
| `(-32)^0.2` | NaN | -2 |
| `(-1)^0.5` | NaN | error: (-1)^0.5 has no real value |

**An acceleration is named in words (#590).** `m/s^2` is held as the unit `mps2`, which has a dimension but no measure in the tables, so a conversion to it was refused as `"mps2" is not a unit`, even from an acceleration, and other refusals named `mps2` too. It now converts to itself, and every refusal calls it an acceleration.

| expression | before | now |
| --- | --- | --- |
| `9.81 m/s^2 in m/s^2` | error: "mps2" is not a unit. | 9.81 m/s² |
| `5 kg in m/s^2` | error: "mps2" is not a unit. | error: a mass cannot be converted to an acceleration |
| `9.81 m/s^2 in N` | error: Cannot convert mps2 to N: they do not measure the same thing | error: an acceleration cannot be converted to a force |
| `9.81 m/s^2 * 3 s` | error: Cannot combine incompatible units: mps2 and s | error: acceleration and duration cannot be multiplied |

The boundary: `^` stays in the real numbers, so `sqrt(-1)` is still `i` while `(-1)^0.5` is refused. `0/0` stays NaN and `1/0` stays infinity, the floating-point standard's defined answers rather than missing ones. `m/s²` is the one acceleration unit; `ft/s^2` and standard gravity as a unit are not in the tables, and an acceleration times a duration is not yet a speed.

The rounding, number-functions, operators, unit-arithmetic and derived-units pages carry proven examples of each change.

## Verification

A new test file per issue pins each case above, the forms that must not change, and, for #585, that the value keeps the sign division can see. Four existing tests that pinned the old answers now pin the new ones. `npm run verify:ci` passes.
