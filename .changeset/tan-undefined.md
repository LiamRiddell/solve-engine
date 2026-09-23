---
"solve-engine": patch
---

`tan` at an odd multiple of a right angle is refused rather than answered with a huge number

The tangent of 90° has no value: the curve runs off to infinity on either side. The double nearest π/2 is not π/2, though, so `tan(90 degrees)` returned the tangent of a slightly smaller angle, 16,331,239,353,195,370, as if that were the answer. An angle within the conversion's own rounding of an odd number of right angles is now refused with `TRIG_UNDEFINED`, naming the angle in degrees.

| expression | before | now |
| --- | --- | --- |
| `tan(90 degrees)` | 16,331,239,353,195,370 | error: tan is undefined at 90 degrees |
| `tan(270 degrees)` | 5,443,746,451,065,123 | error: tan is undefined at 270 degrees |
| `tan(pi/2)` | 16,331,239,353,195,370 | error: tan is undefined at 90 degrees |
| `tan(89.9 degrees)` | 572.96 | 572.96 |

The tolerance is the conversion's rounding, scaled to the size of the angle, so a ten-thousandth of a degree either side of the asymptote still answers. Past a trillion right angles a double cannot place an angle against an asymptote at all, and there `tan` keeps its ordinary answer.

Trigonometry had no page in the syntax reference; the number functions page now explains `sin`, `cos` and `tan`, radians against degrees, and this refusal, with proven examples.

The boundary: only `tan`'s undefined points are recognised. The other special angles are not yet exact, so `sin(180 degrees)` is still the 1.22e-16 the approximation of π leaves rather than 0; exact special angles and the wider domain errors are #510.

## Verification

New tests pin each refused angle in degrees, radians and gradians, the message, the angles just either side of the asymptote, the ordinary angles, and a very large angle that keeps `Math.tan`'s answer. `npm run verify:ci` passes: 9,745 tests across 493 suites, with the bundled-consumer contract.
