---
"solve-engine": patch
---

A value that lands after a fetch is re-run against the cache of the engine that asked for it

When a fetched value arrives, the engine re-runs the lines waiting on it and reports each new answer to `onLineResult` and the event stream. A package reads a fetched value back through one shared slot that the engine fills with its own cache when it runs a line, and the re-run left that slot as it was. An engine whose first line fetches had filled nothing, because a line waiting at preflight never runs, so its re-run found no cache. With a second engine in the same process, the re-run read the second engine's cache and reported that engine's figure as the answer. The re-run now fills the slot with its own engine's cache for as long as it runs, and puts back whatever was there before.

| case | before | now |
| --- | --- | --- |
| a new engine's first line, `crypto("BTC")`, re-run when a $60,000 price lands | `No cached result for "BTC"` | $60,000.00 |
| engine A's `crypto("BTC")` ($60,000 from A's provider), re-run after engine B has run a line ($99,000 from B's) | $99,000.00 | $60,000.00 |

The first answer the host saw was wrong only in the re-run's report: evaluating the line again read the right cache, which is why a host that re-evaluates the lines an event names already showed the right figure. A host that mirrors `onLineResult` into its own state, as the async guide describes, showed the error or the other engine's figure until the line was next evaluated. The slot itself is unchanged for anything outside a re-run: a plugin function called directly by a host still reads whichever cache the engine last published, as before.

Fixes #568.

## Verification

A new spec pins both cases with stub providers, a new engine whose first line fetches and two engines in one process, and that the slot reads as before once the re-run finishes; both cases fail without the fix. `npm run verify:ci` passes: TESTS tests across SUITES suites, with the bundled-consumer contract.
