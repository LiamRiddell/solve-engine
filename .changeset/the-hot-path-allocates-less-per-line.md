---
"solve-engine": patch
---

The evaluation pipeline allocates less per line

A CPU profile of the pipeline end to end, over six thousand distinct
expressions and a four-hundred-line document, showed two pieces of per-line work
that the common case does not need, each running on every expression and every
document line the engine evaluates.

The tag scanner ran two regular expressions and allocated two arrays for every
line, to find the `#food` category tags on it. A line with no `#` on it carries
no tag, and most lines are that, so it now takes a single `indexOf` and returns
before the regexes: the same empty result the scan produced, without the scan.
The front half of an evaluation copied the token array to drop comment tokens,
on every call, though the lexer has already dropped them by the time the tokens
arrive; the copy is now taken only when a comment token is actually present,
which no current caller produces. Neither changes what the engine computes: a
line that does carry a tag takes the same scan it always did, and a token stream
that does carry a comment is filtered exactly as before.

Measured by running the old and new builds alternately in one process, sixty-one
rounds of the mixed workload above:

| build | median | fastest |
| ---   | ---    | ---     |
| before | 146.4 ms | 139.0 ms |
| now    | 141.0 ms | 134.8 ms |

About two to three per cent, and never slower across runs. The boundary is what
that number is: this removes allocation, not algorithm, so it lightens the
garbage the pipeline makes rather than the lexing, normalising, parsing and
executing that dominate it. The largest remaining cost the profile found, the
normaliser trying its rules at each token position, is a structural change and
is not this one.

## Verification

Four new tests in `TagScanner` pin that the `indexOf` exit returns what the full
scan returns, for a line with no tag, a member tag, an aggregate query and a
line's own leading tag; the comment path is already covered by
`lexer/Comments` and `Issue180`. The engine suite is 470 suites, 9,048 tests
passing and 4 skipped under `npx jest`. The differential fuzz of editing
sessions, expressions and bytecode (`npm run fuzz`) reports 0 disagreements, so
neither change moves a single answer on any of the three entry points.
