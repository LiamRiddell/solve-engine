---
"solve-engine": patch
---

`total above` leaves a subtotal out, and a reference to a failed line says it failed in both document passes

`total above`, `sum above` and `average above` read every line up to the block's boundary, a subtotal included, so a running total counted the figures under it twice. They now leave out a line that is itself a total, by the same test the section totals from #508 use, so the two forms agree about one note.

| document | before | now |
| --- | --- | --- |
| `10`, `total above`, `5`, `total above` | 25 | 15 |
| `10`, `5`, `Subtotal: total above`, `average above` | 10 | 7.50 |
| `10`, `20`, `30`, `sum above`, `average above` | 30 | 20 |

A reference to a line that ran and failed, a line of prose say, was worded differently by the two document passes. `parseDocument` said the line had not been evaluated yet, as if it were a forward reference, and `evaluateDocument` said it had an error. Both now say it has an error, which is what happened.

| document | pass | before | now |
| --- | --- | --- | --- |
| `this is prose`, `line 1 + 1` | `parseDocument` | Line 1 has not been evaluated yet (forward reference, or out of range) | Line 1 has an error |
| `this is prose`, `line 1 + 1` | `evaluateDocument` | Line 1 has an error | Line 1 has an error |

The boundary: a total is recognised from its text, with any label before a colon set aside, so a line that happens to compute a total some other way, `10 + 5` under a column of 10 and 5, is still a figure. A reference to a line below, or to a blank line, is still reported as not evaluated yet, since nothing has run there.

Fixes #551 and #552.

## Verification

The cross-path spec gains both cases, each run through `parseDocument` and `evaluateDocument` and required to agree. The line references page gains the subtotal as a proven example, and an existing test whose comment already asked for the average over the figures alone (60/3), while its assertion pinned 120/4, now asserts what its comment says. The operators page also gains a sentence on `-2^2`, which is 4 here as in a spreadsheet, and the brackets that make it -4. `npm run verify:ci` passes: 10,713 tests across 517 suites, with the bundled-consumer contract.
