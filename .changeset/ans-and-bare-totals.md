---
"solve-engine": minor
---

`ans` is the line above, and a bare `sum` or `total` says to write `total above`

Numi, Numbr, NumPad and SpeedCrunch users write `ans` for the previous answer and a bare `sum` or `total` under a column. The engine spells those `prev` and `total above`, and answered both habits with an undefined variable that gave no hint (#668).

| note | before | now |
| --- | --- | --- |
| `10`, `ans * 2` | Undefined variable: ans | 20 |
| `ans = 5`, `ans * 2` | 10 | 10 |
| `10`, `20`, `sum` | Undefined variable: sum | Undefined variable: sum. To add up the lines above, write "total above". |
| `ans * 2` through `evaluateExpression` | throws Undefined variable: ans | the error value `prev` gives outside a document |

`ans` means the line above only when nothing in the note is named `ans`: a note that defines it gets its variable, as before. Where `prev` has nothing to read (the first line, after a blank line or a heading, after a line that failed) `ans` gives the same answer `prev` does, and it takes the same dependency on the line above, so an edit to that line reaches it in a live editor. Both document passes agree.

What this does not do: a bare `sum` or `total` does not become a total. A note full of prose must never start producing numbers from a word, so reading the bare word as the column is its own, larger feature. `Ans` and `ANS` are ordinary names, as other variables are.

The line-references page lists `ans` and says what a bare `sum` does.

## Verification

`Issue668_ansAndBareTotals.spec.ts` has 16 tests: `ans` reading the line above, a variable named `ans` winning, an edit above reaching it in a live editor, and the single-expression refusal; adversarial cases where `prev` has nothing to read, an `ans` defined below its first use, and `Ans` and `ANS` as ordinary names; and a bare `sum` or `total` in four spellings, a defined one, and a near miss that keeps its own suggestion. `CrossPathDocumentFeatures.spec.ts` runs `ans`, a defined `ans` and the places `prev` has nothing to read through `parseDocument` and `evaluateDocument` and asserts they agree; the single-expression refusal is pinned in the issue spec.

The engine suite is 14,209 tests in 588 suites, all passing (four skipped), and `npm run verify:ci` passes on the branch, including the docs proofs, the three-zone `test:temporal` run, `lint:dispatch-size` (47,331 bytes on Node 24, 14,109 under the ceiling) and the bundled-consumer contract.
