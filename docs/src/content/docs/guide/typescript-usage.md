---
title: Using the engine from TypeScript
description: Evaluating expressions and documents in code, and reading the values back out.
---

[Embedding the engine](/guide/embedding/) covers creating and configuring an
engine. This page is about what you do with it: evaluating a line or a whole
document, and reading the values that come back.

## A result is an array of values

`evaluateExpression` returns an **array** of [`Value`](/api/vm/classes/value/)
objects, not a single number. One expression usually produces one value, so destructuring the
first element is the common case.

```ts
const [value] = engine.evaluateExpression("10% of 200 + 3 km in m");
value.type;       // ValueType.Uom
value.toNumber(); // 3020
value.unit;       // "m"
```

An array rather than a scalar because a line can hold more than one result, and
because a value carries a type and a unit alongside its number. Reaching for
`toNumber()` too early throws away the unit and the type, which is usually the
information you wanted.

## Values are typed

Every value has a `type` from the `ValueType` enum. It tells you how to read the
rest of the value before you assume it is a plain number.

```ts
import { ValueType } from "solve-engine/vm";

const [value] = engine.evaluateExpression("50%");

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

A line the engine cannot make sense of does not throw. It returns a value of
type `Error`, so a bad line in a document never takes the rest of the document
down with it.

```ts
const [value] = engine.evaluateExpression("1 +");
value.type === ValueType.Error; // true
```

This is deliberate. The engine is built to run on half-typed input as someone is
still writing it, where most lines are briefly invalid on the way to being
valid.

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
