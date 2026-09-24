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
explanation.steps.map((s) => `${s.description} ${formatValue(s.value)}`);
// ["5 km plus 300 m = 5.30 km"]  (formatValue already prefixes "= ")
```

Precedence is visible in the order the steps come out. Multiplication taken
before the addition around it reads as two steps, the product first:

```ts
engine.explainLine("2 + 3 * 4").steps.map((s) => s.description);
// ["3 times 4", "2 plus 12"]
```

## Conversions, functions and phrases

A conversion, a function call or a finance phrase is not arithmetic the engine
can read off the line: each is a call into a package, and only that package
knows what happened between the numbers that went in and the one that came
out. So each package describes its own step, through the
[`explain` hook](/packages/explaining-steps/), and the engine places those steps
in the derivation:

```ts
engine.explainLine("5 km in miles").steps.map((s) => s.description);
// ["1 km is 0.621371 miles", "5 times 0.621371"]

engine.explainLine("sqrt(16) + 2").steps.map((s) => s.description);
// ["the square root of 16", "4 plus 2"]

engine.explainLine("present value of $1,000 after 5 years at 5%").steps.map((s) => s.description);
// ["5% a year for 5 years: (1 plus 5%) to the power of 5 is 1.27628", "$1,000.00 divided by 1.27628"]
```

| Line | Before | Now |
| --- | --- | --- |
| `5 km in miles` | no steps | the factor, then the multiplication by it |
| `sqrt(16) + 2` | no steps | the square root, then the sum |
| `present value of $1,000 after 5 years at 5%` | no steps | the growth factor, then the division by it |

Every number in those sentences is the engine's own. The conversion factor is
what the engine's conversion gives for one kilometre, and the growth factor is
computed by the same function the present-value builtin divides by, so a
reader checking a step with a calculator arrives where the engine did. A number
that needs more precision than the display's two decimal places, a factor or a
monthly rate, is written into the sentence to six significant figures, since
the step's `value` is shown the way any answer is.

A call inside an argument is worked out before the call that takes it, and a
minus in front of a call or a group is a step of its own:

```ts
engine.explainLine("-sqrt(9 + 7)").steps.map((s) => s.description);
// ["9 plus 7", "the square root of 16", "the negative of 4"]
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

## Explaining changes nothing

A host calls `explainLine` whenever the reader points at a line, so it has to be
safe to call as often as that. Some lines change the document when they run: a
running total (`total += 5`) adds to its total, an assignment (`:x = 30`) sets a
variable, a unit definition (`1 sprint = 2 weeks`) adds a unit, and a global
(`global :rate = 0.2`) is shared with every open document. A derivation has to
run the line to know the values it arrives at, so the run happens in a scratch
copy of the document's state that is thrown away afterwards. However often a
line is explained, no variable, total, function, equation, unit or global moves.

```ts
engine.parseDocument("total += 5");

engine.explainLine("total += 5").result.toNumber(); // 10
engine.explainLine("total += 5").result.toNumber(); // 10
engine.evaluateExpression("total").toNumber();      // 5
```

The answer is the one the line gives against the document as it stands, the
same one `evaluateExpression` returns for it (which, unlike `explainLine`, keeps
the change). For a running total that is the next total, not the total at the
line's own place in the document: with the total at 5, explaining `total += 5`
answers 10.

## Where a live figure came from

A converted amount is only as good as its rate, and the rate is not on the line.
When an answer depends on a live figure, the derivation ends with a step per
figure naming the provider, how the figure was obtained, and when (see
[where a live value came from](/guide/async-and-live-data/#where-a-live-value-came-from)):

```ts
currencyExchangeService.primeRates("USD", { GBP: 0.741 }, {
  provider: "Treasury feed",
  publishedAt: Date.parse("2026-09-23T16:02:00Z"),
});
engine.explainLine("10 USD in GBP").steps.map((s) => s.description);
// ["USD/GBP from Treasury feed (supplied by the host), fetched 2026-09-23 16:02 UTC"]
```

A rate the engine fetched itself reads `(live)`, and a rate for a past day names
the day. A [frozen answer](/syntax/frozen-answers/) leads with a step saying when
it was frozen, and each source says so too. The times are in UTC so a derivation
reads the same wherever it is produced; the epoch values are on the answer for a
host that wants local time. Like a date reading, each of these steps carries the
line's answer, since a source is a fact about the answer rather than a value of
its own. Explaining a frozen line never freezes it: an explanation is a look at
the line, not an evaluation of the document.

## When there is nothing to break down

A bare literal has no derivation, and neither does a line built from a construct
the derivation does not cover (a comparison, a matrix). In both cases
`explainLine` still reports the answer, with an empty `steps` array (apart from
the source steps above, when the answer depends on a live figure), rather than
raising:

```ts
const explanation = engine.explainLine("(2 + 3) > 4");
explanation.steps;             // []
explanation.result.toNumber(); // 1
```

A derivation is never partial. If one call on the line has no description, or
the calls a line made leave an operation out, the line gets no steps rather
than some of them. In `round(5 km in miles + 1 mile, 1)` the sum between the
conversion and the rounding is not a call, so describing the two calls would
skip it, and the line reports `4.1 miles` alone.

A line that does not evaluate at all throws an `EngineError`, the same as
`evaluateExpression` does.

## What it covers

The derivation covers arithmetic with its precedence and associativity,
parentheses, a minus in front of a group, percentages (`+ 20%`, `20% off`,
`20% on`, `20% of`) and quantities in units and money, plus how each date
literal on the line was read and where each live figure came from. Through the
built-in packages' hooks it covers unit, rate and currency conversions, the
named functions (`sqrt`, `round`, `max`, the trigonometric and logarithmic
functions, and the rest), and the finance forms: compound growth, present value,
loan repayments and interest, return on investment, and sales tax. A package of
your own adds its steps the same way; see
[explaining your steps](/packages/explaining-steps/).

Date arithmetic, matrices and symbolic algebra are not covered, and report
their answer without a breakdown. A line that waits for data (a live rate, an
async plugin) cannot be explained at all and throws `EXPLAIN_ASYNC_UNSUPPORTED`,
because a pending value has no steps to show.

`explainLine` accounts for the arithmetic on one line. Which *other* lines a
result took its numbers from is a separate question, answered by
[tracing](/guide/tracing-lines/).
