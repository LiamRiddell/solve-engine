---
"solve-engine": patch
---

The guides' TypeScript examples that state a result are run, and a fence that states one it does not give fails the build

The syntax pages' examples were proven and the guides' TypeScript fences were not: nothing opened them, and the README said every example was executed (#779). Two stated results on the formatting page had drifted from the engine before being corrected by hand. `GuideExamples.spec.ts` now reads every `ts` and `typescript` fence under `guide/`, `getting-started/` and the package-author pages, and holds the convention they already use: a statement whose line ends in a quoted comment states its result, and `// throws: <message>` states that it throws.

| fence | before | now |
| --- | --- | --- |
| `formatValue(value); // "= 3,000.00 m"` | read by nothing | run, compared with what it evaluates to |
| `engine.evaluateExpression("5 km in miles"); // throws: Expected an operator or the end of the line, but found "km"` | read by nothing | run, the thrown message compared |
| `german.evaluateExpression("naechste freitag")` on the formatting page | `engine.evaluateExpression("next friday")` on a `de-DE` engine, which throws, since the German pack reads the German date words | runs, and the page says why the word differs |

A page's fences build on each other the way a reader takes them, so a fence runs after every earlier fence on its page in one scope, with the quick start's `engine` and imports as the given starting point. A fence imports `solve-engine` and its subpaths as a consumer does, resolved onto the source under test. The formatting page's German engine is named `german` now, so the examples after it read an English engine as their text says.

The boundary: a fence that states no result is not run, since most are fragments (a signature, an options object, an adapter), and there is no type-check pass over the fences; that half of the issue is not done. Four fences that state a result cannot run in the suite and are listed by page and line with the reason (a live rate before it resolves, a frozen live answer, the runtime's own Temporal on a Node that has none, a worker started from a module URL); the list fails when an entry goes stale. The README now claims only what is run.

## Verification

`GuideExamples.spec.ts` holds 34 tests, 30 of them fences that state a result, run and matched; `TsFences.spec.ts` holds 12 unit tests of `tools/tsFences.ts` (`fencesIn`, `statedResult`, `statedThrow`, `instrumentFence`, `parsesCleanly` and `pageProgram`) with ordinary, boundary and hostile fences: CRLF, an unclosed fence, a quoted fence, a stray `return`, prototype words as names, markup in strings, and a two-thousand-line fence, with `Object.prototype` unchanged.

Gates run: the full suite (`npm run test:full`) ran 24,912 tests in 728 suites: 24,907 passed and 4 were skipped. The one failure was the #729 spec that keeps explain-before-show exemptions honest, since the unit reference's new headlines explain before each table and its exemption no longer named anything; the exemption is removed and that spec passes on a rerun. `npm run test:temporal` in all three zones, `npm run typecheck`, `typecheck:tests` (no new errors), `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, `lint:keywords`, `lint:links`, `lint:units`, `lint:ci-parity` and `lint:jest-configs` passed. `npm run verify:ci`, the docs site build and the bundled-consumer contract were not run whole for this change; CI runs them.
