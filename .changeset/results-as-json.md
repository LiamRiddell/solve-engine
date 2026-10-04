---
"solve-engine": minor
---

A worker's serialised line keeps its failure code and position, negative zero crosses as zero, and a new guide, Results as JSON, sets out the three shapes a result can take

`serializeValue`, `serializeParsedLine` and `serializeParsingResult` in `solve-engine/worker` turn results into a stable, display-ready shape, and no page mentioned them, so a host that wanted to store, log or post a result reached for `JSON.stringify` without knowing what it would get (#725). Documenting the shape found two gaps in it. A document line has carried the `errorCode` and `errorSpan` of a failure since #709, and the serialised line dropped both, so a host behind the worker could branch only on the message. And a negative zero crossed as `-0` through `structuredClone` and `0` through `JSON`, so the one shape the module promises was two.

`SerializedParsedLine` and `SerializedInlineSolve` now carry `errorCode` and `errorSpan`, null where the line has none, alike on both document passes. `serializeSpan` copies a span as its four numbers. The display shape's `number` writes negative zero as zero; its `text` already read `= 0`. The snapshot's internal `serializeValue` in `engine/EngineSnapshot.ts`, which writes a different shape, is renamed `snapshotValue`, so the source no longer has two functions of one name.

| `serializeParsingResult(parseDocument("a = 1.5\na * 2\n3 + * 4"))`, line 3 | before | now |
| --- | --- | --- |
| `error` | `Expected a value after "+", but found "*"` | the same |
| `errorCode` | not there | `NO_PREFIX_PARSELET` |
| `errorSpan` | not there | `{ start: 4, end: 5, line: 3, col: 5 }` |
| `serializeValue(-0).number`, through `JSON` and through `structuredClone` | `0` and `-0` | `0` and `0` |

[Results as JSON](/guide/results-as-json/) sets out the three shapes and which to use: `JSON.stringify` of a value (the fields it carries, bigints as digits, for logging), the display shape (`text`, `number`, `unit` and the type-specific fields, for a worker boundary or a cache of what to show) and the snapshot (`toJSON` and `fromJSON`, the only one that restores), with what each leaves out. Every example is from a run.

```text
JSON.stringify(0.1 + 0.2)          {"type":0,"value":0.3,"exact":"0.3"}
serializeValue(0.1 + 0.2)          { type: 0, text: "= 0.30", number: 0.3 }
JSON.stringify(1/0)                {"type":0,"value":null}
serializeValue(1/0)                { type: 0, text: "= ∞", number: 0, nonFinite: "Infinity" }
```

The fields are added to the DTO types, so code that builds one by hand gains two required fields; code that reads one compiles as before. The boundary: a value's own JSON writes a non-finite reading as `null`, since JSON has no infinity, and the guide says so rather than changing `Value.toJSON`; the display shape is the one that names it. None of the three is a schema to keep for ever: the display shape follows the worker protocol, and the snapshot carries a version `fromJSON` checks.

## Verification

`Issue725_resultsAsJson.spec.ts` holds 103 tests: the guide's examples for all three shapes, `serializeSpan` with ordinary, absent, non-object, extra-key, `__proto__` and 2^53 arguments, the serialised line and inline solve for a line that ran, a runtime failure with no position, a returned failure, a thrown and an answering inline solve, both document passes serialising to the same failures, and the adversarial cases (prototype words, three thousand failing lines, a long sum and a long text, the text edges read as text, units that do not fit, a colour, a matrix, an uncertainty and a symbolic line round-tripping through `JSON` and `structuredClone`, a `de-DE` engine's settings, a value from the line above, the numeric edges and the document edges on both passes, and negative zero and the non-finite readings). The three specs that imported the snapshot's `serializeValue` import `snapshotValue`.

The full suite (`npm run test:full`) passed, 22,632 of 22,636 tests in 691 suites with 4 skipped, as did `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet` and `lint:sidebar`. `npm run verify:ci` and the bundled-consumer contract were not run whole for this change; CI runs both.
