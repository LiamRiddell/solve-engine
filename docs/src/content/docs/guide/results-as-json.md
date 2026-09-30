---
title: Results as JSON
description: The three JSON shapes a result can take (a value as it is, the display-ready worker shape, and the engine snapshot), and which to use for logging, for a worker boundary and for storage.
---

A host often wants a result somewhere other than the screen: in a log line, in a
database, in a message to another thread, or in a file to restore from later.
JSON (JavaScript Object Notation, the plain-text format of objects, arrays,
strings and numbers that every language reads) is the usual way there. The
engine has three JSON shapes, one for each of those jobs, and they are not the
same shape because the jobs want different things.

| Shape | Made by | Holds | Turns back into a result | For |
| --- | --- | --- | --- | --- |
| a value as it is | `JSON.stringify(value)`, `JSON.stringify(parseDocument(...))` | the fields a `Value` carries: its type, payload, unit and exact figures | no | logging, debugging |
| the display shape | `serializeValue`, `serializeParsingResult` from `solve-engine/worker` | the answer as a reader sees it (`text`), its numeric reading and unit | no | a worker boundary, a cache of what to show |
| the snapshot | `engine.toJSON()`, `ExpressionEngine.fromJSON()` | the engine's state: variables, functions, cached lines | yes, onto a fresh engine | saving and restoring a session |

## A value as it is

`JSON.stringify` of a result writes what the `Value` holds: its `type` (a number
from the `ValueType` enum in `solve-engine/vm`), its `value`, its `unit` where it
has one, and any exact figure behind it. A whole `ParsingResult` stringifies the
same way, one entry per line.

```ts
import { createEngine } from "solve-engine";

const engine = createEngine();

JSON.stringify(engine.evaluateExpression("2 + 3"));     // '{"type":0,"value":5}'
JSON.stringify(engine.evaluateExpression("0.1 + 0.2")); // '{"type":0,"value":0.3,"exact":"0.3"}'
JSON.stringify(engine.evaluateExpression("$10"));       // '{"type":6,"value":10,"unit":"USD","exact":"10"}'
JSON.stringify(engine.evaluateExpression("1/3"));       // '{"type":0,"value":0.3333333333333333,"rational":"1/3"}'
JSON.stringify(engine.evaluateExpression("5 kg to m")); // '{"type":13,"value":"INCOMPATIBLE_UNITS","unit":"a mass cannot be converted to a length"}'
```

`exact` is the exact decimal the engine computed with, written as text so that
no digit is lost, and `rational` is an exact fraction, `"n/d"`. A whole number
too large for a JavaScript number is written as its digits
(`12345678901234567891n` gives `"value":"12345678901234567891"`). An error keeps
its code in `value` and its message in `unit`, which is how the engine stores
one.

It is a record of the value for a person reading a log, not a format to build
on. It leaves out the text a reader sees (`= $10.00`, which depends on the
formatting settings), and a reading with no finite answer (`1/0`) is written as
`"value":null`, since JSON has no infinity. It cannot be turned back into a
`Value`.

## The display shape

`serializeValue(value, settings?)` projects a value onto the shape the worker
posts across a thread boundary: the formatted `text`, the numeric reading in
`number`, and the `unit`, with type-specific fields added only where the value
needs them. Every field is a string, a number, a boolean or an object of those,
so the result survives `JSON.stringify` and `structuredClone` (what
`postMessage` copies with) alike.

```ts
import { serializeValue, serializeParsingResult } from "solve-engine/worker";

const settings = engine.getFormattingSettings();

serializeValue(engine.evaluateExpression("0.1 + 0.2"), settings); // { type: 0, text: "= 0.30", number: 0.3 }
serializeValue(engine.evaluateExpression("5 km"), settings);      // { type: 6, text: "= 5.00 km", number: 5, unit: "km" }
serializeValue(engine.evaluateExpression("$10"), settings);       // { type: 6, text: "= $10.00", number: 10, unit: "USD" }
serializeValue(engine.evaluateExpression("1/0"), settings);       // { type: 0, text: "= ∞", number: 0, nonFinite: "Infinity" }
serializeValue(engine.evaluateExpression("5 kg to m"), settings);
// { type: 13, text: "a mass cannot be converted to a length", number: 0, errorCode: "INCOMPATIBLE_UNITS" }
```

Passing `engine.getFormattingSettings()` writes `text` the way
`engine.formatValue` does, in the engine's own locale and time zone; with no
settings it uses the defaults (see [formatting results](/guide/formatting/)).
`number` is always finite: a reading with no finite answer is `0` there, and
named in `nonFinite` (`"Infinity"`, `"-Infinity"` or `"NaN"`), which
`Number(tag)` turns back. Beyond those, the shape carries `bigint` (a large
whole number as its digits), `matrix`, `range`, `colour`, `chart` and `ipCidr`
where the value is one, and `sources` and `frozen` for a live answer.

`serializeParsingResult(result, settings?)` does the same for a whole document,
and `serializeParsedLine` for one line. Each line keeps its text, position and
`error` message, and a line that failed keeps its `errorCode` and `errorSpan`
(where in the line it failed) as the line does on the main thread:

```ts
const doc = serializeParsingResult(engine.parseDocument("a = 1.5\na * 2\n3 + * 4"), settings);

doc.lines[0].result; // { type: 0, text: "= 1.50", number: 1.5 }
doc.lines[1].result; // { type: 0, text: "= 3", number: 3 }
doc.lines[2].error;  // 'Expected a value after "+", but found "*"'
doc.lines[2].errorCode; // "NO_PREFIX_PARSELET"
doc.lines[2].errorSpan; // { start: 4, end: 5, line: 3, col: 5 }
doc.errors;          // ['Line 3: Expected a value after "+", but found "*"']
```

This is what a host behind [the worker](/guide/performance/#off-the-main-thread)
receives, and it is the right shape to cache the answers a page shows. It is
display-ready, not restorable: the `text` is fixed at the settings it was
written with, a colour or a matrix is a description rather than a value, and
there is no way back to a `Value` from it.

## The snapshot

`engine.toJSON()` captures the engine's state, rather than one answer, as plain
JSON: its variables, its user-defined functions and its cached lines with their
compiled programs. `ExpressionEngine.fromJSON()` restores it onto a fresh engine,
which then answers without evaluating the document again. It is the only one of
the three shapes that goes back to live results. [Snapshotting and restoring
state](/guide/embedding/#snapshotting-and-restoring-state) covers it in full,
including what it deliberately leaves out: a live-data answer (fetched again
rather than restored stale, unless it was frozen), and the values it has no form
for yet (an algebra result, a colour, a bill split, a chart, a subnet).

## Choosing

- **Logging or debugging a result**: `JSON.stringify(value)`, or of the whole
  `ParsingResult`. It shows what the value is made of.
- **Crossing a worker or process boundary, or caching what to show**:
  `serializeValue` and `serializeParsingResult`, with the engine's formatting
  settings. The worker does this for you.
- **Saving a session to restore later**: `engine.toJSON()` and `fromJSON()`.

A failure thrown as an `EngineError` has a `toJSON()` of its own, which includes
the moment it was built; compare two failures by `code` and `message`, not by
their serialised text (see [determinism](/guide/determinism/#errors)).

The boundary: none of these is a schema to store for ever. The display shape
follows the worker protocol and the snapshot carries a format version that
`fromJSON` checks; a value's own JSON is a record for reading. A host that needs
a long-lived format of its own writes one from the fields it needs, typically
the display shape's `text`, `number` and `unit`.
