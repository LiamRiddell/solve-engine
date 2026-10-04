---
"solve-engine": minor
---

A live evaluator is retired with `dispose()`, which also detaches it from the engine, and a new guide, Driving a live editor, walks the incremental loop end to end

The incremental path a live editor needs (`DocumentModel`, `ThreeTierEvaluator`, `applyTransaction`, `setViewport`, `onLineResult`) was public and on no docs page, so a host following the docs ran `parseDocument` on every keystroke, and the call that retires an evaluator was named `terminateWorker`, which a host looking for `dispose()` does not find (#723). An evaluator never retired stays subscribed to the shared `global :name` store, and so reachable from it, for the life of the process. Writing the guide found a second gap: an evaluator wires its document onto the engine, and retiring it left the engine pointing at the closed document, so the engine went on answering the positional forms from it.

`ThreeTierEvaluator.dispose()` stops the background compilation worker, drops the global-store subscription, and clears the engine's document model and its batcher's checkpoint chain where they are still this evaluator's own. It is safe to call more than once. `terminateWorker()` keeps working exactly as it did, and `evaluateDocument` still calls it, since that helper puts back the document the engine had.

| line | before | now |
| --- | --- | --- |
| `typeof evaluator.dispose` | `undefined` | `function` |
| `engine.evaluateLine(1, "total of #food")` after retiring an evaluator over `10 #food` / `5 #food` | `= 15`, read from the closed document (`terminateWorker`) | `TAG_NO_DOCUMENT` (`dispose`) |
| `engine.evaluateLine(1, "solve line 2 for price = 150")` after retiring an evaluator over `:price = 100` / `price * 1.25` | `= 120` | `GOAL_SEEK_NO_DOCUMENT` |
| `engine.traceLine(2)` after retiring the evaluator | a trace of the closed document | `TRACE_NO_DOCUMENT` |

The guide, [Driving a live editor](/guide/live-editor/), sits in the Embedding group after the editor pages: the worked loop (build a model, wrap it in an evaluator, `applyTransaction` on each edit, `evaluate` or `setViewport` for the lines on screen, `dispose` at the end), what each tier runs and what is kept, what a viewport changes, and live data arriving through `onLineResult` or the event stream. Every value it prints is from a run. The core concepts page and the tracing guide link to it.

The boundary: `dispose` retires an evaluator, it does not make the engine safe to share. An evaluator wires its document onto its engine, so two open at once on one engine read each other's lines (the second document's line 1 answers the first document's `line 1 * 2`), and the guide says to give each open document its own engine. The guide also names a limit of the viewport: a dirty line above the viewport that defines no variable is compiled and not run, so a line on screen that reads it by position (`prev`, `line 1`, `total above`, a tag total) answers `Line 1 has not been evaluated yet` until a pass from line 1 runs it. Both are described as they behave today and are not changed here. `engine.openDocument`, a higher-level handle over these steps, is a later item.

## Verification

`Issue723_liveEditorAndDispose.spec.ts` holds 75 tests: `dispose` on its own (the global-store listener count before and after, a compilation worker stopped, twice in a row, before any pass, an engine a newer evaluator took over, an engine a host pointed elsewhere, the batcher's chain), `terminateWorker` unchanged, what a retired document no longer reaches (a line reference, a tag total, a goal seek and a trace refusing, a global write dirtying an open reader and not a retired one), the guide's loop run value for value including a stubbed live rate arriving through `onLineResult`, and the adversarial cases (prototype words as variables and lines with `Object.prototype` unchanged, three thousand lines, two hundred evaluators built and retired, the text edges, an edit that breaks and fixes a line, agreement with `parseDocument` after the guide's edits, a retired evaluator asked again, a snapshot after retiring, the document edges, a viewport past the end and one of no lines, CRLF, the largest double and negative zero).

The full suite (`npm run test:full`) passed, 22,632 of 22,636 tests in 691 suites with 4 skipped, as did `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet` and `lint:sidebar`. `npm run verify:ci` and the bundled-consumer contract were not run whole for this change; CI runs both.
