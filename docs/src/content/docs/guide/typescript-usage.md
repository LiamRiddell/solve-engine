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

## Exact values behind a number

Some `Number` results are exact where a double is not, and carry the exact value
beside the double. `toNumber()` still returns the nearest double, so code that
reads a number keeps working unchanged; the exact value is `value.rational`, a
pair of bigints `{ n, d }`, and `formatValue` renders it.

A quotient of whole numbers carries its fraction (`1/3` is `{ n: 1n, d: 3n }`).
A whole-number result past 9,007,199,254,740,991 (`Number.MAX_SAFE_INTEGER`),
which the engine computes exactly (see [big integers](/syntax/big-integers/)),
carries its integer with a denominator of `1n`:

```ts
const value = engine.evaluateExpression("2^53 + 1");
value.type;         // ValueType.Number
value.toNumber();   // 9007199254740992, the nearest double
value.rational;     // { n: 9007199254740993n, d: 1n }
formatValue(value); // "= 9,007,199,254,740,993"
```

Read `rational.n` when every digit matters. A result crossing the worker boundary
keeps the digits in its formatted `text`; its `number` is the double.

A number written with a decimal point, and an exact answer worked out from one,
carries `value.exact` instead of `rational`: the decimal as a whole-number
coefficient and a count of places. `0.1 + 0.2` has an `exact` standing for 0.3,
where its double is 0.30000000000000004.

## Sending a value as JSON

A `Value` goes through `JSON.stringify`, for a host that logs a result, stores it,
or posts it to another process. It writes `type`, `value` and `unit`, then each
exact value that is set, with its digits as a string, since JSON has no place for
a number that size:

```ts
JSON.stringify(engine.evaluateExpression("0.1 + 0.2"));
// {"type":0,"value":0.3,"exact":"0.3"}
JSON.stringify(engine.evaluateExpression("3^40"));
// {"type":0,"value":12157665459056929000,"rational":"12157665459056928801/1"}
```

This shape is for reading. To save an engine's state and restore it later, use
`engine.toJSON()` and `ExpressionEngine.fromJSON()` (see
[embedding](/guide/embedding/)).

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

A name the engine does not know (a variable, a function) also throws, and when
it is close to a real one the error carries the nearest candidates, so a host
can offer a one-click fix. They are in the message as a sentence, in
`suggestion` as a comma-separated list, and in `context.didYouMean` as an array.
The engine never applies one itself.

```ts
import { EngineError } from "solve-engine/errors";

try {
  engine.evaluateExpression("sqr(16)");
} catch (error) {
  if (error instanceof EngineError) {
    error.code;                // "UNDEFINED_FUNCTION"
    error.message;             // "Undefined function: sqr. Did you mean sqrt?"
    error.context?.didYouMean; // ["sqrt"]
  }
}
```

The candidates come from the engine's own vocabulary, so a package's functions
and units are suggested without the package doing anything: the builtin
functions, the user's own functions, every unit spelling, and the variables
defined so far. A target unit that is not a unit at all, as in `5 km in mies`,
comes back as an `UNKNOWN_UNIT` error value with the same sentence.

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

A whole document parsed with `parseDocument` also reports its
[checks](/syntax/conditionals/#checks), the lines that assert something must hold,
as `result.checks`, a `{ passed, failed }` count present only when the document
has any. A host can read it to flag a note whose checks have started failing
without reading any error text.

```ts
const result = engine.parseDocument(":budget = $1950\n:spent = $2010\ncheck :spent <= :budget");
result.checks; // { passed: 0, failed: 1 }
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
