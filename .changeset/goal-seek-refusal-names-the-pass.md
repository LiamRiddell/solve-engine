---
"solve-engine": patch
---

The goal-seek refusal says which pass gave it

`parseDocument` refused goal seek with the single-expression entry point's sentence, "The single-expression entry point has no document to solve against", which is wrong for a caller that passed a whole document (#617). The batch pass has a document; what it cannot do is re-run a line. The refusal now says so, and names the passes that can. The code, `GOAL_SEEK_NO_DOCUMENT`, is unchanged.

| entry point | before | now |
| --- | --- | --- |
| `parseDocument` | Goal seek only works inside a document, since it re-runs another line. The single-expression entry point has no document to solve against. | Goal seek re-runs another line, which the batch pass (parseDocument) cannot do: it evaluates each line once. evaluateDocument and a live editor can solve it. |
| `evaluateLine` | the same sentence | unchanged |
| `evaluateDocument` | solves it | solves it |

The goal-seek page now names the entry points that solve goal seek and the two that refuse it.

## Verification

A new spec pins each entry point's answer, and the goal-seek and cross-path suites pass unchanged, since they assert the code and that the batch refusal mentions a document. The full suite is 13,793 tests in 565 suites, all passing (four skipped), and `npm run verify:ci` passes, now including `lint:ci-parity` and `lint:dispatch-size` (47,474 bytes on Node 24, 13,966 under the ceiling), the three-zone `test:temporal` run and the bundled-consumer contract.
