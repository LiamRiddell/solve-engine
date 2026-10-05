---
"solve-engine": patch
---

A function body, a map and an aggregate's element expression take every built-in that answers at once: `f(s) = upper(s)`, `f(x) = sha256(x)`, `paler(c) = lighten(c, 10%)` and `map(erf(x), 0:2)` work, where each was refused as calling "an async operation"

A held expression is one the engine keeps to work out later or many times: a function body, a map or reduce transform, the element expression of `sum`, the expression of `solve` and a plot. Each refuses a program that may wait for data, and every plugin call marked its program so, since a handler is allowed to answer later (a weather or price lookup). The text, hash, colour, dimensions, statistics, date and time zone handlers, and every other built-in that works its answer out from its arguments, never wait, yet their calls were plain, so `f(s) = upper(s)` was refused because its "body calls an async operation (weather, stocks, currency, ...)" (found in testing; batch X added `emitPluginCall(name, argCount, { synchronous: true })` and used it for the constants). Every built-in call site now emits through `emitBuiltinPluginCall`, which marks the call synchronous when its name is on `SYNCHRONOUS_PLUGIN_FUNCTIONS` (`packages/SynchronousPluginFunctions.ts`), the one list that decides.

| line | before | now |
| --- | --- | --- |
| `f(s) = upper(s)`, then `f("hello")` | "f(...)"'s body calls an async operation (weather, stocks, currency, ...), and a user-defined function body must be synchronous | `f(s) defined`, `HELLO` |
| `f(x) = sha256(x)` | the same refusal | `f(x) defined` |
| `paler(c) = lighten(c, 10%)`, then `paler(#336699)` | the same refusal | `paler(c) defined`, `#407fbf` |
| `printed(p) = p at 300 dpi in mm`, then `printed(4000px)` | the same refusal | `printed(p) defined`, `338.67 mm` |
| `k(x) = not x`, then `k(true)` | the same refusal | `k(x) defined`, `false` |
| `map(erf(x), 0:2)` | map/reduce transform expressions must be synchronous (no weather/stocks/currency calls). | `[0, 0.84, 1.00]` |
| `sum(erf(x), 0:2)` | sum's element expression must be synchronous (no weather/stocks/currency calls). | `1.84` |
| `map(upper(x), ["a","b"])` | map/reduce transform expressions must be synchronous (no weather/stocks/currency calls). | Text cannot be a cell of a list: each cell holds one number. |

The boundary: two kinds of call keep the mark and the refusal on purpose. A lookup that waits for the network (weather, stocks, crypto, the knowledge lookups, an exchange rate on a past date) cannot answer inside an expression worked out at once. A call that reads other lines (`prev`, `line 1`, the totals of a section, a tag or a table column, a table lookup, goal seek, what-if and scenarios) does not wait, but a held expression is run away from the line that wrote it, where there is no document to read. `map(upper(x), ["a","b"])` is now refused for its list, not its call: a list holds numbers, so a list of text is a limit of lists, not of this change. A third-party package keeps the choice per call, with the option batch X added.

## Verification

`FoundBug_synchronousPluginCalls.spec.ts` holds 23 tests: the lines that exposed it (a function body over a text, hash, colour, dimensions and logical call, a map, a reduce and a sum over `erf`, the list of text refused for its cells, a waiting or document-reading call still refused in a body and a map) through `evaluateExpression`, `evaluateLine`, `parseDocument` and `evaluateDocument`; an enumeration of every registered built-in plugin function, each on the synchronous list or kept for a stated reason and never both, each listed name registered, each listed handler returning no thenable over twenty sample argument lists, and a scan that every call site under `src/packages` emits through `emitBuiltinPluginCall`; unit tests of `pluginCallOptions` (ordinary, the empty name, a different case, the prototype words, frozen options) and of `emitBuiltinPluginCall` (the bytes, the mark, a waiting call before a synchronous one, the two-byte index, unknown and prototype names refused); and the adversarial cases (prototype words as the text, with `Object.prototype` unchanged, a fifty-thousand-character text, a huge range, three hundred lines, every text edge and markup as the argument, a function calling another, a value from the line above, a redefinition, a typo in the body, a wrong kind of argument, a waiting call beside a synchronous one, the empty text, CRLF, every numeric edge through a body and a map). `AdversarialFeatureSweep.spec.ts` gains `map(erf(x), [X])` and `map(x + erf(X), 0:2)`. Gates: see `grouped-range-bound-in-a-call.md`, which ran for both fixes.

On top of main, the full suite ran 36,308 tests in 879 suites, all passing but 5 skipped, and `npm run test:temporal` passed its 3,803 tests.
