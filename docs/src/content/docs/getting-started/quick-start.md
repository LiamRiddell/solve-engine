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
    error.code; // "UNEXPECTED_END_OF_INPUT"
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

Read [core concepts](/getting-started/concepts/) next for the mental model, or go
to the [syntax reference](/syntax/cheatsheet/) for what you can write.
