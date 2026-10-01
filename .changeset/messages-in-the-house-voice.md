---
"solve-engine": patch
---

Error messages and warnings are written in the house voice: no em-dash, and no host method named in a line's result

A message is prose a reader sees, the same as a docs page, but the comment-style lint skipped string literals on purpose, so messages had drifted: em-dashes in line results and in the engine's console warnings, and a category tag outside a document naming `evaluateExpression()` to a reader who had only typed a line (#775). They are reworded with colons, commas and second sentences, and `npm run lint:messages` now reads every message written as a literal (`errorValue`, `lineMessage`, `ErrorFactory`, `new EngineError`, `console.warn` and `console.error`) and fails on an em-dash, an American spelling, a JavaScript operator such as `!==`, or a host method named in a line's result. The engine's old em-dash is shown below as [em-dash].

| line | before | now |
| --- | --- | --- |
| `total of #food`, on its own | Category tag sums require a real document, not available outside one (e.g. evaluateExpression()'s single-expression path) | Category tag sums need a document, and a line evaluated on its own has none |
| `[1, 2; 3]` | Matrix literal rows must all have the same number of columns [em-dash] row 2 has 1, but a previous row has 2. | Matrix literal rows must all have the same number of columns: row 2 has 1, but a previous row has 2. |
| `$5/hour * 3 kg` | Cannot multiply a "hour"-denominated rate by "kg" [em-dash] different measures | Cannot multiply a "hour"-denominated rate by "kg": they measure different things |
| `1 cup unobtainium in grams` | No density data for "unobtainium" [em-dash] cannot convert between mass and volume for this ingredient | No density data for "unobtainium", so it cannot be converted between mass and volume |
| `f(x) = weather in London` | "f(...)"'s body calls an async operation (weather, stocks, currency, ...) [em-dash] user-defined function bodies must be synchronous | "f(...)"'s body calls an async operation (weather, stocks, currency, ...), and a user-defined function body must be synchronous |

The rest are the same kind of change: the rate conversion between measures, a descending range, a line in a range that is not a number, a singular symbolic pivot, a normalised token count over its limit, a package's invalid engine range, and the warnings for a duplicate parselet, a duplicate converter, a package that fails to register and an unexpected flush failure. Error codes keep their names; only the words change.

The boundary: the four messages that carried an em-dash in the files the error-shape change owns (#836: the empty matrix literal, the matrix size mismatch with its `(3 !== 2)`, the line reference outside a document, and the stored equation) are reworded there, and the cooking conversion's "recognized" is now "recognised". The lint keeps a pending list for a message whose rewording belongs to another change, naming its issue, and fails once a pending message no longer matches, so the list cannot outlive the fixes; it is empty now that those changes are in. A message assembled at run time from parts held elsewhere is beyond a source lint, and is checked by a spec instead.

## Verification

`Issue775_messageStyleLint.spec.ts` holds 33 tests: the real source is clean, each message helper in each shape (template, `+` chain, conditional, init object) is read, a code sample in a comment and a string that is not a message are not, the code and context of an error are treated as data, a stale pending entry fails, and the reworded lines read as the table shows through `evaluateExpression`. Adversarially, prototype words as callees and property names, markup-shaped text, an escaped em-dash, look-alike dashes, 5,000 messages in one file, a file that does not parse, CRLF and the text edges.

The fast suite (`npm run test:ci`) passed, 15,723 of 15,727 tests in 624 suites with 4 skipped, as did `npm run typecheck`, `npm run typecheck:tests`, `npm run lint`, `lint:comments`, `lint:messages`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, `lint:ci-parity`, and the docs, hardening and integration suites (5,342 tests in 86 suites). `npm run verify:ci` was not run whole: `lint:size` and `lint:stats` need their figures regenerated after the other changes in this release merge.
