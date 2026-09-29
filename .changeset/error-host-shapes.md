---
"solve-engine": patch
---

An error crossing the worker boundary no longer carries its message as a unit, `evaluateLine` puts a parse error on the host's line, and five messages lose their em-dashes (#836)

Three small faults in what a host receives, each fixed where it arose.

**The worker's `unit`.** An error value keeps its message in the field a quantity keeps its unit in, and `serializeValue` copied that field across, so an error reached a host behind the worker with its sentence where a unit belongs. The serialised value's `unit` is for units only now; an error's message crosses as `text` and its code as `errorCode`, as they already did.

| `5 m + 3 kg` through `serializeValue` | before | now |
| --- | --- | --- |
| `unit` | `"length and mass cannot be added"` | not there |
| `text` | `"length and mass cannot be added"` | the same |
| `errorCode` | `"INCOMPATIBLE_UNITS"` | the same |

**The span's line.** `evaluateLine(lineNumber, text)` is how a host evaluates one line of its own document, and a parse error's `span` should say where in that document the fault is. The engine read the text on its own, so the span always said line 1. It names the line the host passed now; the offsets and the column, which count from the start of the text, were already right. `evaluateExpression` has no line of its own and still reports line 1.

| call | span before | span now |
| --- | --- | --- |
| `evaluateLine(4, "3 + * 4")` | `{ start: 4, end: 5, line: 1, col: 5 }` | `{ start: 4, end: 5, line: 4, col: 5 }` |
| `evaluateExpression("3 + * 4")` | `{ start: 4, end: 5, line: 1, col: 5 }` | the same |

**The em-dashes.** The house style uses a colon where these messages used an em-dash, and one of them named the engine's own method. The codes are unchanged.

| line | before | now |
| --- | --- | --- |
| `2 x = 10` | `x stored as an equation — solve with "x =>"` | `x stored as an equation: solve with "x =>"` |
| `[]` | ``A matrix literal cannot be empty — `[]` has no valid shape.`` | ``A matrix literal cannot be empty: `[]` has no valid shape.`` |
| `[1, 2; 3]` | `Matrix literal rows must all have the same number of columns — row 2 has 1, but a previous row has 2.` | `Matrix literal rows must all have the same number of columns: row 2 has 1, but a previous row has 2.` |
| `[1, 2] * [3, 4]` | `Cannot multiply a 1x2 matrix by a 1x2 matrix — inner dimensions must match (2 !== 1).` | `Cannot multiply a 1x2 matrix by a 1x2 matrix: the first has 2 columns and the second 1 row, and the two must match.` |
| `line 1`, on its own | `Cross-line references require a real document — not available outside one (e.g. evaluateExpression()'s single-expression path)` | `A line reference needs a document to read, and an expression evaluated on its own has none` |

The boundary: a line number that is not a positive whole number (0, a negative, a fraction) leaves the span as the engine measured it, since there is no line to move it to. Other messages that still carry an em-dash are left to the lint that will enforce the rule across every message (#775), rather than reworded piecemeal here.

## Verification

`Issue836_hostShapes.spec.ts` holds 18 tests: the serialised error with no `unit` (the issue's line, a hand-built error with an empty or unit-shaped message, a whole document through `serializeParsingResult` and a JSON round trip, and messages that are markup, prototype words or invisible characters, with `Object.prototype` unchanged); the span on the host's line (a replayed failure from the failed-parse cache, a runtime failure with no span, line numbers of 0, -1, 2.5 and 100,000, and the shared text edges before a failing tail); and each reworded message with its code unchanged.

`npm run test:ci` passed, 16,075 of 16,079 tests in 621 suites with 4 skipped, with `npm run typecheck`, `lint`, `lint:comments`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, `lint:ci-parity` and `lint:error-codes`. `npm run verify:ci` and the bundled-consumer contract were not run for this change.
