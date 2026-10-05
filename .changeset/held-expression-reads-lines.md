---
"solve-engine": patch
---

A map, sum, plot or formula that reads another line is refused for that: `map(x + prev, 1:3)` says to name the value first, where it said the expression must make "no weather/stocks/currency calls"

A held expression, the expression of `map`, `reduce`, `sum`, `prod`, a plot, or `solve`, `der`, `integral`, `limit` and `taylor`, is compiled on its own and worked out away from the line, once for each element or point, or as a formula. A call that reads other lines (`prev`, `line 1`, `total above`, a tag or a table column) marks the line as one that waits, so each held form refused it as live data, naming something the line never did (found in testing). Such a call carries `readsDocument`, which a function body already reads to refuse it as reading lines (`FUNCTION_BODY_READS_LINES`); every held form now does the same through one check (`heldExpressionReadsLines` in `parser/HeldExpression.ts`), refusing with `HELD_EXPRESSION_READS_LINES` and the way to write it.

| line | before | now |
| --- | --- | --- |
| `map(x + prev, 1:3)` | map/reduce transform expressions must be synchronous (no weather/stocks/currency calls). | map's expression reads other lines of the document, and it is worked out away from the line, where there are no lines to read: give the line's value a name first, as in p = prev, and use p in the expression |
| `sum(x + total above, 1:3)` | sum's element expression must be synchronous (no weather/stocks/currency calls). | sum's expression reads other lines of the document, ... |
| `plot x + prev from 0 to 1` | a plot expression must be synchronous (no weather, stocks or currency calls). | plot's expression reads other lines of the document, ... |
| `der(x^2 + prev, x)` | der's expression must be synchronous (no weather/stocks/currency calls). | der's expression reads other lines of the document, ... |
| `p = prev` then `map(x + p, 1:3)` | `[6, 7, 8]` | `[6, 7, 8]` |

The boundary: an expression that reaches live data (a weather or price lookup) keeps its own refusal, since it waits for the network rather than reads the document. The helper is internal; a package's own held form reads `builder.readsDocument` after `build()` to refuse the same way, which the functions-and-operators guide now describes.

## Verification

`FoundBug_heldExpressionReadsLines.spec.ts` holds 22 tests: each held form through `evaluateExpression` and `evaluateLine`, both document passes agreeing and the named form answering, live data keeping its refusal; unit tests of `heldExpressionReadsLines` (ordinary: a line-reading call; boundary: no call, a call that never waits, one that waits for data; hostile: a markup, an inherited and a ten-thousand-character verb); and the adversarial cases (prototype words beside the read with `Object.prototype` unchanged, a long held expression, a huge range and five hundred refused lines in time, markup-shaped text, a check, a section and a tag around it, an edit that names the value, every numeric edge, CRLF and a trailing newline). `CrossPathDocumentFeatures.spec.ts` gains the three-path shape (both document passes, an edit, and the single-line path), and `AdversarialFeatureSweep.spec.ts` gains `map(x + (X) + prev, 1:3)`. `FoundBug_synchronousPluginCalls.spec.ts` pinned the old wording for `map(x + prev, 1:3)` and now pins the new code, with live data in a map still refused as before. Gates run: `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:changeset`, `lint:error-codes`, `lint:docs`, the docs example specs, batch AB's specs, the map-reduce specs, the hardening and integration specs, and the whole fast suite.

On top of main, the full suite ran 36,308 tests in 879 suites, all passing but 5 skipped, and `npm run test:temporal` passed its 3,803 tests.
