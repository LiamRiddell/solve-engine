---
"solve-engine": minor
---

One pass over a note has a work budget: sweeps, what-ifs, goal seek and span totals share a million line runs, set by `vm.maxLineRunsPerPass`

Every limit counted work inside one expression, and the forms that reach across lines were capped one line at a time: a sweep at 100,000 line re-runs, goal seek at its probes, and a span aggregate (`total above`, a section, a tag, a table column) not at all (#711). Twenty sweep lines, each inside its own cap, made one `parseDocument` re-run 2,000,000 lines, and a host re-parses on every keystroke.

One count per pass now bounds them, in line runs. A what-if or sweep charges each line it re-runs, a goal-seek probe one, and a span aggregate its reads at sixteen to a run, the ratio measured between a re-run (about 5.2 µs) and a read (about 0.3 µs). The line whose work would cross the budget is refused with `PASS_WORK_BUDGET_EXCEEDED`, naming the budget and the setting, and the lines above it keep their answers.

| note, with `vm.maxLineRunsPerPass` at 500 | before | now |
| --- | --- | --- |
| five lines, then eight sweeps of line 5 over twenty values (100 line runs each) | all eight sweeps run | the first five run; the sixth, seventh and eighth are refused |
| the same note with the default budget | all eight run | all eight run |
| 100 lines, then one sweep of line 100 over 1,000 values, with the default | runs, 100,000 line runs | runs, as before |

The default is a million line runs, about five seconds of work on the machine it was measured on: ten sweeps at their own cap, or a ledger with a running total after each of about 4,000 entries. Both document passes charge alike and refuse the same line. A line in view re-runs from its program on every pass, so it is charged against the work above it as that work stands, and the incremental evaluator counts a line it does not run (out of view) at the work it recorded when it last ran. So a live editor gives the answer a fresh pass gives, after an edit above and in a viewport scrolled below the sweeps.

The boundary: this bounds time, not memory, and it does not make a span aggregate faster; it stops an extreme note from holding the host. The per-line caps stay as they were. Goal seek's probes are charged on the incremental path only, the one that runs them. A tag total is charged as a scan of the whole note on both passes, which is what the batch pass does and what the incremental index saves, so the two agree. The live-data re-run after a value lands carries no cross-line forms, so it spends nothing. A package whose handler re-runs lines charges them through `context.spendWork`, which the functions-and-operators guide describes; the security page's limits table and the what-if page state the budget.

## Verification

`Issue711_passWorkBudget.spec.ts` holds nineteen tests. The line that crosses the budget is refused and the lines above keep their answers, with the refusal naming the budget and the setting; the default runs a sweep at its own cap untouched. A what-if, a sweep, `total above`, a section total, a tag total, a table column and goal seek's probes are each charged. The incremental path agrees with a fresh pass after an edit that frees budget above, after one that spends more, after a heavy line is deleted and re-typed twenty times, in a viewport below the sweeps, and for a sweep definition above the viewport that runs out of view after an edit, which is charged once (counting its old record on top once refused the line in view). The single-expression path charges nothing. `CrossPathDocumentFeatures.spec.ts` holds the cross-path case: both document passes refuse the same line, and the single-expression path has no document to spend on.

The full suite (`npm run test:full`) passed, 15,581 of 15,585 tests in 613 suites with 4 skipped, and `npm run verify:ci` passed end to end, including the three-zone temporal run (2,869 tests in 90 suites each) and the bundled-consumer contract (25 checks against an installed copy, including 1,363 documented examples). `executeBytecode` is unchanged at 47,528 bytecode bytes on Node 24.16.0.
