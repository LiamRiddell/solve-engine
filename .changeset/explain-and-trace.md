---
"solve-engine": minor
---

Conversions, function calls and finance phrases explain their steps, and a note can trace which lines fed a result

`explainLine` derived arithmetic, percentages and date readings from a fixed table of operators, and returned no steps at all for the three things a reader most often wants to check: a conversion, a function call and a finance phrase. Each of those is a call into a package, and only the package knows what happened between the numbers that went in and the one that came out. Packages now describe their own steps through a new `explain` field on `IEnginePackage`, and the unit, function and finance packages do.

| line | before | now |
| --- | --- | --- |
| `5 km in miles` | no steps | `1 km is 0.621371 miles`, `5 times 0.621371` = 3.11 miles |
| `sqrt(16) + 2` | no steps | `the square root of 16` = 4, `4 plus 2` = 6 |
| `present value of $1,000 after 5 years at 5%` | no steps | `5% a year for 5 years: (1 plus 5%) to the power of 5 is 1.27628`, `$1,000.00 divided by 1.27628` = $783.53 |
| `-(2 + 3)` | `2 plus 3` = 5, a last step that disagreed with the answer | `2 plus 3` = 5, `the negative of 5` = -5 |

Every number a step shows is the engine's own. A conversion factor is what the engine's conversion gives for one unit, and the finance steps compute through a new shared module, `vm/FinanceFormulas.ts`, that the finance builtins now use too, so the growth factor a step shows is the one the answer was divided by. The hook is handed each call the line made, with the arguments and result the engine used, and returns the steps between them; its last step must carry the call's own result, or the answer is discarded. A plugin function or an `as` converter is offered only to the package that registered it, and a builtin or a conversion to every package, the most recently registered first. The VM reports calls only on the run `explainLine` makes, through `LineExecutionContext.observeCall`, so ordinary evaluation never calls a hook.

The second half is where a number came from across lines. `engine.traceLine(n)` returns line n's answer and the lines it read, each followed upwards in the same shape, reading a variable to its nearest definition above, a position (`line 2`, `prev`, `total above`, a range) and a category tag. A reader asks the same question in the note:

| document | line 5 |
| --- | --- |
| `:rate = 4%`, `:deposit = 100000`, blank, `:payment = monthly repayment on deposit over 25 years at rate`, `inputs of line 4` | payment 527.84 (line 4) <- deposit 100,000 (line 2), rate 4.00% (line 1) |

The trace is built from each line's text and answer rather than from the dependency graph, which records positional reads only on the incremental path, so `parseDocument` and `evaluateDocument` give the same trace value for value. Two lines that read each other come back marked as a cycle rather than looping, and a line reading one below it is marked as a forward reference; `inputs of line N` turns both into named errors, `TRACE_CYCLE` and `TRACE_FORWARD_REFERENCE`, and refuses through the single-expression entry point, which has no document. The trace stops ten levels down and after two hundred lines, marking where it stopped.

The boundary: a hook describes calls, never the arithmetic between them, and a derivation is never partial, so a line with an undescribed call, or whose calls leave an operation out (`round(5 km in miles + 1 mile, 1)`), gets no steps rather than some. Steps are English prose in the engine's default number style. Date arithmetic, matrices and symbolic algebra still report their answer without a breakdown. A table column is read from the table's text, so it lists no inputs in a trace. `inputs of line N` shares the `lineRef` plugin slot rather than registering a function of its own, because a new plugin function ahead of the random package would renumber the seeded draws.

## Verification

Two new suites pin the three probes, every finance form, the hook contract (owner-only plugin calls, the discarded answer, a throwing hook, the latest registration first, a converter, a `defineFunction` package), the no-partial rule, that no hook runs during ordinary evaluation, and the trace's reads, cycles, forward references, bounds and refusals through a parsed result and an attached document model. The cross-path suite gains `inputs of line N` through all three entry points. A new syntax page, a host guide and a package-author guide are added, with the explaining guide and the authoring routing table updated. `npm run verify` passes: 11,243 tests across 531 suites, with the bundled-consumer contract.
