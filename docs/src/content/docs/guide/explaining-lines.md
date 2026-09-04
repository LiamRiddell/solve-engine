---
title: Explaining a line
description: Turning a line's answer into a readable derivation for the person reading it.
---

A line reports an answer and no account of it. When the answer is surprising,
the usual way to check the engine's reading is to break the expression apart and
evaluate the pieces by hand.

```
(20% off 80) + 20%           76.80
```

That is either right, or the discount landed on the wrong side of the sum, and
the number alone does not tell you which. `explainLine` returns the derivation,
so a host can put it behind a hover or a disclosure next to the result.

```ts
const engine = createEngine({ locale: "en" });
const explanation = engine.explainLine("(20% off 80) + 20%");

for (const step of explanation.steps) {
  console.log(step.description, step.value.toNumber());
}
// 80 less 20%   64
// 64 plus 20%   76.8
```

This is not the [diagnostic pipeline](/architecture/pipeline/). That pipeline is
for the developer and reports stages, opcodes and timings. `explainLine` is for
the reader and reports arithmetic.

## What comes back

`explainLine` returns an `Explanation`:

```ts
interface Explanation {
  expression: string;        // the line, as given
  steps: ExplanationStep[];  // one entry per operation, in evaluation order
  result: Value;             // the final answer
}

interface ExplanationStep {
  description: string;       // "80 less 20%"
  value: Value;              // the value this step arrives at
}
```

The steps run in the order the engine evaluates the line: an operand appears
before the operation that consumes it, and each step's left-hand side is the
running value carried down from the steps above it. `result` is the same
[`Value`](/api/vm/classes/value/) that
[`evaluateExpression`](/guide/typescript-usage/) returns for the same line, so a
step can never disagree with the answer.

## Reading the steps

The `value` on each step is a full `Value`, with its type and unit, not a bare
number. Format it however you format any other result, for instance with
[`formatValue`](/guide/formatting/):

```ts
import { formatValue } from "solve-engine/format";

const explanation = engine.explainLine("5 km + 300 m");
explanation.steps.map((s) => `${s.description} = ${formatValue(s.value)}`);
// ["5 km plus 300 m = 5.30 km"]
```

Precedence is visible in the order the steps come out. Multiplication taken
before the addition around it reads as two steps, the product first:

```ts
engine.explainLine("2 + 3 * 4").steps.map((s) => s.description);
// ["3 times 4", "2 plus 12"]
```

## How a date was read

An all-numeric date can mean two different days. `03/04/2026` is the 3rd of
April in most of the world and the 4th of March in the United States, and the
answer does not say which it chose, because a formatted date looks the same
either way to a reader who has not noticed the month. That reading leads the
derivation, ahead of the arithmetic that used it:

```ts
engine.explainLine("03/04/2026 + 1 day").steps.map((s) => s.description);
// ["03/04/2026 read as 3 April 2026, day first, the default for a slash date. Month first would be 4 March 2026."]
```

A step appears only where the reading is worth remarking on: the two orders
name different real days, a two-digit year was widened to a century, or the
literal could not be read at all and the line reports why. A date that has only
one reading adds nothing, so an ISO date (`2026-04-03`) and a spelled-out month
(`3 April 2026`) derive exactly as they did before.

To put the same account behind a hover on the literal itself rather than under
the line, `readDates` returns one record per date with the span it occupies and
no evaluation at all:

```ts
engine.readDates("31/12/2026 - 01/01/2026");
// [{ text: "31/12/2026", start: 0, end: 10, iso: "2026-12-31", ... },
//  { text: "01/01/2026", start: 13, end: 23, iso: "2026-01-01", ... }]
```

Each record carries `note`, the same sentence the step shows, and `needsNote`,
the boolean to branch on. Showing the note on every date is wallpaper in a
diary where most lines are already unambiguous; showing it on none leaves the
reader to guess. See [date literals](/syntax/date-literals/) for the orders
themselves and `getDateReading()`.

## When there is nothing to break down

A bare literal has no derivation, and neither does a line built from a construct
this feature does not cover yet (function calls, matrices, conversions). In both
cases `explainLine` still reports the answer, with an empty `steps` array,
rather than raising:

```ts
const explanation = engine.explainLine("sqrt(16) + 2");
explanation.steps;             // []
explanation.result.toNumber(); // 6
```

A line that does not evaluate at all throws an `EngineError`, the same as
`evaluateExpression` does.

## What it covers

The derivation covers the common cases: arithmetic with its precedence and
associativity, parentheses, percentages (`+ 20%`, `20% off`, `20% on`, `20% of`)
and quantities in units and money, plus how each date literal on the line was
read. Deeper derivations (function calls, date arithmetic, matrices and symbolic
algebra) are deferred: those lines report their answer without a breakdown
rather than a partial one.
