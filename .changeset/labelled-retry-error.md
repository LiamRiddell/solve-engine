---
"solve-engine": patch
---

A labelled line that cannot be worked out reports what is wrong with its expression: `Total: average(10:12)` is refused for its clock time, where it said only that the label's colon was unexpected

A line that does not parse whole is retried with the text before a colon set aside as a label. When that retry failed as well, its error was discarded and the whole line's reported, `Expected an operator or the end of the line, but found ":"`, which is true of the line but names nothing a reader can fix (found in testing). The line is then `<label>: <expression>`, and the expression's own error is the specific one, so it is now reported (`labelledRetryError` in `engine/ColonLabel.ts`), in the words the expression gets on a line of its own. The rightmost label's retry is the one kept, since its expression holds no label colon of its own.

| line | before | now |
| --- | --- | --- |
| `Total: average(10:12)` | Expected an operator or the end of the line, but found ":" | In average(...), 10:12 is a clock time, not a range, and a time cannot be averaged: ... |
| `Total: max(1000:1002)` | Expected an operator or the end of the line, but found ":" | "1000:1002" is not a valid time |
| `Slice: v[0:1]` | Expected an operator or the end of the line, but found ":" | Range-based matrix slicing needs exactly 2 arguments ("a[rowRange, colRange]"), got 1. |
| `Total: (1 + 2` | Expected an operator or the end of the line, but found ":" | The line ends where ")" was expected |
| `x := 5` | Expected an operator or the end of the line, but found ":" | Expected an operator or the end of the line, but found ":" |

The boundary: only a line whose parse stopped at a label's colon reports the labelled expression's error. A colon followed by `=` (`x := 5`) keeps the line's own wording, whose suggestion is to assign with `=` on its own, and a line that stopped anywhere else keeps the parser's error for the whole line.

## Verification

`FoundBug_labelledRetryError.spec.ts` holds 19 tests: the lines that exposed it through `evaluateExpression` and `evaluateLine`, each against the expression's own error, the real refusals as the reader sees them, both document passes agreeing with the list defined above, a line that parses after its label; unit tests of `labelledRetryError` (ordinary: a parse stopped at the colon; boundary: no retry, a colon that ends the line; hostile: a parse stopped elsewhere, a colon before `=`, inherited names as token types); and the adversarial cases (prototype words as the label and the call with `Object.prototype` unchanged, five hundred labels, an open bracket nest and a long sum in time, markup-shaped text after the label, `x := 5` and `x:` keeping their wording, a typo, a value from the line above and a section, an edit that completes the expression, every numeric edge, an empty and a whitespace label, CRLF and a trailing newline). `AdversarialFeatureSweep.spec.ts` gains `Total: average(X:12)`. Gates run: `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:changeset`, `lint:error-codes`, `lint:docs`, the docs example specs, the label specs, the hardening and integration specs, and the whole fast suite.
