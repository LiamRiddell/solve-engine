---
title: Embedding the engine
description: Creating an engine, configuring it, and reading results.
---

```ts
import { ExpressionEngine } from "solve-engine";

const engine = new ExpressionEngine("en");
```

The first argument is the locale, which decides decimal and thousands
separators and the ambiguous date order.

## Configuration

The second and third arguments enable diagnostics and override configuration.
Both are optional.

```ts
const engine = new ExpressionEngine("en", false, {
  validation: {
    maxExpressionLength: 1000,
    maxComplexity: 500,
  },
});
```

Safety limits exist because the engine is designed to run on untrusted input as
someone types. They bound expression length, parse complexity, instruction
count, stack depth, and how many elements a range or matrix may be expanded to
by `map`/`reduce` (`vm.maxCollectionSize`, 100000 by default, which is what
stops a typo like `sum(x, 1:100000000)` from allocating until the host runs out
of memory). Each produces a clear error rather than hanging.

## Reading a result

```ts
import { ValueType } from "solve-engine/vm";

const [value] = engine.evaluateExpression("2 + 2");

value.type;        // ValueType.Number
value.toNumber();  // 4
value.unit;        // undefined
```

## Clearing state

An engine accumulates variables and cached results. Call `clear()` to reset it
between documents rather than constructing a new one, which is cheaper.

```ts
engine.clear();
```
