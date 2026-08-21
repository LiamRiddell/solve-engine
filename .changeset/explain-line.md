---
"solve-engine": minor
---

A line can now explain how it reached its answer.

`explainLine(expression)` returns a readable derivation: the operations of a line
in the order the engine evaluates them, each with the value it arrives at. It is
for the person reading the note, not the developer diagnostic pipeline, which
reports stages, opcodes and timings.

```
(20% off 80) + 20%    76.80

  80 less 20%      64
  64 plus 20%      76.80
```

The answer alone does not say whether the discount landed on the right side of
the sum; the derivation does. Each step carries the running value down into the
next, so a reader checks the engine's reading against their own without splitting
the expression across the document.

It is an API rather than an `explain` keyword: a host puts the derivation behind
a hover or a disclosure, and a keyword would shadow a prose word in a document
that mixes notes and arithmetic. Every value in a derivation is the engine's own
answer for that piece of the line, re-evaluated rather than re-derived, so
`explanation.result` always equals what `evaluateExpression` returns and no step
can disagree with the answer.

```ts
const explanation = engine.explainLine("(20% off 80) + 20%");
explanation.steps.map((s) => `${s.description} = ${s.value.toNumber()}`);
// ["80 less 20% = 64", "64 plus 20% = 76.8"]
```

The derivation covers the common cases: arithmetic with its precedence and
associativity, parentheses, percentages (`+ 20%`, `20% off`, `20% on`, `20% of`)
and quantities in units and money. A bare literal, or a line built from a
construct that is not covered yet (function calls, dates, matrices, symbolic
algebra), reports its answer with an empty step list rather than a partial or
misleading breakdown. A line that does not evaluate at all throws an
`EngineError`, the same as `evaluateExpression`.
