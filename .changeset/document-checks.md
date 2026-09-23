---
"solve-engine": minor
---

A `check` line asserts something a note must keep true, and fails loudly when an edit breaks it

A note can now state what must hold: a budget that covers the spending, two totals that agree, a formula close to a known value. `check` and a comparison shows a tick while it holds and becomes an error naming both sides the moment an edit breaks it. `≈` (or `~=`) and `within` allow a margin, as a percentage of the right-hand side or an amount in the same unit. A host gets a pass and fail count on the parse result.

| expression | before | now |
| --- | --- | --- |
| `check 1 + 1 == 2` | error: Unexpected token after expression | ✓ |
| `check :spent <= :budget` (spent $2,010, budget $1,950) | error: Unexpected token after expression | error: check failed: $2,010.00 is more than $1,950.00 |
| `check 22/7 ≈ pi within 0.1%` | error: Unexpected token | ✓ (differs by 0.04%) |
| `check 22/7 ≈ pi within 0.01%` | error: Unexpected token | error: check failed: 3.14286 differs from 3.14159 by 0.04%, more than 0.01% |
| `check 5 m ≈ 5.01 m within 1 cm` | error: Unexpected token | ✓ (differs by 0.01 m) |

The two sides are compiled separately, so a failure can name them, and compared in a shared unit the way the engine's own comparisons reconcile units, so `check 1 km == 1000 m` passes. Equality allows a conversion's rounding, so `check 0.1 + 0.2 == 0.3` passes; `≈` without `within` allows rounding noise. An approximate failure shows its two sides to six significant figures, since the usual two places would round the difference away. A `total above` beneath a check steps over it, passed or failed, so an assertion does not break the column it guards. `parseDocument` and `evaluateDocument` report `checks: { passed, failed }`, present only when the document has any, and the worker's result DTO carries it too.

The boundary: `check` is a check only at the start of a line that compares two things, so a variable called `check` (a restaurant bill) keeps working, and `within` and `≈` become single tokens. Two things with no common measure, a length and a mass, are refused as incomparable (`CHECK_INCOMPARABLE`) rather than reported as a failed check, and text compares with `==` and `!=` only. A check does not stop the lines around it evaluating; it is a signal, not a guard.

## Verification

A new suite pins passing checks, every failure message, approximate checks by percentage and by amount, the refusals, `check` as a variable, a total beneath a check, and the host count from `parseDocument` and `evaluateDocument` alike. The conditionals page gains a Checks section with proven examples, and the TypeScript guide shows the count. `npm run verify:ci` passes: TESTS tests across SUITES suites.
