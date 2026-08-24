---
title: Quick start
description: Evaluating your first expressions, and evaluating a whole document.
---

The engine has two entry points. One evaluates a single expression. The other
evaluates a document, which is what you want when lines refer to each other.

## A single expression

```ts
import { createEngine } from "solve-engine";

const engine = createEngine("en");
const [result] = engine.evaluateExpression("50% of 200");

result.toNumber(); // 100
```

`evaluateExpression` returns an array because one line can contain several
inline results. For a plain expression you want the first entry.

## Formatting the result

A value carries a type, a raw payload, and optionally a unit. Turning it into
the string a person should see is a separate step, so you can substitute your
own presentation.

```ts
import { formatValue } from "solve-engine/format";

const [value] = engine.evaluateExpression("100cm + 2m");
formatValue(value); // "= 300.00 cm"
```

The leading marker is a display convention for an editor gutter. Strip it if you
are rendering somewhere else.

## A document

Variables, line references and aggregates only mean something in the context of
a document, so those need `evaluateLine` with real line numbers.

```ts
const engine = createEngine("en");

engine.evaluateLine(1, ":subtotal = 100");
engine.evaluateLine(2, ":tax = 20% of :subtotal");
const [total] = engine.evaluateLine(3, ":subtotal + :tax");

total.toNumber(); // 120
```

Line numbers matter. They are how the engine tracks which lines depend on which,
so that editing line one re-evaluates lines two and three and nothing else.

## Handling failure

An expression that cannot be evaluated does not throw for ordinary user error.
It produces a value whose type says so, which is the right behaviour when input
is being typed one character at a time and is invalid most of the way.

```ts
import { ValueType } from "solve-engine/vm";

const [value] = engine.evaluateExpression("10 +");
value.type === ValueType.Error;
```

Read [core concepts](/getting-started/concepts/) next for the mental model, or go
to the [syntax reference](/syntax/cheatsheet/) for what you can write.
