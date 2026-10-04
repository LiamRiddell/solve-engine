---
"solve-engine": patch
---

A running total, a section total and a tag total hold one dependency entry each, not one per line they read

A live editor records which lines read which, so that an edit or a live value reaches every line that depends on it. An aggregate that reads a span (`total above`, `total of section "Costs"`, `total of #food`) recorded one entry for every line in the span, as a key in three indexes, so a ledger with a running total after each entry held the square of its length: 3,000 lines of `total above` under a `1` kept over 500 MB through `evaluateDocument`, and 6,000 ran a 2 GB heap out, while `parseDocument`, which keeps no such record, held a few megabytes (#733).

A span is now one entry in the reader's own record, and "which lines read line 7" is answered by an interval index over those entries, rebuilt only when one of them changed. A tag total takes one entry on its tag, followed back through the tags each line carries when it is asked; a section total takes one span of figures, which passes over the totals inside the section, so two totals of one section are not taken to read each other. A read the form has already declared that way records nothing more. A package's handler can do the same through two additions to the line context: `noteFigureSpanRead(first, last)`, and a second argument to `getLineResult` saying the read is covered.

Heap kept after one `evaluateDocument` pass, with the engine still held and after two forced collections:

| document | before | now |
| --- | --- | --- |
| `1`, then 3,000 lines of `total above` | 534.1 MB | 8.3 MB |
| ledger of 2,000 lines, `total above` after each entry | 112.5 MB | 5.5 MB |
| ledger of 2,000 lines, a section total after each entry | 115.5 MB | 5.7 MB |
| ledger of 2,000 lines, a tag total after each entry | 116.0 MB | 6.3 MB |
| ledger of 4,000 lines, `total above` after each entry | 446.9 MB | 9.0 MB |
| ledger of 4,000 lines, a section total after each entry | 456.9 MB | 9.4 MB |
| ledger of 4,000 lines, a tag total after each entry | 457.8 MB | 10.5 MB |
| `1`, then 6,000 lines of `total above`, 2 GB heap | out of memory | 13.2 MB |

Measured on a shared Linux container (4 cores, Node 22.22.2), with the engine's source bundled by esbuild. The pass is faster too, since the keys it no longer builds were much of its work on these shapes: the 3,000-line document took 8,916 ms before and 3,656 ms now, and the 4,000-line tag ledger 6,297 ms and 849 ms. `parseDocument` holds 6.3 MB on the first document, before and after. The answers do not change: every ledger ends where the batch pass ends it, and the two passes agree line for line.

The boundary: the time a long span costs a pass is the per-pass work budget's (#711), not this change's; 6,000 lines of `total above` are now refused by that budget, by name, through both passes, rather than running out of memory. The getters that name a positional edge (`getReads`, `getConsumers("line:7")`, the diagnostic snapshot) still answer in `line:` keys, made from the entries when asked; the snapshot spells every one of them out, so a host should not build one per keystroke, and the language service and `toJSON` no longer do.

## Verification

`Issue733_spanDependencyIndex.spec.ts` holds 43 tests: the interval index at its edges (overlapping spans, sparse positions, a reader never its own reader, rebuilt after a change), tag edges and spans of figures on their own, a 600-step random run checked against a scan of every reader, the ledgers through both passes, a pin that the graph grows linearly (400 against 800 lines), and the adversarial cases (a span cut short by a heading, a heading inserted into a section, a tag removed from a member, positional cycles through a tag total and a section total closed and reopened, prototype words as tags, look-alike text inside a span, 3,000 running totals, CRLF). The full suite (`npm run test:full`) passed, 20,630 of 20,634 tests in 676 suites with 4 skipped, as did `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, `lint:changeset` and `lint:dispatch-size` (`executeBytecode` at 46,034 bytecode bytes). `npm run verify:ci` and the bundled-consumer contract were not run whole for this change; CI runs both.
