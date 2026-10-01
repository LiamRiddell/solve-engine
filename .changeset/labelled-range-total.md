---
"solve-engine": patch
---

A range inside a call keeps its meaning after a label: `Total: total(1000:1002)` is 3,003, where it was refused as '"1000:1002" is not a valid time'

A line that does not parse whole is retried with the text before a colon set aside as a label, trying each colon from the right. In `Total: total(1000:1002)` the rightmost colon is the range's, inside the call, and the check that refuses a colon pair the clock rules declined (`1 + 24:00`) read `1000:1002` there as a time of day and refused the line before the label's own colon was tried (found in testing). A label stands at the top level of a line, never inside a bracket, so a colon inside one is now passed over (`openBracketsAt` in `engine/ColonLabel.ts`), and the call after the label is the range it is on a line of its own.

| line | before | now |
| --- | --- | --- |
| `Total: total(1000:1002)` | "1000:1002" is not a valid time | `3,003` |
| `Total: total(1,000:1,002)` | "1,000:1,002" is not a valid time | `3,003` |
| `Total: sum(1:3)` | "1:3" is not a valid time | `6` |
| `Cost: total(10:12)` | "10:12" is not a valid time | `33` |
| `total(1000:1002)` | `3,003` | `3,003` |

The boundary: only a colon inside a bracket is passed over, so a label's colon and a time at the top level of the line are judged as before (`Total: 1 + 24:00` is still refused as the time 24:00). A refusal raised by the expression after the label itself, such as a clock time in `average(...)`, is still reported in the parser's words about the label's colon, as it was before this change.

## Verification

`FoundBug_labelledRangeTotal.spec.ts` holds 19 tests: the lines that exposed it through `evaluateExpression`, `evaluateLine`, `parseDocument` and `evaluateDocument`, each against the unlabelled call, the other range forms after a label (`sum(x^2, 1:3)`, `map`, a label in brackets, two labels, arithmetic after the call); unit tests of `openBracketsAt` (ordinary; boundary: no tokens, no brackets, a bracket left open; hostile: closing brackets with none open, fifty thousand open brackets); and the adversarial cases (prototype words as the label and the bound with `Object.prototype` unchanged, deep brackets and two hundred labels in time, markup-shaped labels, a bound from the line above, a check, a section, a pair that is no time, a descending range, an edit adding the label, zero, negatives, a range of one, every numeric edge, CRLF and a trailing newline). `AdversarialFeatureSweep.spec.ts` gains `Total: total(X:1002)`. Gates run: `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:changeset`, `lint:error-codes`, `lint:docs`, the docs example specs, the label, time and aggregate specs, the hardening and integration specs, and the fast suite.
