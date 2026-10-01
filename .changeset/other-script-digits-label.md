---
"solve-engine": patch
---

A figure in another script's digits before a colon is refused by name: `٢٤:00` says the digits are not read, where it answered `0`

The engine reads numbers in the digits 0 to 9 only, and the lexer reads a figure in another script's digits (Arabic-Indic `٢٤` for 24, Devanagari `२४`, fullwidth `１２`) as a word. A line that does not parse whole is retried with the text before a colon set aside as a label, so `٢٤:00` was the label `٢٤` and answered the `00` after it, and `Total: ٢٤:00` did the same (found in testing). Elsewhere such a figure is refused as a word the engine does not know (`٢٤ + 1` names `٢٤` as an undefined name), never read as a number, and the label reading now agrees. A figure that stands before the colon where a number would be an operand, by the rule a number in 0 to 9 follows there (`timeAtColon`), is refused by name and spelled in 0 to 9 (`otherScriptFigureAtColon` in `engine/ColonLabel.ts`, `OTHER_SCRIPT_DIGITS`), so retyping it gives the answer. A figure split by a zero-width space, or written straight after a number in 0 to 9 (`2٤`), is read as one figure.

| line | before | now |
| --- | --- | --- |
| `٢٤:00` | `0` | "٢٤" is written in digits the engine does not read: numbers are written in the digits 0 to 9, as in 24 |
| `Total: ٢٤:00` | `0` | "٢٤" is written in digits the engine does not read: numbers are written in the digits 0 to 9, as in 24 |
| `٩:٣٠` | refused as an undefined name | "٩" is written in digits the engine does not read: numbers are written in the digits 0 to 9, as in 9 |
| `٢٤: 5` | `5` | "٢٤" is written in digits the engine does not read: numbers are written in the digits 0 to 9, as in 24 |
| `Week ٢: 5` | `5` | `5` |
| `٢٠٢٦ budget: 500` | `500` | `500` |

The boundary: a figure after a word is part of the label's name, as a number in 0 to 9 is (`Week ٢: 5`, `٢٠٢٦ budget: 500`), and the same figure elsewhere on a line keeps its refusal as an undefined name. Reading another script's digits as numbers is a larger change to how a line is read and is not made here; this change only stops a label from swallowing such a figure and answering what follows it. A bracketed number before a time's colon (`(24):00`) and a direction override before a time in 0 to 9 (`U+202E` then `24:00`) are still read as labels and answer 0; both are separate bugs, pinned as `test.failing` in the spec.

## Verification

`FoundBug_otherScriptDigitsLabel.spec.ts` holds 41 tests: the lines that exposed it through `evaluateExpression` and `evaluateLine` (Arabic-Indic, Devanagari, fullwidth and mathematical digits, the Arabic decimal mark, a figure mixed with 0 to 9, after a label, after an operator, with a space either side of the colon), a figure after a word kept as a name, the same figure elsewhere refused as an undefined name, both document passes agreeing; unit tests of `digitValue` (each script, both ends of a run, the touching mathematical runs, every decimal digit Unicode has, and text that is not one digit), `otherScriptFigure` (marks, figures in 0 to 9, a word, markup, invisible characters, prototype words, ten thousand digits) and `otherScriptFigureAtColon` with `colonLabelFault` (the line's start, a label's colon, a number before the figure with and without the normaliser's product, a word before it, a colon first or last, a long figure quoted short); the adversarial cases (prototype words as the label with `Object.prototype` unchanged, ten thousand digits, five hundred labels, a long sum and deep brackets in time, look-alike, invisible and markup-shaped text, a value from the line above with a check and a section around it, an edit that retypes the figure, the other colon refusals unchanged, zero, a negative, the last minute of a day, every numeric edge, CRLF, a trailing newline and padding); and two `test.failing` pinning the separate bugs named above. The pin in `FoundBug_labelColonTime.spec.ts` turned red with the fix and is now a passing test. `AdversarialFeatureSweep.spec.ts` gains `٢٤:X` and `Total: ٢X:00`. Gates run: `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:changeset`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, the docs example specs, batch AC's six found-bug specs, the hardening and integration specs, and the whole fast suite.
