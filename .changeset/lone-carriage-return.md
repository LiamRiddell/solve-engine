---
"solve-engine": patch
---

A lone carriage return ends a line through every entry point

`parseDocument` ends a line at a line feed, a CRLF pair or a lone carriage return, the three a markdown file can use, and the document model behind `evaluateDocument` and a live editor split on the line feed alone. A note with a lone `\r` in it, such as one written on an old Mac, had a different number of lines through each path, and every line after the first `\r` sat at a different position in each. The model now splits where the scan splits, and the size limit counts lines the same way, as #613 made the two paths agree on a trailing line break.

| document | before, `parseDocument` / `evaluateDocument` | now, both |
| --- | --- | --- |
| `5\r` | 2 lines / 1 line | 2 lines |
| `5\r6` | 5, 6 / a parse error on one line | 5, 6 |
| `1\r2\rtotal above` | 1, 2, 3 / a parse error | 1, 2, 3 |

A line's text in the model no longer carries its line break, a CRLF line's `\r` included, and `evaluateDocument` reads each break's length from the input, so every line reports the offsets `parseDocument` reports. The what-if forms' check for a line setting a global, and the scan for a `random seed` line, count lines the same way.

The boundary: a line's text handed to `editLine` or `applyTransaction` is one line by the host's own account, and a `\r` inside it is left as it is.

## Verification

`LoneCarriageReturnSplitsLines.spec.ts` holds 25 tests: `splitLines`, `lineBreakLengthAt` and `countLines` at their edges (every break, a break at each end, runs of breaks, a Unicode line separator, a million carriage returns counted with a ceiling), line counts and offsets through both passes for every `TEXT_EDGES` line and `DOCUMENT_EDGES` note, the size limit, prototype words and look-alike text between lone returns, a what-if's line number, a random seed line, and the cross-line forms across lone returns. `CrossPathDocumentFeatures.spec.ts` gains the same agreement for six documents. The fast suite (`npm run test:ci`, run with the worktree path let through its ignore list) passed, 18,328 of 18,332 tests in 651 suites with 4 skipped. `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar` and `lint:changeset` passed, as did the proven docs examples; the dispatch loop was measured by hand the way `lint:dispatch-size` measures it, at 46,042 bytecode bytes, since that script's jest run skips a worktree. `npm run verify` was not run.
