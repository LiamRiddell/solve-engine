---
"solve-engine": patch
---

Tags: a total reads its own members, not the whole document

`total of #tag` walked every line of the document asking each one whether it
carried the tag, so a document of D aggregates over N lines cost D x N per pass.
Both document paths now keep a tag to lines index and the aggregate reads it.
Measured through `parseDocument`, N lines of `<i> #a` followed by N lines of
`total of #a`:

| total lines | before  | now    |
| ---         | ---     | ---    |
| 2,000       | 1.97 s  | 0.04 s |
| 5,000       | 11.83 s | 0.25 s |
| 10,000      | 49.22 s | 0.87 s |
| 20,000      | 250 s   | 3.33 s |

An ordinary notepad, tagged amounts with a total every twenty lines, went from
2.55 s to 0.15 s at ten thousand lines through the batch pass, and from 3.28 s
to 0.73 s through the incremental one, which is the pass an editor pays per
keystroke.

The boundary: the shape above stays quadratic, because it is. Ten thousand
totals over ten thousand members is a hundred million additions however the
members are found. What is gone is the document walk on top of that, so with the
number of aggregates fixed a pass is linear in the document, and twenty thousand
untagged lines around a total now cost their parse and nothing more.

Category tags also register in the dependency graph now, as a key a member line
writes and an aggregate reads:

| an edit to      | before                  | now                             |
| ---             | ---                     | ---                             |
| a tagged line   | dirtied nothing by name | names the aggregates over its tag |

They were being registered and then wiped inside the same pass, because a line
registers from five places across the engine and the evaluator and the later
registration keeps only its own edges. All five route through one helper now.

Nothing a reader writes changes. A tag is still read case-insensitively, a
`#heading` is still not a member of its own name, and asking about a group still
does not join it.

## Verification

9,193 tests in 456 suites, including 25 new ones covering the index directly:
which lines a group holds, that the first unreadable member a total reports is
still the first one in the document, that an index maintained across edits and
one built fresh from the same text agree, and that the graph edges survive a
whole pass. `npm run verify:ci` and the bundled-consumer contract both pass.
