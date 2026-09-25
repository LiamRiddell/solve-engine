---
"solve-engine": patch
---

`total above` passes over a comment in its column instead of stopping at it

`total above` and `average above` add up the figures directly above them, and a blank line or a heading ends the column. They also stopped at every other line the classifier skips, so a comment in the middle of a column cut the total short (#652). A line range already passed over such a line.

| note | before | now |
| --- | --- | --- |
| `rent: $500`, `// remember to check`, `food: $200`, `total above` | $200.00 | $700.00 |
| the same with `average above` | $200.00 | $350.00 |
| `rent: $500`, `> quoted note`, `food: $200`, `total above` | $200.00 | $700.00 |

A comment, a blockquote and a wiki link have no figure and are passed over. A blank line, a heading, a horizontal rule, a code or math fence and a markdown table still end the block, and a pipe row that is not part of a table is an expression that counts (`10`, `5 | 3`, `20` totals 37). `inputs of line N` names the same lines the total read, and both document passes agree.

What stays: the section, tag and line-range forms read lines exactly as before, and a prose line that fails as an expression still fails the total that reads it.

The line-references page shows a comment inside a column.

## Verification

`Issue652_totalAbovePassesOverComments.spec.ts` has 21 tests: unit tests for `endsFigureBlock` over a blank line, headings, a rule, each fence, a comment, a quote, a wiki link and a figure, past either end of the document, and a pipe row inside and outside a table; and adversarial cases: a comment that holds a figure, a column of nothing but comments, a comment between a heading and the figures, a line starting with a tag, 10,000 comment lines inside a column, and a failed prose line, which still fails the total. `CrossPathDocumentFeatures.spec.ts` runs a column with a comment in it, and `inputs of line N` over it, through both document passes and asserts they agree, with a comment and a blank line typed into a live column; the single-expression refusal was already pinned in the same file.

The engine suite is 14,062 tests in 582 suites, all passing (four skipped), and `npm run verify:ci` passes on the branch rebased onto main after #808, including the docs proofs, the three-zone `test:temporal` run, `lint:dispatch-size` (47,481 bytes on Node 24, 13,959 under the ceiling) and the bundled-consumer contract.
