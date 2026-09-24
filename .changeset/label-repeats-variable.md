---
"solve-engine": patch
---

A label that repeats the variable's name assigns rather than storing an equation

A line such as `rent: :rent = 1200` sets `rent` aside as a label and assigns the variable, as `Rent: :rent = 1200` and `monthly rent: :rent = 1200` already did. When the label was the same word as the variable, the left side held one unknown, and the scalar-equation reader claimed the line.

| document | before | now |
| --- | --- | --- |
| `rent: :rent = 1200`, `rent * 2` | rent stored as an equation, then undefined variable: rent | 1,200, then 2,400 |
| `2x + 1 = 7`, `x =>` | x stored as an equation, then 3 | x stored as an equation, then 3 |

The boundary: a colon on the left of `=` now always means a label or an assignment, never part of an equation, which is how every other reading of the line already treated it.

Fixes #561.

## Verification

The labelled-line spec pins the repeated name and a real equation beside it. `npm run verify:ci` passes: 10,723 tests across 518 suites, with the bundled-consumer contract.
