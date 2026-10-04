---
"solve-engine": minor
---

`await engine.settle()` waits for the live values an evaluation started, and the testing kit gains `toResolveTo`, `settled()` and `expectDocument`, so a package author can assert what a live value resolves to

A value from live data is Pending the first time its line runs: the engine starts the fetch and answers "not yet" rather than a stale or zero figure. The only route to the settled answer was the event stream: read it, wait for a `lines-updated` event, and evaluate the lines it names again by hand. There was no call meaning "wait for the answer", and the testing kit could assert that a value was Pending but not what it resolved to, with no document-level assertion at all (#720).

`engine.settle({ timeoutMs })` resolves once no fetch the engine started is still in flight and the lines those fetches fed have been evaluated again, so the next evaluation gives the settled value, and resolves at once when nothing is in flight. At the deadline (10,000 ms unless given) it rejects with the coded error `SETTLE_TIMEOUT`, whose context names how many values were still in flight, so a caller is never handed a Pending line as if it were settled; a `timeoutMs` that is not a finite number of zero or more is refused with `SETTLE_TIMEOUT_INVALID`. `clear()` releases a waiting `settle()`, and a fetch that lands after a `clear()` is now dropped, where it used to reach the batcher and could re-run a line of the next document.

In `solve-engine/testing`, `await expectExpression(engine, line).toResolveTo(value, unit?)` waits for the value to settle, evaluating again after each fetch lands within one deadline (5,000 ms unless given), and then compares; `settled()` does the wait alone, so `toFailWith` can read a failed fetch's code. `await expectDocument(engine, text)` evaluates a whole document through the incremental pass (line references, tags, table columns and goal seek resolve), settles its live values, and answers `line(n)` with the same matchers.

| line | before | now |
| --- | --- | --- |
| `typeof engine.settle` | `undefined` | `function` |
| a probe resolving `lookup abcde` after 20 ms: evaluate, `await engine.settle()`, evaluate | no call to wait on; `= 43` only after reading the event stream by hand | `= 43` |
| `await engine.settle({ timeoutMs: 40 })` with two fetches that never answer | none | rejects `SETTLE_TIMEOUT`: `2 live values were still being fetched after 40 ms` |
| `engine.settle({ timeoutMs: -1 })` | none | rejects `SETTLE_TIMEOUT_INVALID` |
| `await expectExpression(engine, 'tide("Dover")').toResolveTo(4.2, "m")` | no such matcher | passes once the stub answers |
| `(await expectDocument(engine, ":price = 4\n:qty = 3\nprice * qty\nline 3 + 1")).line(4).toEqual(13)` | no document assertion | passes |

The boundary: `settle` waits for fetches already started and starts none. It does not wait for a background refresh or its cadence, which by design never finishes, and it never evaluates, so a line whose first fetch reveals a second needs another evaluation (the kit's `toResolveTo` loops for that, within its deadline). The worker client gains the same call under the worker parity change. Each round of the wait yields a macrotask, so a resolver that is never ready cannot starve timers, the shape #389 fixed; a resolver that starts a new query on every run keeps the wait going only until its deadline.

The pending contract and the event stream are unchanged: a first evaluation is still Pending, and the stream's backpressure is as it was. The async guide gains "Waiting for every value to settle", the testing guide gains "Live values" and "Whole documents" (their code is compiled and run by the package-guide proof), and the async data source guide says how to test a data source.

## Verification

`Issue720_settle.spec.ts` holds 53 tests: `settle` on its own (the issue's probe, nothing in flight, a timeout of zero, a resolver that never answers meeting its deadline with the count in the error's context, one that rejects, two lines sharing one query key making one fetch, `clear()` releasing a waiting `settle`, each invalid `timeoutMs`), the kit's `settled`, `toResolveTo` and `expectDocument` (units, a value never pending, a drifted value, a line revealing a second fetch, goal seek through a document, a failed line's code, a line still pending at the deadline, every out-of-range line number), and the adversarial cases (a fetch landing after `clear()` not re-running the next document, a resolver starting a new query on every run, a never-ready resolver with timers still running, prototype words as query keys with `Object.prototype` unchanged, a thousand lines in flight, the text edges, a what-if through a settled document, the batch pass agreeing with the incremental one, an engine with the network off, two settles at once, an empty document, CRLF and a trailing newline, an empty query, a timeout past a timer's 32-bit range). That last case found that a `timeoutMs` past 2^31 - 1 ms made the wait's timer fire at once; the wait now caps each round there.

The full suite (`npm run test:full`) ran 24,746 tests in 719 suites: 24,741 passed and 4 were skipped. The one failure was the public-surface check (#761) finding `getCallWords` neither documented nor marked internal; it is now marked `@internal`, and that spec passes on a rerun. `npm run test:temporal` in all three zones, `npm run typecheck`, `typecheck:tests` (no new errors), `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, `lint:keywords` and `lint:dispatch-size` (`executeBytecode` at 46,484 bytecode bytes) passed. `npm run verify:ci` and the bundled-consumer contract (`npm run test:consumer`, which builds the starter against the packed tarball) were not run whole for this change; CI runs both.
