---
"solve-engine": patch
---

A bracketed figure before a colon is refused as naming nothing: `(24):00` says so, where it answered `0`

A line that does not parse whole is retried with the text before a colon set aside as a label, and a label is a name. A calculation with no word in it (`(1+2): 5`) was already refused, but a bracketed figure with no operator inside was not, so `(24):00` was the label `(24)` and answered the `00` after the colon; `[24]:00`, `(9):30` and `Total: (24):00` did the same (found in testing). `(24):00` is not a time either, so neither reading gives an answer. A bracket with no word beside it now makes the text a bracketed expression, refused in the words and with the code a calculation gets (`colonLabelFault` in `engine/ColonLabel.ts`, `LABEL_NOT_A_NAME`). The letters inside a number (the `e` of `1e308`) no longer count as a word there, so `(1e308):00` is refused too.

| line | before | now |
| --- | --- | --- |
| `(24):00` | `0` | "(24)" before the colon is a calculation, not a label: a label names the figure in words |
| `(9):30` | `30` | "(9)" before the colon is a calculation, not a label: a label names the figure in words |
| `[24]:00` | `0` | "[24]" before the colon is a calculation, not a label: a label names the figure in words |
| `Total: (24):00` | `0` | "(24)" before the colon is a calculation, not a label: a label names the figure in words |
| `Total (2026): 500` | `500` | `500` |
| `(net): 5` | `5` | `5` |

The boundary: a bracket beside a word is part of a name, as `labels.md` promises (`Total (2026): 500`, `(net): 5`), and so is a bracketed word on its own (`(x):00` is the label `(x)`), since a word is what a label is made of. A bracketed figure is refused rather than read as the number in it, because the line holds no name for the figure after the colon and no time.

## Verification

`FoundBug_bracketedFigureLabel.spec.ts` holds 26 tests: the lines that exposed it through `evaluateExpression` and `evaluateLine` (round and square brackets, nested brackets, a space before the colon or after it, after a label's colon, after an operator, two bracketed figures, an unbalanced bracket), a bracket beside a word kept as a name, the refusal it follows and the same figure with no colon unchanged, both document passes agreeing; unit tests of `colonLabelFault` (each bracket, a word beside it, only the text since a label's colon, a date, an unbalanced bracket, markup), `labelSubject` (an invisible character, a long label quoted short) and `visibleText` (direction and zero-width characters, a soft hyphen, a control character, an astral tag character, markup and other scripts left alone, the empty string); the adversarial cases (prototype words in the brackets with `Object.prototype` unchanged, deep brackets, a long sum, five hundred lines, look-alike, invisible and markup-shaped text, a value from the line above with a check and a section around it, an edit that drops the brackets, zero, a negative, the last minute of a day, every numeric edge, CRLF, a trailing newline and padding). The pin in `FoundBug_otherScriptDigitsLabel.spec.ts` turned red with the fix and is now a passing test. `AdversarialFeatureSweep.spec.ts` gains `(X):00`. Gates run: `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:changeset`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, the docs example specs, batch AC's and AD's found-bug specs, the hardening and integration specs, and the whole fast suite.
