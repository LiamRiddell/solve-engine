---
title: Using the engine from TypeScript
description: Evaluating expressions and documents in code, and reading the values back out.
---

[Embedding the engine](/guide/embedding/) covers creating and configuring an
engine. This page is about what you do with it: evaluating a line or a whole
document, and reading the values that come back.

## A result is a value

`evaluateExpression` returns a single [`Value`](/api/vm/classes/value/)
object, not a plain number. Read its type and payload directly.

```ts
const value = engine.evaluateExpression("10% of 200 + 3 km in m");
value.type;       // ValueType.Uom
value.toNumber(); // 3020
value.unit;       // "m"
```

A `Value` rather than a plain number because it carries a type and a unit
alongside its number. Reaching for `toNumber()` too early throws away the unit
and the type, which is usually the information you wanted.

## Values are typed

Every value has a `type` from the `ValueType` enum. It tells you how to read the
rest of the value before you assume it is a plain number.

```ts
import { ValueType } from "solve-engine/vm";

const value = engine.evaluateExpression("50%");

switch (value.type) {
  case ValueType.Number:
  case ValueType.Percentage:
    return value.toNumber();
  case ValueType.Uom:
    return `${value.toNumber()} ${value.unit}`;
  case ValueType.Boolean:
    return value.value; // true or false
  default:
    return null;
}
```

The tags you will meet most are `Number`, `Percentage`, `Uom` (a number with a
unit), `Boolean`, `String`, `Datetime`, `Pending` and `Error`. The full set is
in the [API reference](/api/vm/enumerations/valuetype/).

## Errors are values, not exceptions

Most failures the engine meets while a document is being written come back as
_values_, not exceptions. An impossible unit conversion, or a live value that has
not resolved yet, is a `Value` you can inspect, so one bad line never takes the
rest of the document down with it.

```ts
const value = engine.evaluateExpression("5 kg to m");
value.isError();     // true
value.errorCode;     // "INCOMPATIBLE_UNITS"
value.errorMessage;  // "a mass cannot be converted to a length"
```

`isPending()` marks a value still waiting on async data, and `isFault()` covers
either. Check one before `toNumber()`: an `Error` or a `Pending` reads as `0`
through it, indistinguishable from a real zero. `evaluateNumber` makes the same
distinction, returning `NaN` for a faulted expression rather than that silent `0`.

A genuinely malformed line, one the parser cannot build an expression from at
all (`1 +`), is the exception: `evaluateExpression` throws an `EngineError` for
it. A host wraps the call to catch those, and reads the fault guards on the
value it gets back for everything else.

This is deliberate. The engine is built to run on half-typed input as someone is
still writing it, where most lines are briefly invalid on the way to being valid.

## Evaluating a document

For more than one line, `evaluateLines` takes an array of lines and returns one
`ParsedLine` per input. Each carries its own `result` value, or an `error`.

```ts
const lines = engine.evaluateLines([
  "price = 40 USD",
  "qty = 3",
  "price * qty",
]);

lines[2].result?.toNumber(); // 120
lines[2].result?.unit;       // "USD"
```

Variables defined on one line are visible to the lines below it, which is what
makes a document more than a list of separate expressions.

Referring to a line by position, such as `line1`, is different: that needs a
real document model rather than a plain array of lines, and without one the
engine returns a clear error saying so rather than a wrong number. Prefer named
variables for cross-line arithmetic.

## Cleaning up

An engine holds the variables and cached results of the document it last saw.
Call `clear()` before reusing it for unrelated input.

```ts
engine.clear();
```

This matters more than it looks once live data is involved: an expression that
started a network fetch keeps that work referenced until the engine is cleared,
so a long-lived process should clear engines it is finished with. See
[async and live data](/guide/async-and-live-data/).
