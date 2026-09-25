---
"solve-engine": minor
---

A live-data resolver runs at most six fetches at once, and `createQueryResolver` takes `maxConcurrent`

`createQueryResolver`, which the weather, stocks, crypto and knowledge packages are built on, started each fetch the moment a line asked for it (#696). A pasted or hostile document of 500 places opened 500 connections to one weather service at once, then 500 more, all from the reader's own address.

| 500 lines `weather in Town0` to `weather in Town499`, `fetch` stubbed | before | now |
| --- | --- | --- |
| geocoding requests in flight at once | 500 | 6 |
| forecast requests in flight at once | 500 | 6 |
| requests in all | 1,000 | 1,000 |

A resolver now runs at most six fetches together and queues the rest in the order they were asked for. `maxConcurrent` sets the number, a positive whole number or `Infinity` for no limit; any other value is refused when the package is built. A queued fetch's `timeoutMs` starts when the fetch does, so a long queue does not time out requests that never ran. A query asked for again while it waits shares the one fetch, and one cancelled while it waits never fetches. A fetch that ignores its signal still gives its slot back at the deadline, with the timeout error for its line, where before it could hold the line pending for ever.

The boundary: this bounds how many requests run together, not how many run, and it is not a rate per minute. The limit is one per resolver, shared by every engine in the process. A resolver written by hand, without `createQueryResolver`, keeps whatever limit it keeps of its own. The async data source guide shows the option with a worked example, and the package-authoring routing table points to it.

## Verification

`Issue696_queryResolverConcurrency.spec.ts` holds eighteen tests. The limit hands out its slots in arrival order, `tryAcquire` takes a free one in the same turn, a release called twice frees one slot, and a waiter whose signal aborts leaves the queue; `Infinity` is no limit, and zero, negatives, fractions, `NaN` and `-Infinity` are refused. The resolver runs a thousand queries six at a time by default, in order, honours `maxConcurrent`, and refuses an invalid one when the package is built. A queued fetch's timeout starts when it runs, a fetch that never settles frees its slot at the deadline, a query asked for twice while it waits fetches once, and one cancelled while it waits never fetches. An uncontended fetch still starts in the turn that asked for it, so a first pass reads a cached value as before, and prototype words as queries queue like any other. Through the weather package with `fetch` stubbed, a document of 60 places keeps at most six requests in flight and every place answers; the tree before this change had all 60 in flight at once.

The full suite (`npm run test:full`) passed, 15,536 of 15,540 tests in 611 suites with 4 skipped, and `npm run verify:ci` passed end to end, including the three-zone temporal run (2,865 tests in 90 suites each) and the bundled-consumer contract (25 checks against an installed copy, including 1,363 documented examples).
