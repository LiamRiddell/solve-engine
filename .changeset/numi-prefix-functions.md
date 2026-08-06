---
"solve-engine": minor
---

Functions can be called without brackets, and a degree unit now reaches trigonometry.

`sqrt 16`, `round 3.45`, `fact 5` and `ln 3` all work alongside the bracketed forms. The argument binds tightly, so `sqrt 16 + 9` is thirteen rather than five. `root` and `log` take a degree or base first, as `root 2 (8)` and `log 2 (8)`.

`ln` is new, as another name for the natural logarithm `log` already computed. `log` gains a two-argument form for logarithms to a base, without changing what `log(x)` has always meant.

Also fixes a wrong answer that had nothing to do with brackets. Trigonometric functions read their argument through a conversion that discards units, so `sin(45 deg)` returned the sine of forty-five *radians*, silently. Degrees and gradians are converted now; a plain number is still radians, and a unit that is not an angle is left alone rather than guessed at.

`log 2 (8)` is exactly 3. Computing it as a ratio of natural logs gives 2.9999999999999996, so base 2 and base 10 use the dedicated functions.
