---
"solve-engine": patch
---

`engine.clear()` now cancels a live fetch still in flight, so it leaves no ten-minute timer behind and a failed fetch is not retried

`clear()` empties the query cache so that no collection timer (ten minutes, one per fetched value) keeps a Node process alive. A fetch still in flight at that moment escaped it: when it settled, the query armed its timer again on a query no cache held any more, and a failing one first retried, up to three times. A host that clears at a deadline, as the `solve` command does when live data has not arrived and the MCP server does after every call, was left holding a ten-minute timer for each such fetch, which in a long-lived server is a cleared engine's query kept alive per call (#774).

`clear()` now cancels each query's fetch, so no retry follows, and sets its collection time to zero, so whatever it arms when it settles fires at once.

| line | before | now |
| --- | --- | --- |
| a lookup whose fetch times out 40 ms after `clear()`, then 120 ms later | one more active timer than before the lookup, for ten minutes | none |
| a lookup whose fetch fails 20 ms after `clear()`, counted 1.5 s later | fetched again by the retry | fetched once |
| a lookup that answers after `clear()`, then `2 + 2` | `= 4`, and a timer left armed | `= 4`, and no timer |

The boundary: a fetch the engine did not start (a host's own query on the client) is cancelled with the rest, since `clear()` already emptied the whole cache; the settle and pending contracts are unchanged, and a fetch that lands after `clear()` is still dropped as before.

## Verification

The four cases are in `Issue774_mcpServer.spec.ts`, under "engine.clear() with a fetch still in flight"; with the change taken out, the timeout and retry cases fail.

The fast suite ran across 706 suites (23,268 of 23,272 tests passed, 4 skipped). `npm run build` (now the engine, the command and the server), `smoke`, `smoke:bundled`, `smoke:globals`, `smoke:cli` and `smoke:mcp` passed, as did `npm run typecheck` (all three packages), `typecheck:tests` (at its baseline of 94 errors in 30 files, none new), `lint`, `lint:comments`, `lint:messages`, `lint:docs`, `lint:error-codes`, `lint:cheatsheet`, `lint:sidebar`, `lint:ci-parity`, `lint:jest-configs`, `lint:licenses`, `audit:deps` and the proven docs examples. `npm run verify` as one command and the bundled-consumer contract (`npm run test:consumer`) were not run.
