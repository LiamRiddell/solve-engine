---
"solve-engine": patch
---

A one-character first line is its own line, a what-if reads `:name` as the input, and the ESM build loads where Node's globals do not exist

Three faults found by the survey before 2.40.0 and listed as known issues in its release notes.

**A one-character first line is its own line (#609).** The lexer's one-character fast path built its token from the whole input, and a document scan narrows only the line's end, so a first line of one character took the whole document as its text. The two document passes disagreed, and the bad program was reused for a later line on the same engine.

| document | before (parseDocument) | now (both passes) |
| --- | --- | --- |
| `e`, then `5` | error: Undefined variable: e, followed by the rest of the document | 2.72, then 5 |
| `e`, then `total above` | error: Line 1 has an error | 2.72, then 2.72 |
| `x`, then `5` | error: Undefined variable: x, followed by the rest of the document | error: Undefined variable: x, then 5 |

**A what-if, a sweep and a goal seek read `:name` as the input (#608).** A reader who defined `:price = 100` writes `line 2 with :price = 300`. The colon kept the what-if from being recognised, `with` stayed the English word for `+`, and the line added the assignment and overwrote the variable.

| line, after `:price = 100` and `:total = :price * 1.2` | before | now |
| --- | --- | --- |
| `line 2 with :price = 300` | 420, and `:price` became 300 | 360, and `:price` stays 100 |
| `line 2 for :price from 100 to 300 step 100` | error: Expected token type "AT" but got "FROM" | [120, 240, 360] |

**The ESM build loads where Node's globals do not exist (#610).** Value.ts read `process.env.NODE_ENV` at module scope, unguarded, so every entry point threw "process is not defined" on import in a browser tab or a module Web Worker loaded without a bundler. The read is now guarded, as the engine's other reads of `process` are. This was true of 2.39.0 too; a bundler that defines `process.env.NODE_ENV` was never affected.

A new check, `npm run smoke:globals`, imports every ESM entry point of the build twice, once as Node has it and once with `process`, `Buffer` and `global` removed, and fails if an entry loads only with them. It runs in `verify` and `verify:ci`, and was shown to fail on the unguarded read.

The what-if page carries a proven example of the colon form.

## Verification

New tests pin each shape of one-character first line through both passes, that a later line on the same engine is not poisoned, and that the answer does not depend on what the engine did before; the colon form of a what-if, a joined input, a sweep and a goal seek, each agreeing with its bare spelling through both passes; and that `with` still means `+` where no name and `=` follow. The full suite is 11,948 tests in 548 suites, all passing (four skipped), and `npm run verify:ci` passes, including `smoke:globals`, the three-zone `test:temporal` run and the bundled-consumer contract.
