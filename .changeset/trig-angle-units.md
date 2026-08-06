---
"solve-engine": patch
---

Trigonometric functions no longer discard a degree unit.

`sin(45 deg)` returned the sine of forty-five **radians**. The builtins read their argument through a conversion that drops the unit, so the degrees were lost between the parser and the arithmetic, and the result was a plausible-looking number that was simply wrong. Nothing surfaced: no error, no warning, and 0.85 is not obviously not the sine of forty-five degrees.

Degrees and gradians are converted now, in every spelling. A plain number is still radians, so `sin(1)` is unchanged, and a unit that is not an angle keeps falling through to the plain number rather than being guessed at.
