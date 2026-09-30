---
"solve-engine": patch
---

A document pass starts from nothing an earlier note left, `evaluateDocument` refuses the documents `parseDocument` refuses, and a line break inside an edit is a line break

Three faults in the document model and the two document passes, found by earlier batches.

- **A reused engine carried one note into the next.** `parseDocument` emptied its tables of user units and names of several words before each pass, but `evaluateDocument` did not, so a note evaluated after another read its units and names. Both passes also kept every variable, function and stored equation a note had defined, so `x * 2` answered 10 on an engine that had parsed `x = 5`, and a second parse of `x * 2` above `x = 5` answered 10 where the first refused. Every document pass (`parseDocument`, `evaluateLines`, `evaluateDocument`) now opens with `beginDocument`, which empties both tables and removes every variable, function and equation a document line wrote.
- **`evaluateDocument` ignored `performance.maxDocumentLines`.** The batch pass refuses a document past the ceiling before scanning it; the incremental pass ran it. It now asks the engine first, and refuses with the same `DOCUMENT_TOO_LARGE` error. Found beside it: a structural edit grew a `DocumentModel` past its own ceiling, since only a whole document was counted. The changes are now counted before any is applied (`assertChangesFit`), through the model and through the evaluator's `applyTransaction` alike, and a refused edit changes nothing.
- **A carriage return inside an edit stayed on one line.** `setDocument` and `parseDocument` end a line at a line feed, a lone carriage return or the pair, but `editLine` and `applyTransaction` kept `5\r6` as one line, so a live note held a different document from the one the batch pass read. An inserted text is now split where a document is (`splitInsertedLines`), and an `editLine` whose text holds a break replaces the line with the lines it holds, applied through the evaluator that owns the model (`setStructuralEditor`) so its graph and checkpoints follow the lines that moved.

| line | before | now |
| --- | --- | --- |
| `5 sprints in weeks` through `evaluateDocument`, after a note defining `1 sprint = 2 weeks` | 10 weeks | `Undefined variable: sprints. Did you mean pints?` |
| `x * 2` through `parseDocument`, after a note of `x = 5` | 10 | `Undefined variable: x` |
| `x * 2` above `x = 5`, parsed a second time on the same engine | 10 | `Undefined variable: x` |
| a five-line note through `evaluateDocument` with `maxDocumentLines: 3` | five answers | `This document has more than 3 lines, which is the most the engine will process in one pass` |
| `doc.editLine(1, "5\r6")` on `1`, `2`, `total above` | three lines, the first `5\r6` | four lines, `5`, `6`, `2` and `13` |
| an inserted `7\r8` in `applyTransaction` | one line | two lines, `7` and `8` |

The boundary. A single expression is not a document pass: `evaluateExpression("x * 2")` after a note of `x = 5` still reads `x`, which is how a host's scratch line reads the note it sits beside, and a name a host set outside a document (`:rate = 3` through `evaluateExpression`) survives every pass. A line feed and a carriage return are the line breaks, as they are everywhere else the engine reads a document; the Unicode line and paragraph separators are not, and stay inside the line.

## Verification

`FoundBug_reusedEngineStartsClean.spec.ts` (46 tests), `FoundBug_evaluateDocumentLineCeiling.spec.ts` (33) and `FoundBug_lineBreaksInsideAnEdit.spec.ts` (52) hold each reported case through `parseDocument`, `evaluateLines` and `evaluateDocument`, the unit tests of `beginDocument`, `assertDocumentSize`, `assertChangesFit`, `hasLineBreak`, `splitInsertedLines` and `setStructuralEditor` with ordinary, boundary and hostile arguments, and the adversarial cases from all three sides: prototype words as names, ten thousand definitions and a hundred thousand lines, a paste of two thousand lines, every text edge as an edit, notes switched back and forth, running totals, the numeric edges and the document edges. `npm run typecheck`, `npm run typecheck:tests`, `npm run lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, the proven docs examples, the hardening and integration suites and `npm run test:ci` passed.
