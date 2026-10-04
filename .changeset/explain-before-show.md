---
"solve-engine": patch
---

The syntax pages written before the two-reader rule now say what a form does before they show it

Nine pages showed a code block or a table straight after a heading or the Package callout, so a reader meeting the idea for the first time saw syntax before being told what it was for (#729). Each place now opens with a plain sentence or two: what a comparison and a boolean are, what a conditional expression picks, what an element-wise product and a transpose are, what the real and imaginary parts of a complex number are, what a number base prefix names, what a function definition is, what clamping and a proportion are, and what a flat and a solid shape measure.

| page | before | now |
| --- | --- | --- |
| `map-reduce-and-aggregates.md` | "The implicit variable is `x`." | map applies an expression to each element and returns the list; reduce folds it, and `acc` starts as the first element, so `reduce(acc - x, [10, 1, 2])` is 7 |
| `symbolic.md` | no callout | a "Built in" callout naming the packages its unit-named, function and matrix examples need |
| `statistics.md` | the page opened on a code block | the page opens on what an average and a median are |

The boundary: a prose pass over existing forms, so no example changes its answer and no page moves.

## Verification

`Issue729_explainBeforeShow.spec.ts` holds 217 tests. It reads every syntax page and fails on a heading or a callout whose next non-blank line opens a fence or a table, and on a closing fence with text after it; its two helpers have their own tests over ordinary, boundary and hostile pages (CRLF, an unclosed fence, a tilde fence, a heading named `__proto__`, a page of 200,000 lines within the budget). The claims the pass added, how `reduce` starts and that the arrow is built in, are held too. `DocExamples.spec.ts` proves every new example.

The full suite (`npm run test:full`) passed, 19,689 of 19,693 tests in 658 suites with 4 skipped, as did `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, `lint:keywords`, `lint:error-codes`, `lint:ci-parity`, `lint:stats`, `lint:size` and `lint:units`. `npm run verify:ci` and the bundled-consumer contract were not run whole for this change; CI runs both.
