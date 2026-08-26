---
"solve-engine": minor
---

Add `evaluateDocument`, a whole-document entry point that resolves goal seek.

The engine already had two ways to read a document, and they were not
interchangeable. `parseDocument` is the batch pass: it reads earlier lines'
results and skips markdown, which is everything line references, category tags
and table columns need. What it cannot do is re-run an earlier line with a
variable bound to a trial value, which is exactly what goal seek is, so
`solve line N for x = target` came back as an error there.

`evaluateDocument(engine, text)`, on the `solve-engine/engine` subpath, runs the
incremental engine for one pass and returns the same `ParsingResult` shape
`parseDocument` does, with the re-run primitive wired in:

```
:deposit = 100000
:rate = 4%
monthly repayment on deposit over 25 years at rate
solve line 3 for deposit = 900
```

| entry point | line 4 (`solve line 3 for deposit = 900`) |
| --- | --- |
| `parseDocument` | error: goal seek has no document to solve against |
| `evaluateDocument` | `170,507.23` |

On every form both passes support (line references, category tags, table
columns) they agree value for value; goal seek is the one `evaluateDocument`
adds. It restores the engine's document model before returning, so a caller can
borrow an engine for a single pass and leave it as it was.

The boundary, deliberate: `evaluateDocument` does not skip a markdown table's own
rows, where `parseDocument` does, so a document that mixes a raw table with goal
seek reads the table through `parseDocument` and the goal seek through
`evaluateDocument`. It also builds a fresh model per call, which suits occasional
evaluation (a documentation notepad, a test) rather than the keystroke loop a
live editor runs against one long-lived evaluator.

With this in place, the documentation's whole-document examples, line
references, category tags, table columns and goal seek, are now live, editable
notepads whose results the build proves, rather than static listings.

## Verification

`npm run verify` (typecheck, the test suite, build, and the single-file and
bundled smoke consumers): 7,835 tests across 346 suites pass. The documentation
example suite now evaluates every whole-document block the same way a notepad
renders it and asserts each documented result, and a new cross-path suite pins
each whole-document form through all three entry points at once: the single-line
path must refuse with a structured error, and the two document passes must agree.
