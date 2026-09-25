---
"solve-engine": patch
---

A `global :name` that nothing declares no longer keeps a listener per read, or its engine, for ever

A `global :name` read waits until some note declares the name, and a name nobody declares waits for ever: that is the design. Each wait subscribed its own listener to the process-wide store of globals, and the resolver, one instance shared by every engine, kept each waiting promise in a map of its own (#695). So a note reading 40,000 undeclared names left 40,000 listeners that every later write, from any engine, called in turn, and the promises carried the engine's continuation, so a dropped engine was never collected.

| after one engine reads 40,000 undeclared names and is dropped | before | now |
| --- | --- | --- |
| the resolver's listeners on the store | 40,000 | 0, once the engine is collected (1 while it waits) |
| the engine | kept, with 152 MB of heap | collected, 9 MB of heap |
| another engine's 2,000 writes | 511 to 700 ms | 19 to 31 ms |

Measured on one Windows 11 machine under Node 24.16 with `--expose-gc`, three runs each; the same 2,000 writes take 16 to 50 ms in a fresh process.

The resolver now holds one subscription, and dispatches a write through its waits by name. Each engine's waits are kept weakly by that engine's query client, so they go when the engine does, and the subscription goes when nothing waits. A name nobody declares still waits for ever, several lines of one engine waiting on one name still share one promise, and a write settles every engine's wait on its name.

The boundary: one engine's teardown no longer ends other engines' waits, as clearing the shared map used to; an engine's own waits end with it, or when the name is written. The values the store keeps for names that have been written are unchanged, since keeping them process-wide is the design the 3.0 Workspace revisits.

## Verification

`Issue695_globalWaitsGoWithTheirEngine.spec.ts` holds ten tests. One subscription serves a thousand undeclared names and several engines, and it goes when nothing waits. The waits keep their behaviour: lines of one engine share a promise, a write settles every engine's wait on its name and no other, one engine's teardown ends no other's, a wait survives the store being reset under it, and a name nobody declares still pends. Through real engines, forty thousand undeclared reads add one listener, and a dropped engine is collected with its waits gone from the store (run under `--expose-gc`, as the full suite is). The collection test fails on the tree before this change.

The full suite (`npm run test:full`) passed, 15,536 of 15,540 tests in 611 suites with 4 skipped, and `npm run verify:ci` passed end to end, including the three-zone temporal run (2,865 tests in 90 suites each) and the bundled-consumer contract (25 checks against an installed copy, including 1,363 documented examples).
