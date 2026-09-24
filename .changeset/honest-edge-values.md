---
"solve-engine": minor
---

Special angles give exact answers, and a function outside its domain says so

The angles people type, 0, 30, 45, 60 and 90 degrees and their multiples, and the same angles written with π, now give exact sines, cosines and tangents. A computer holds none of those angles exactly, so the sine of its nearest approximation to 180° was 0.000000000000000122 and the tangent of 45° was 0.9999999999999999. And the logarithms and inverse functions, asked for a value outside their domain, answered with an infinity or `NaN`; they now refuse by name with `FUNCTION_DOMAIN`, saying what the function accepts.

| expression | before | now |
| --- | --- | --- |
| `sin(180 degrees)` | 1.22e-16 | 0 |
| `cos(90 degrees)` | 6.12e-17 | 0 |
| `tan(45 degrees)` | 1.00 (0.9999999999999999) | 1 |
| `tan(180 degrees)` | -1.22e-16 | 0 |
| `log(0)` | -∞ | error: log is only defined for positive numbers |
| `log(-1)` | NaN | error: log is only defined for positive numbers |
| `asin(2)` | NaN | error: asin is only defined for numbers from -1 to 1 |
| `atanh(1)` | ∞ | error: atanh is only defined for numbers strictly between -1 and 1 |

An angle counts as special when it is within the conversion's own rounding of a multiple of 30° or 45°, with the tolerance scaled to the angle, the rule `tan`'s asymptote check from #532 already uses. The degree-argument forms `sind`, `cosd` and `tand` follow the same rules, and `tand(90)` now refuses the asymptote as `tan(90 degrees)` does. The refusals cover `log`, `log10`, `log2`, `log1p`, `asin`, `acos`, `asind`, `acosd`, `acosh` and `atanh`.

The boundary: exactness covers the multiples of 30° and 45°; an irrational exact value such as the sine of 45° is the nearest double, and any other angle is computed as before. A square root of a negative number is not refused, since it has an exact complex answer (`sqrt(-1)` is `i`). Division by zero keeps the floating-point standard's infinity, `1/0` is ∞, a decision recorded in the arithmetic hardening suite: it is the standard's defined answer for an operator, where the functions above had no answer at all. A `NaN` argument is not refused, since whatever produced it has its own story.

## Verification

A new suite pins each exact angle in degrees, radians, gradians and the degree functions, the positive zero, the irrational special values, unchanged ordinary angles, `tand`'s asymptote, every domain refusal and its message, the edges of each domain, and the complex square root and IEEE division that stay as they were. The number functions page gains exact angles and a section on domains, with proven examples. `npm run verify:ci` passes: 10,709 tests across 517 suites.
