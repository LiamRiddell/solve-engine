---
"solve-engine": patch
---

A function whose formula reads another line is refused for that, with its own code: `f(x) = x + prev` says a function body has no lines to read and to pass the value in as an argument, where it said the body "calls an async operation (weather, stocks, currency, ...)"

A function's formula is worked out wherever the function is called, away from the line that wrote it, so a reference to another line cannot be part of one. The refusal was right, but its reason was not: a call that reads other lines (`prev`, `line 1`, `total above`, a section, a tag or a table column) marked the formula the same way a lookup that waits for the network does, and the one message named the weather and stocks for a formula that waits for nothing (found in testing). Such a call is now emitted with `readsDocument` (`DOCUMENT_READING_PLUGIN_FUNCTIONS` in `packages/SynchronousPluginFunctions.ts`, tracked by `BytecodeBuilder.readsDocument`), and the definition is refused with `FUNCTION_BODY_READS_LINES`, with a suggestion naming the parameter to add.

| line | before | now |
| --- | --- | --- |
| `f(x) = x + prev` | "f(...)"'s body calls an async operation (weather, stocks, currency, ...), and a user-defined function body must be synchronous | "f(...)"'s body reads other lines of the document, and a function body has no lines to read: pass the value in as an argument instead |
| `f(x) = x + line 1` | the async refusal | the reads-lines refusal |
| `f(x) = x + total above` | the async refusal | the reads-lines refusal |
| `f(x) = x + weather in London` | the async refusal | the async refusal |
| `f(x, v) = x + v` then `10` then `f(2, prev)` | `12` | `12` |

The boundary: a formula that both reads a line and waits for data is refused for reading the line, since that one can never be supported. A map, a reduce, `solve` and a plot still refuse a call that reads other lines with their own codes, unchanged. A package author marks a handler of their own that reads other lines with `emitPluginCall(name, argCount, { readsDocument: true })`, documented in the functions and operators guide.

## Verification

`FoundBug_functionBodyReadsLines.spec.ts` holds 23 tests: the lines that exposed it through `evaluateExpression`, `evaluateLine`, `parseDocument` and `evaluateDocument`, the async refusal kept for a lookup that waits, the suggestion and the way it describes; unit tests of `pluginCallOptions` and the reading names (every built-in plugin function is exactly one of synchronous, reading the document or waiting; a different case, the empty name, prototype words, frozen options) and of `BytecodeBuilder.readsDocument` (set by a reading call, left by a synchronous or waiting one, cleared by a reset, ignored beside `synchronous`, unset by an unknown name); and the adversarial cases (prototype words as the function or parameter name with `Object.prototype` unchanged, a long body and two hundred calls in time, every text edge, a body that both reads and waits, a section and a table column, a call of the refused function, a synchronous body still working, every numeric edge, a body of only a reference, CRLF and a trailing newline). `FoundBug_synchronousPluginCalls.spec.ts` and `UserFunctionHardening.spec.ts` pinned the old wording for `prev` and `line 1` and now expect the new refusal. `AdversarialFeatureSweep.spec.ts` gains `f(x) = x + (X) + prev`. Gates run: `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:changeset`, `lint:error-codes`, `lint:docs`, the docs example specs, the function specs, the hardening and integration specs, and the fast suite.
