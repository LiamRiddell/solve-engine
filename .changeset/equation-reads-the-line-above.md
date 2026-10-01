---
"solve-engine": patch
---

`ans` and `prev` in an equation are the answer above the equation: `5`, `x + ans = 7`, `x =>` solves to `2`

A stored equation keeps its two sides and runs them when an arrow asks for the unknown. It ran them as the line asking, so `ans` and `prev`, which mean the answer on the line above, read the line above the arrow: in `5`, `x + ans = 7`, `x =>` that is the equation's own confirmation, which has no value, and the arrow answered "An equation side has no exact value to solve with" (found while testing stored equations). The reader wrote `ans` on the equation's line, and meant the 5 above it.

The sides now run as the line that stored the equation, wherever it is now: an editor that inserts a line above the equation moves it with the equation, and changing the line above it re-solves it. A side that is itself a refusal is passed on as it is, rather than replaced by "no exact value", so `ans` at the top of a note says what it says on its own line. Evaluated on its own, outside a note, such an equation has nothing to read and is refused where it is typed, with the structured error `ans` gives there (`LINE_REF_NO_DOCUMENT`), rather than stored and left to fail at the arrow. Both document passes agree on every case.

| line | before | now |
| --- | --- | --- |
| `5`, `x + ans = 7`, `x =>` | An equation side has no exact value to solve with. | `2` |
| `5`, `x + prev = 7`, `x =>` | the same refusal | `2` |
| `5`, `x + ans = 7`, `100`, `x =>` | `-93`, solved with the 100 above the arrow | `2` |
| `4`, `x^2 = ans`, `x =>` | the same refusal | `[-2, 2]` |
| `x + ans = 7` at the top, then `x =>` | An equation side has no exact value to solve with. | Line 0 has not been evaluated yet (forward reference, or out of range) |
| `x + ans = 7`, on its own | `x stored as an equation: solve with "x =>"` | A line reference needs a document to read, and an expression evaluated on its own has none |

The boundary: only the relative forms read differently, since a line number (`line 1`) and a name already read the same line from anywhere. A name in an equation is still read at the arrow, with the value it holds there, as the stored-formula fix arranged; `ans` is the one name that means a line rather than a value. An equation with a unit on a side remains the parse error it was, with `ans` or without. The entry for `π` and `ans` under the arrow, earlier in this release, said `ans` in an equation was read relative to the line that asks; that sentence is corrected.

## Verification

`FoundBug_lineReadInAnEquation.spec.ts` holds 70 tests: `ans` and `prev` in an equation, lines between it and the arrow, a power, a product, `total above` and `line 1`, a product of names, `ans` at the top of a note, and the single-line refusal through `evaluateLine` and `evaluateExpression`; four live-editor edits (the line above changed, a line inserted below and above the equation, the equation deleted); unit tests of `solveEquationValues` (two values, a refusal on either side passed on unchanged, an infinite side, prototype words as the unknown); and the adversarial cases (prototype words as the unknown with `Object.prototype` unchanged, a look-alike of `ans`, a thousand lines between in time, text edges, markup, an error, prose and a quantity above, a check and a what-if, `solve` on a later line, a second equation for the same unknown, every numeric edge above the equation through both passes, zero, negative zero, a 34-digit line, CRLF, empty and whitespace lines). `CrossPathDocumentFeatures.spec.ts` gains the form through `parseDocument`, `evaluateDocument` (agreeing value for value, and after an edit) and the single-line refusal; `AdversarialFeatureSweep.spec.ts` gains two document templates. Gates: see the verification of `unit-named-unknown.md`.
