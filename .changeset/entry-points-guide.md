---
"solve-engine": patch
---

A new guide, Which entry point, sets the four ways to evaluate side by side: what each reads, what it resolves, and what an edit costs

A host can evaluate through one expression (`evaluateExpression`, `evaluateLine`), the batch pass (`parseDocument`), the incremental pass (`evaluateDocument`) or a live `ThreeTierEvaluator`, and they are not interchangeable, but the docs described one at a time and no page compared them (#724). A host that needed goal seek met the batch pass's refusal with nothing to say which call would solve it.

[Which entry point](/guide/entry-points/) has one table of the four (what each reads, whether line references, tags, table columns and what-if resolve, whether goal seek does, what a one-line edit runs, and when a host wants it), the single-expression refusals with their codes, the batch and incremental passes on one note, and the measured cost of an edit. The quick start, the embedding guide and the goal-seek page link to it.

| line, on `:price = 100` / `price * 1.25` / … | `parseDocument` | `evaluateDocument` | `evaluateLine` on its own |
| --- | --- | --- | --- |
| `solve line 2 for price = 150` | `GOAL_SEEK_NO_DOCUMENT` | `= 120` | `GOAL_SEEK_NO_DOCUMENT` |
| `line 2 with price = 10` | `= 12.50` | `= 12.50` | `WHAT_IF_NO_DOCUMENT` |
| `line 1 * 2` | `= 200` | `= 200` | `LINE_REF_NO_DOCUMENT` |

| after editing the last of 1,000 lines | lines run |
| --- | --- |
| `parseDocument`, on the engine that ran the first pass | 1,000 |
| `evaluateDocument` | 1,000 |
| `ThreeTierEvaluator`, lines 1 to 1,000 | 1,000 |
| `ThreeTierEvaluator`, the 20 lines on screen | 20 |

The boundary: a guide over shipped behaviour, with no engine change. It names one hazard as it is: an engine a live evaluator is attached to reads that evaluator's document, so its `evaluateLine` and `parseDocument` can answer from the evaluator's lines, and the guide says to keep a live evaluator's engine for that evaluator. `engine.openDocument` would add a row when it lands.

## Verification

`Issue724_entryPoints.spec.ts` holds 45 tests, one per claim on the page: the five single-expression refusals through `evaluateLine` and `evaluateExpression`, goal seek refused by the batch pass and solved by the incremental one, the what-if through both, the whole note through the three document paths, `evaluateDocument` putting back an engine's document, and the lines-run table counted with a plugin function over 1,000 lines. The adversarial cases are the prototype words through every entry point with `Object.prototype` unchanged, two thousand lines within budget, markup-shaped lines, a misspelt goal-seek variable refused on every path, a live evaluator agreeing with a fresh pass after an edit, a snapshot after either pass, the document edges through both passes, and goal seek towards zero, negative zero, 2^53, the largest double and an infinity.

The full suite (`npm run test:full`) passed, 22,632 of 22,636 tests in 691 suites with 4 skipped, as did `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet` and `lint:sidebar`. `npm run verify:ci` and the bundled-consumer contract were not run whole for this change; CI runs both.
