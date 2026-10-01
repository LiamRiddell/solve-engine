---
"solve-engine": patch
---

A variable whose live value is still arriving is read as pending, not as undefined

`:x = stock(AAPL)` answers pending on its first run, while the fetch it starts is out, and the lines that read `x` answered "Undefined variable: x" until the price arrived. The line that starts a fetch answers pending without the VM running it, so its assignment never ran and the name was never set; the engine now holds the pending value under each name that line would have stored (`namesStoredBy`), so a line reading it waits too and answers when the value lands. A bare assignment (`x = stock(AAPL)`, no colon) went through the symbolic grammar, which evaluates the right-hand side without the resolver preflight, so its fetch never started at all; when the right-hand side answers that it read a live value before its fetch (`readBeforeItsFetch`), the line is restated as its colon form for the ordinary path (`asColonAssignment`). This was found by an earlier adversarial batch.

| line | before | now |
| --- | --- | --- |
| `:x = <a live lookup>`, then `check x > 1` | Undefined variable: x | pending, then ✓ once the value lands |
| `:x = <a live lookup>`, then `x * 2` | Undefined variable: x | pending, then 42 once 21 lands |
| `x = <a live lookup>`, then `x * 2` | No cached result, on both lines | pending, then 10 once 5 lands |

The boundary: only a value on its way is waited for. A name the note never defines is still undefined, and a fetch that fails answers its error. A bare assignment whose right-hand side only might fetch (a constant such as `planck`, a conversion `in UTC-5`) is stored as before, and survives a snapshot as before. A hand-written resolver whose plugin answers an empty cache with a code of its own keeps that answer for a bare assignment; the colon form preflights whatever the resolver. `solve --json` over a document that reads a never-arriving value now reports that line as `pending` rather than `not-read`, and `solve check` counts it as still waiting for live data.

## Verification

`FoundBug_pendingVariableReads.spec.ts` (22 tests) holds the lines above through both document passes and after the value lands, unit tests of `namesStoredBy`, `asColonAssignment` and `readBeforeItsFetch` with ordinary, boundary and hostile arguments, and the three adversarial sides: prototype words as the pending name, a thousand lines reading one pending name within budget, a typo beside a pending name, a plain value assigned after it, a constant's snapshot round trip, and CRLF. `Issue774_solveCli.spec.ts` is updated for the `pending` status.

Gates run: `npm run typecheck`, `typecheck:tests` (at the baseline, which fell by two), `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, `lint:units` and `lint:links` passed; the docs, hardening and integration suites passed (9,242 tests in 98 suites); the fast suite ran 25,718 tests in 764 suites, all passing but 4 skipped once one merged spec that used `0/0` as a NaN was moved to `1/0 - 1/0`. `executeBytecode` stays under its size margin. `npm run verify` and the bundled-consumer contract were not run.
