---
"solve-engine": minor
---

A document line that fails keeps its error code and where in the line it failed, on both document passes (#709)

When a line fails, the engine says two things about it: a message for the person reading the note, and a code (`NO_PREFIX_PARSELET`, `INCOMPATIBLE_UNITS`) for the program showing it, which is what a host branches on to underline a line or offer a fix. A single expression that fails throws an `EngineError` carrying both, with a `span` saying which characters are at fault. A document line kept only the message, so a host that moved from one expression to a document lost the code it branched on and the span it underlined. The incremental pass, `evaluateDocument`, went further and turned a thrown failure into an error value with a code of its own, `eval_failed` (or `exec_failed` for a line that compiled and then failed), so the same line failed in a different place, and with a different code, depending on which pass read it.

A line or inline solve that throws now keeps three fields, alike on both passes: `error` (the message, as before), `errorCode` and `errorSpan`. The span is in the line's own terms: character offsets into that line's text, starting at 0, with the document's line number and the one-based column. A line that returns an error value keeps it in `result`, as before, on both passes. `eval_failed` and `exec_failed` are retired.

```ts
const result = engine.parseDocument("3 + * 4\n5 kg + 3 m");
result.lines[0].error;      // 'Expected a value after "+", but found "*"'
result.lines[0].errorCode;  // "NO_PREFIX_PARSELET"
result.lines[0].errorSpan;  // { start: 4, end: 5, line: 1, col: 5 }
result.lines[1].result;     // an error value, errorCode "INCOMPATIBLE_UNITS"
```

| `3 + * 4` as a document line | before | now |
| --- | --- | --- |
| `parseDocument`: `error` | `No prefix parselet found for token: STAR ("*")` | `Expected a value after "+", but found "*"` |
| `parseDocument`: `errorCode`, `errorSpan` | not there | `NO_PREFIX_PARSELET`, `{ start: 4, end: 5, line: 1, col: 5 }` |
| `evaluateDocument`: `error` | null | the same message as `parseDocument` |
| `evaluateDocument`: `result` | an error value with code `eval_failed` | null, as on `parseDocument` |
| `evaluateDocument`: `errorCode`, `errorSpan` | not there | the same as `parseDocument` |

An inline solve (`` s`...` `` inside a prose line) keeps the same three fields, its span measured from the start of the line it sits in, so `` total is s`2 +` `` places its fault at offset 14, just after the `+`. The flat `errors` list, one `Line N: message` entry per failure, now counts a returned failure as well as a thrown one on both passes: `parseDocument` used to leave `5 kg + 3 m` out of it and `evaluateDocument` put it in, so the two lists disagreed.

The fields are additive and optional on `ParsedLine` and `InlineSolvePosition`, so existing code compiles and reads what it read before. The change in behaviour a host may notice is on `evaluateDocument`: a line that throws now has a null `result` and its message in `error`, as it always had on `parseDocument`, rather than an `eval_failed` value in `result`. A host that read `result.value === "eval_failed"` reads `line.error` (or `line.errorCode`) instead, the check it already had for `parseDocument`. [Using the engine from TypeScript](/guide/typescript-usage/#when-a-line-fails) and the quick start describe the shape.

The boundary: a runtime failure raised with no position (an undefined variable, a unit that does not fit) has a null `errorSpan`, since the engine has no position to give; the code and message are still there. The worker's serialised line (`SerializedParsedLine`) does not yet carry `errorCode` or `errorSpan`; a host behind the worker reads the code from the serialised error value, as before.

## Verification

`Issue709_documentLineFailures.spec.ts` holds 36 tests. The helpers that turn a thrown error into what a line keeps are tested on their own: the span moved onto the line and clamped to it, a missing or non-finite offset, hostile line numbers, and a value thrown that is not an `EngineError`. The document half covers the issue's note through both passes, the live evaluator's stored failures, an edit that fixes a line and one that breaks it, and a snapshot round trip. The adversarial cases are a failing prototype word (with `Object.prototype` unchanged), three thousand failing lines, invisible characters and markup in a failing line, a leading space, a list marker, a label and CRLF, the shared document and text edges, and a line past the thousandth. `CrossPathDocumentFeatures.spec.ts` adds eight cases in which both document passes agree field for field on a failed line, an inline solve and the `errors` list, and a single `evaluateLine` throws the same code with its span on the host's line.

`npm run test:ci` passed, 16,075 of 16,079 tests in 621 suites with 4 skipped, with `npm run typecheck`, `lint`, `lint:comments`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, `lint:ci-parity` and `lint:error-codes`. `npm run verify:ci` and the bundled-consumer contract were not run for this change.
