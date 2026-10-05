---
"solve-engine": patch
---

A time after a label is read as a time: `Total: 24:00` is refused as the time 24:00, where it answered 0, and `Total: 1000:1002` is refused by name, where it answered 1,002

A line that does not parse whole is retried with the text before a colon set aside as a label. A colon pair the clock rules declined is refused when the number before it is an operand, which `timeAtColon` decided from the token in front of that number: an operator, a bracket or a comma. A label's colon was not one of them, so in `Total: 24:00` the `24` was read as a second label and the line answered the `00` after the time's colon (found in testing). A label's colon now leads an operand (`OPERAND_BEFORE` in `engine/ColonLabel.ts`): the figure after it starts the expression, so the pair is the time it is written as, and is refused in the same words as on a line of its own.

| line | before | now |
| --- | --- | --- |
| `Total: 24:00` | `0` | "24:00" is not a valid time |
| `Total: 1000:1002` | `1,002` | "1000:1002" is not a valid time |
| `Total: 9:60` | `60` | "9:60" is not a valid time |
| `Total (net): 24:00` | `0` | "24:00" is not a valid time |
| `Total: 9:30` | 9:30 AM today | 9:30 AM today |
| `Total: total(1000:1002)` | `3,003` | `3,003` |

The boundary: `1000:1002` after a label is no time (its hours are past 23) and, at the start of an expression, no range either, since a range is read only as the list of `sum`, `prod`, `map` or `reduce`; it is refused as the bare `1000:1002` is, and `Total: sum(1000:1002)` adds it up. A number that follows a word is still part of the name (`Week 12: 75`, `Week 12:75`), and a colon with a space after it is still a label's. Digits from another script before a colon (`٢٤:00`) lex as a word and are still read as a label, on a line of their own as after one; that is a separate fix, pinned as a `test.failing` in the spec.

## Verification

`FoundBug_labelColonTime.spec.ts` holds 24 tests: the lines that exposed it through `evaluateExpression` and `evaluateLine`, each against the bare pair, a real time after a label, both document passes agreeing, every label form on the labels page; unit tests of `OPERAND_BEFORE` and `timeAtColon` (ordinary: a label's colon; boundary: a word before the number, a space after the colon, a pair at the start, a colon that ends the line; hostile: a colon first, two thousand alternating tokens, a word after the colon); the adversarial cases (prototype words as the label and the hour with `Object.prototype` unchanged, five hundred labels, deep brackets and a long sum in time, markup-shaped and look-alike labels, a value from the line above, a check and a section around it, an edit that fixes the time, zero, the last minute of a day, a negative, every numeric edge, CRLF and a trailing newline); and one `test.failing` pinning `٢٤:00`. `AdversarialFeatureSweep.spec.ts` gains `Total: X:00`. Gates run: `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:changeset`, `lint:error-codes`, `lint:docs`, the docs example specs, the label specs of batches Y, Z and AB, the hardening and integration specs, and the whole fast suite.

On top of main, the full suite ran 36,308 tests in 879 suites, all passing but 5 skipped, and `npm run test:temporal` passed its 3,803 tests.
