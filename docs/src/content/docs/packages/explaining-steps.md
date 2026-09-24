---
title: Explaining your steps
description: Describe your package's own calls as readable steps when a host explains a line.
---

A host can ask the engine how a line reached its answer with
[`explainLine`](/guide/explaining-lines/), and put the steps behind a hover or a
"how was this worked out" disclosure. The engine derives arithmetic on its own.
Anything a package adds, a function, an `as` converter, a phrase that calls a
builtin, is a black box to it: it knows what went in and what came out, not what
happened in between, or how to say it.

The `explain` field is how a package fills that in. The engine hands it each
call the line made, with the arguments and the result it actually used, and the
package answers with the steps between them.

## A worked example

Here is a `vat` function made with [`defineFunction`](/packages/authoring-a-package/#the-quick-path-one-function),
and the same package with a hook added. `defineFunction` returns an ordinary
package object, so the hook is one more field on it:

```ts
import { createEngine, defineFunction, type IEnginePackage } from "solve-engine";

const vat = defineFunction({
  name: "vat",
  args: [{ name: "amount", type: "number" }],
  returns: "number",
  call: (amount) => amount * 1.2,
});

const vatWithSteps: IEnginePackage = {
  ...vat,
  explain: (call, { format }) =>
    call.kind === "plugin" && call.name === "vat"
      ? [{ description: `${format(call.args[0])} plus 20% VAT`, value: call.result }]
      : undefined,
};

const engine = createEngine({ extraPackages: [vatWithSteps] });
engine.explainLine("vat(100) + 5").steps.map((s) => s.description);
// ["100 plus 20% VAT", "120 plus 5"]
```

The engine placed the step: the call first, since its result is an operand of
the sum, then the sum itself, reading the call by the value it arrived at. Your
hook describes your call and nothing else.

| Line | Without a hook | With it |
| --- | --- | --- |
| `vat(100) + 5` | no steps | `100 plus 20% VAT = 120`, `120 plus 5 = 125` |

Without the hook the line has no steps at all, not the sum alone: a derivation
with a gap where your call was would read as though `120` came from nowhere, so
the engine reports the answer on its own instead.

## The contract

```ts
explain?: (call: ExplainCall, context: ExplainContext) => readonly ExplanationStep[] | undefined;
```

The hook is called once for each call the line made, in the order the engine
made them, and returns the steps from `call.args` to `call.result`, or
`undefined` to decline.

### What you are handed

`ExplainCall` names the call and carries its values:

| Field | Meaning |
| --- | --- |
| `kind` | `"plugin"`, `"converter"`, `"builtin"` or `"conversion"` |
| `name` | which one: see below |
| `args` | the values the call was given, in the order it declares them |
| `result` | the value it produced, the same object the rest of the line used |

What `name` holds depends on `kind`:

- `"plugin"`: the name your package registered the function under in
  `pluginFunctions` (`"vat"` above).
- `"converter"`: the name in your `asConverters`, lower-cased (`"roman"` for
  `10 as roman`).
- `"builtin"`: one of the engine's built-in functions by its function name,
  `"sqrt"`, `"round"`, `"presentValue"`, `"loanRepayment"`. A finance phrase and
  a function call can reach the same builtin, so a hook for `presentValue`
  describes both `present value of $1,000 after 5 years at 5%` and the call form.
- `"conversion"`: a unit, rate or currency conversion, named by the table that
  answered it: `"measure"` (`5 km in miles`), `"rate"` (`60 km/h in mph`) or
  `"currency"` (`100 EUR in USD`). The single argument is the source quantity in
  its own unit, and the target unit is `call.result.unit`.

`ExplainContext` formats values the way the engine's own steps do:

| Method | Gives |
| --- | --- |
| `format(value)` | a value as the display shows it, without the leading `= `: `$1,000.00`, `5.00 km`; a plain number to six significant figures, so `3.14159` is not shown as `3.14` in the step that rounds it |
| `formatNumber(n)` | a bare number to six significant figures, never fewer than its whole part: `0.621371`, `1,609.34`, `100,000` |

### Who is asked

A plugin function or a converter is offered only to the package that
registered it, so a hook never has to check that a `"plugin"` call is really
its own. A builtin or a conversion belongs to the engine and is offered to
every package with a hook, the most recently registered first, and the first
valid answer is used. That is the same "later registration wins" rule a
clashing plugin name follows, and it means a package registered through
`extraPackages` can override how a built-in step reads.

### What a valid answer is

- **The last step carries `call.result` itself**, the same object, not a copy
  and not a recomputation. An answer that ends anywhere else is discarded and
  the next package is asked, because a derivation that does not arrive at the
  answer is worse than none.
- **Every number a step shows is one the engine computes**, by the same
  function your call used. The built-in finance hook imports its growth and
  amortisation formulas from the module the finance builtins compute through,
  so the factor a step shows is the factor the answer was divided by, to the
  last digit.
- **It does not throw.** A hook that throws is treated as having declined.

A step is `{ description, value }`. `description` is prose for the person
reading the note: say what happened in words, and put any number that needs
more precision than the display gives into the sentence (`1 km is 0.621371
miles`), since a host renders `value` at the display's two decimal places.

## Where your steps go

The engine lays out the derivation and slots your steps into it:

- **Inside arithmetic**, a call's steps come where its result is first needed,
  after any arithmetic in its arguments: `sqrt(9 + 7) * 2` reads `9 plus 7`, then
  the square root, then `4 times 2`.
- **As the whole line**, a line the arithmetic tree cannot hold (a conversion,
  a phrase) is told as the chain of calls it made, provided every call's result
  feeds a later call and the last call's result is the answer. `round(5 km in
  miles, 1)` reads as the conversion and then the rounding.

If any call in the line is left undescribed, or the calls do not account for
the whole answer (`round(5 km in miles + 1 mile, 1)` has a sum between them that
is not a call), the line gets no steps rather than some of them.

## The boundary

- **Only calls.** The hook sees the calls a line makes, never the arithmetic
  operators between them, which the engine derives itself.
- **Only when asked.** Ordinary evaluation never calls a hook. The engine runs
  the line once more, with calls recorded, only inside `explainLine`, so a
  package pays nothing for describing itself until a host asks.
- **Not a line that waits for data.** A line that resolves asynchronously (a
  live rate, an async plugin) cannot be explained: `explainLine` refuses it with
  `EXPLAIN_ASYNC_UNSUPPORTED`, since a pending value has no steps.
- **English prose.** Steps are written for an English reader and formatted with
  the engine's default number style; they are not localised.

## References in the source

Three built-in packages carry hooks worth reading alongside this page:
`packages/uom/UomExplain.ts` (conversions, including the offset a temperature
scale needs), `packages/function/FunctionExplain.ts` (one sentence per
function), and `packages/finance/FinanceExplain.ts` (multi-step derivations
built from the same formulas the builtins use).
