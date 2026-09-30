---
"solve-engine": patch
---

Four lines that answered with confidence and were wrong are now refused by name: an expression in unknowns that divides by zero, a word that names an inherited property read as a month, a decimal beside a colon read as a clock time, and an inverse trigonometric call converted to a length

These were found by earlier adversarial batches rather than reported as issues. Symbolic algebra over a division by zero answered as if the quotient had a value: `expand((x+1)/0)` was 1, because the simplifier's cancellation took the greatest common divisor of the numerator and zero, which is the numerator itself, and cancelled the fraction to one; `der(x/0, x)` and `solve(x/0 = 1, x)` then worked on that. A quotient by an exact zero is now refused where it is written, and `^-1` over an unknown is the reciprocal it is for a number, rather than a refusal under the internal name "builtin 65". The date rule that reads `5 March` looked a word up in its month table without an own-property guard, so `5 constructor` found the prototype's `constructor` and reported "undefined 2026 has NaN days". The clock-time rule read `1.5` with `parseInt`, so `1.5:3` was 1:03. And `asin(0.5) in km` gave the angle the unit it was asked for, as `0.5 in km` does.

| line | before | now |
| --- | --- | --- |
| `expand((x+1)/0)` | 1 | This expression divides by zero, so it has no value, whatever its unknowns are. |
| `der(x/0, x)` | 0 | the same refusal |
| `solve(x/0 = 1, x)` | true for every value | the same refusal |
| `expand((x*0)^-1)` | "builtin 65" cannot be applied to an expression that still contains an unknown. | the same refusal |
| `expand((x+1)^-1)` | "builtin 65" cannot be applied ... | (x+1)^(-1) |
| `5 constructor` | "5 constructor" is not a real date: undefined 2026 has NaN days. | Undefined variable: constructor |
| `1.5:3` | Wednesday, September 30, 2026, 1:03:00 AM | "1.5:3" is not a valid time |
| `asin(0.5) in km` | 0.52 km | an angle cannot be converted to a length |

The boundary: only an exact zero counts as a division by zero, so a very small divisor is an ordinary one, and `1/0` with no unknown is still ∞. An inverse trigonometric call is read as an angle for any target only when the left side is the call and nothing else; a longer left side such as `asin(0.5) * 6371 km` (an arc length) may be anything, so it is read as radians only for an angle target, as before, and `2 * asin(0.5) in km` is still labelled. The same own-property guard now covers the stocks package's date phrase, which had the same lookup.

## Verification

`FoundBug_symbolicDivisionByZero.spec.ts` (23 tests), `FoundBug_prototypeWordAsMonth.spec.ts` (12), `FoundBug_decimalBeforeColonIsNoTime.spec.ts` (10) and the angle half of `FoundBug_subtractFromAndAngleTargets.spec.ts` (25 in all) hold the lines above, unit tests of `dividesByZero`, the simplifier's quotient by zero, `symbolicToValue`, `binaryOp`, `symbolicPow`, `symbolicBuiltin`, `isClockDigits`, the month rule, `leftIsWholeCall` and `readsAsRadians` with ordinary, boundary and hostile arguments, and the three adversarial sides: prototype words in every slot, long sums and deep brackets over zero, look-alike digits and markup-shaped text, the zero or the day from the line above through both document passes, and the numeric edges. `Issue829_wordsReadAsGuessed.spec.ts` pinned `asin(0.5) in km` as 0.52 km; it now pins the refusal. The adversarial sweep gains the forms. The symbolic, time and number-functions pages show the refusals as proven examples.
