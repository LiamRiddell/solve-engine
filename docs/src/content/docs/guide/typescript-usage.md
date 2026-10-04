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

A parse failure names what the reader typed and what the engine expected there,
and sets `suggestion` where there is an obvious next step: `(5 km) -> miles`
throws `Expected a value after "-", but found ">"`, with the suggestion `"->" is
not a conversion here; to convert, write "in miles"`.

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

`parseDocument` takes the whole note as one string and returns a `ParsingResult`
with one `ParsedLine` for every line, counted as an editor counts them: a note
that ends in a line break has an empty last line after it, an empty note is one
empty line, and a line ending in `\r\n` has the `\r` left out of its `text`.
`evaluateDocument` counts the same way, so a host can index either result by the
editor's line number.

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

## When a line fails

A document never throws for a line that fails: every line is still in `lines`,
and the failure is reported on it. The two kinds of failure a single expression
has (the one it throws and the one it returns as a value) arrive in two places,
so a host can tell them apart:

- A line the engine could not read or run (`3 + * 4`, an undefined name) has its
  message in `error`, its code in `errorCode`, and where in the line the fault is
  in `errorSpan`, with `result` null. These are the code and the position the
  same text throws with through `evaluateExpression`.
- A line that ran and could not answer (`5 kg to m`) keeps its error value in
  `result`, with `error`, `errorCode` and `errorSpan` null. The code is on the
  value, as `result.errorCode`.

An inline solve reports the same way on its own entry in `inlineSolves`, so one
failing solve does not hide its neighbours. The span is in the line's own terms:
character offsets into the line's text, starting at 0, with the document's line
number and the one-based column, which is what an editor needs to underline the
fault. A failure the engine raises without a position (an undefined name has
none) has a `null` span rather than an invented one.

```ts
const doc = engine.parseDocument("3 + * 4\n5 kg to m\ntotal is s`2 +` and s`5 kg + 3 m`");

doc.lines[0].errorCode;              // "NO_PREFIX_PARSELET"
doc.lines[0].errorSpan;              // { start: 4, end: 5, line: 1, col: 5 }
doc.lines[1].error;                  // null
doc.lines[1].result?.errorCode;      // "INCOMPATIBLE_UNITS"
doc.lines[2].inlineSolves[0].errorCode; // "UNEXPECTED_END_OF_INPUT"
doc.lines[2].inlineSolves[0].errorSpan; // { start: 14, end: 14, line: 3, col: 15 }
doc.lines[2].inlineSolves[1].result?.errorCode; // "INCOMPATIBLE_UNITS"
```

`errors` is the flat list, one `Line N: message` entry for every failure of
either kind, in line order: four for the document above. `parseDocument` and
`evaluateDocument` fill every one of these fields the same way, so a host can
move from one to the other without reading failures differently. The live
evaluator's per-line result (`EvalLineResult`) carries `errorCode` and
`errorSpan` beside its `error` too.

Every code is listed, with when it arises, on [error codes](/guide/error-codes/).
A host that branches on codes can check one it meets with
`isCataloguedErrorCode` from `solve-engine/packages`.

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
