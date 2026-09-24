---
"solve-engine": minor
---

What-if and sweeps: a line re-run with different inputs, without editing the note

A note answered only for the inputs it held. Seeing what a different deposit would do meant editing the deposit, reading the answer and putting the deposit back, and goal seek, the one form that re-ran a line, could only vary a variable the target line named itself. `line 4 with deposit = 150000` now answers what line 4 would say if `deposit` were 150,000, and `line 4 for rate from 3% to 6% step 1%` lists line 4's answers across a range, the way a spreadsheet's data table does. Both re-run every line from the top of the note down to the target, so an input reaches the target through the lines between.

The note below is `deposit = 100000`, `rate = 4%`, `payment = monthly repayment on deposit over 25 years at rate`, `payment * 12`. Line 4 reads `payment`, and only line 3 reads `deposit`.

| line 5 | before | now |
| --- | --- | --- |
| `line 4 with deposit = 150000` | error: Unexpected token after expression: "=" | 9,501.06 |
| `line 4 with deposit = 150000 and rate = 5%` | error: Unexpected token after expression: "=" | 10,522.62 |
| `line 4 for rate from 3% to 6% step 1%` | error: Expected token type "AT" but got "FROM" ("from") | [5,690.54, 6,334.04, 7,015.08, 7,731.62] |
| `line 4 for deposit from 100000 to 200000 step 50000` | error: Expected token type "AT" but got "FROM" ("from") | [6,334.04, 9,501.06, 12,668.08] |

Several inputs change together when joined by `and` or a comma, and each value is an ordinary expression that keeps its unit: with `price = $100` and `qty = 3`, `line 3 with price = $120` is $360.00. An input is held at its new value on every line of the re-run, so the line that sets it reads as the override. A sweep's range is plain numbers, percentages, or quantities of one kind (mixed units of that kind are read in the start's unit); it runs down with a negative step, and includes its end when a step lands on it. The answers are listed as amounts, as every list in the engine is, so a money line's sweep lists its amounts and a percentage lists as its fraction.

Nothing in the note changes. The lines are re-run from their text in a scratch engine built like the document's own (the same packages, configuration, locale, calendar and random seed) and discarded afterwards, so the note's variables, cached results and dependency graph are untouched, and the questions stay live as the note is edited. Because the re-run works from the text, `parseDocument` and the incremental evaluator give the same answers, and, unlike goal seek, the forms resolve through the batch pass as well.

A host asks the same question with `engine.whatIf(text, overrides)`, which evaluates the whole note with the named inputs held fixed and returns the `ParsingResult` that `parseDocument` would, without touching the engine. An override is a number, text evaluated as an expression (`"$120"`, `"5%"`), or a `Value`. A package author reaches the same re-run from a plugin function through `LineExecutionContext.rerunLines(lineNumber)`, which opens a `LineRerun` session with `run(overrides)`, `uses(name)` and `close()`.

The boundary: every case the engine cannot answer honestly is a named error, never a guess and never a hang. That covers a zero step or one that moves away from the end; more than 1,000 values, or more than 100,000 line re-runs, in one sweep; an input no line up to the target uses, which is almost always a misspelling; a target that is not a calculation; a what-if naming its own line or running inside another's re-run; a span holding a line that sets a `global :name`, since other documents read globals and a scenario's value would reach them; and live data the note has not already fetched, since a re-run never fetches. The target is a line number: `prev`, spans of lines and named scenarios (`line 5 in bull`) are not in this release. The re-run reads the note the way the batch pass does, so a goal seek inside the span reports that pass's refusal. Goal seek itself is unchanged and still needs its variable on the target line; the same re-run is what can later let it look through the lines between, and that is left to its own change. A sweep does not step dates or times.

## Verification

A new suite pins the what-if through the lines between (including a user function, a running total and a target below the asking line), several inputs, kept units and money, the overridden line reading as the override, seeded draws repeating in the re-run, sweeps up, down, across units and over money, every named refusal, the note reading the same with and without the forms through both document passes, the engine's variables after a pass, an edit reaching the what-if in the incremental evaluator in agreement with a fresh pass, and `engine.whatIf` with its overrides and refusals. `CrossPathDocumentFeatures` gains the what-if and sweep in its house shape: the document result, agreement between `parseDocument` and `evaluateDocument`, and the single-line refusal. A new syntax page, "What-if and sweeps", carries proven examples, and the embedding guide and the plugin-function guide document the host API and `rerunLines`. `npm run verify:ci` passes: 11,248 tests across 532 suites, with the bundled-consumer contract.
