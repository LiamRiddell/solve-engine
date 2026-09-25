---
"solve-engine": patch
---

A form that reads a line below it gives the same answer on both document passes

A section total, a count or a line range can read lines below the line that asks. Each asks of every line whether it has a figure. The batch pass knew the answer for every line from its scan; the incremental pass knew it for a line only once it had evaluated that line, so a comment or a table row below the reader read as a figure still to come (#803).

| note | `parseDocument` | `evaluateDocument`, before | `evaluateDocument`, now |
| --- | --- | --- | --- |
| `count of section "Home"`, `# Home`, `// note 5` | 0 | Line 3 has not been evaluated yet | 0 |
| `total of section "Trip"`, `## Trip`, `// note 4` | The section "Trip" has no figures to add up. | Line 3 has not been evaluated yet | The section "Trip" has no figures to add up. |
| `sum(line 5 : line 4)` over a blank line and a table separator | Lines 5 to 4 hold no figures to add up | Line 5 has not been evaluated yet | Lines 5 to 4 hold no figures to add up |

A line the incremental pass has not reached is now read from its text, the way the batch pass reads it: a blank line, a heading, a comment, a quote, a fence or a table row has no figure. A live editor whose viewport stops above the comment gives the same answer. A figure below the reader is still a forward reference on both passes.

The cross-path fuzz generator found these on its first run.

## Verification

`Issue803_linesBelowTheReader.spec.ts` has 15 tests: unit tests for `hasNoFigure` over each line kind, a table row, a row holding an inline solve and past either end; a section below holding only a comment; a section below holding a comment and a figure, where the figure is still a forward reference; a range reaching down over a table; and a live editor that has not scrolled to the comment yet, which gives the batch answer. `CrossPathDocumentFeatures.spec.ts` gains the section count and the line range over lines below the reader, asserting both passes agree value for value.

The engine suite is 14,062 tests in 582 suites, all passing (four skipped), and `npm run verify:ci` passes on the branch rebased onto main after #808, including the docs proofs, the three-zone `test:temporal` run, `lint:dispatch-size` (47,481 bytes on Node 24, 13,959 under the ceiling) and the bundled-consumer contract.
