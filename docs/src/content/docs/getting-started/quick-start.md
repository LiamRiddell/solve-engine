---
title: Quick start
description: Evaluating your first expressions, and evaluating a whole document.
---

The engine has two entry points. One evaluates a single expression. The other
evaluates a document, which is what you want when lines refer to each other.

## A single expression

```ts
import { createEngine } from "solve-engine";

const engine = createEngine({ locale: "en" });
const result = engine.evaluateExpression("50% of 200");

result.toNumber(); // 100
```

`evaluateExpression` returns a single `Value`. Call `toNumber()` on it, or read
its `type` and `unit`, directly.

## Formatting the result

A value carries a type, a raw payload, and optionally a unit. Turning it into
the string a person should see is a separate step, so you can substitute your
own presentation.

```ts
import { formatValue } from "solve-engine/format";

const value = engine.evaluateExpression("100cm + 2m");
formatValue(value); // "= 300.00 cm"
```

The leading marker is a display convention for an editor gutter. Strip it if you
are rendering somewhere else.

## A document

Variables, line references and aggregates only mean something in the context of
a document, so those need `evaluateLine` with real line numbers.

```ts
const engine = createEngine({ locale: "en" });

engine.evaluateLine(1, ":subtotal = 100");
engine.evaluateLine(2, ":tax = 20% of :subtotal");
const total = engine.evaluateLine(3, ":subtotal + :tax");

total.toNumber(); // 120
```

Line numbers matter. They are how the engine tracks which lines depend on which,
so that editing line one re-evaluates lines two and three and nothing else.

## Handling failure

There are two kinds of failure, and they arrive differently on purpose.

A line the parser cannot read at all (`10 +`, an unclosed bracket), or one that
names a variable no line has defined, **throws** an `EngineError`. Nothing about
such a line can be evaluated, so there is no value to hand back.

A line the engine can run but cannot answer (an impossible conversion, a rate it
has no data for, a live value that has not arrived yet) comes back as a **value
whose type says so**. That is the right behaviour when input is being typed one
character at a time and is invalid most of the way: one bad line never takes the
rest of the document down with it.

```ts
import { EngineError } from "solve-engine/errors";

try {
  engine.evaluateExpression("10 +");
} catch (error) {
  if (error instanceof EngineError) {
    error.code;       // "UNEXPECTED_END_OF_INPUT"
    error.message;    // 'The line ends after "+", where a value was expected'
    error.suggestion; // 'Write a value after "+"'
    error.span;       // { start: 4, end: 4, line: 1, col: 5 }: just after the "+", where an editor underlines
  }
}

const value = engine.evaluateExpression("5 kg to m");
value.isError();    // true
value.errorCode;    // "INCOMPATIBLE_UNITS"
value.errorMessage; // "a mass cannot be converted to a length"
```

`isPending()` marks a value still waiting on live data, and `isFault()` covers
either case. Check it before `toNumber()`: a faulted value reads as `0` through
it, indistinguishable from a real zero.

The **code** (`UNEXPECTED_END_OF_INPUT`, `INCOMPATIBLE_UNITS`) is the part to
branch on: it is a fixed name for the kind of failure, and it keeps its name
from one release to the next, where the message is a sentence for the reader and
may be reworded. [Error codes](/guide/error-codes/) lists every one.

A document reports both kinds on its lines, so nothing throws out of
`parseDocument` or `evaluateDocument`. A line the engine could not read or run
has its message in `error`, with the same `errorCode` and `errorSpan` the line
throws on its own, and no `result`. A line that ran and could not answer has its
error value in `result`, as a single expression does. `errors` lists both, one
`Line N: message` entry each.

```ts
const doc = engine.parseDocument("3 + * 4\n5 kg to m");

doc.lines[0].error;             // 'Expected a value after "+", but found "*"'
doc.lines[0].errorCode;         // "NO_PREFIX_PARSELET"
doc.lines[0].errorSpan;         // { start: 4, end: 5, line: 1, col: 5 }: offsets into the line's own text
doc.lines[1].result?.errorCode; // "INCOMPATIBLE_UNITS"
doc.errors.length;              // 2
```

`parseDocument` and `evaluateDocument` are two of the engine's four entry
points, and they differ in what they resolve: [which entry
point](/guide/entry-points/) compares them with a single expression and a live
editor.

Read [core concepts](/getting-started/concepts/) next for the mental model, or go
to the [syntax reference](/syntax/cheatsheet/) for what you can write.
