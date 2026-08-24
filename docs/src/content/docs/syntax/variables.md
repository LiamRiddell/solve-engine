---
title: Variables
description: Defining values, reading them back, and user-defined functions.
---

> **Package:** `VARIABLES_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

A colon prefix marks a definition explicitly.

```solve
:subtotal = 100
:subtotal * 2 // 200
```

A bare name also works.

```solve
count = 10
count + 5 // 15
```

## Running totals

`+=` and `-=` update a named total in place, so a note becomes a running balance
where each line adjusts the last.

```solve
:budget = 500
budget -= 120 // 380
budget -= 63 // 317
budget // 317
```

A first `+=` or `-=` on a name that has not been set yet starts it at zero, so a
ledger can open straight into a spend.

```solve
spent += 40 // 40
spent += 12 // 52
```

The compound forms apply to bare names, not the colon `:name` or `global :name`
grammars, and the right-hand side keeps its own precedence, so `budget -= 1 + 2`
subtracts three.

## Functions

```solve
f(x) = 2*x + 1
f(5) // 11
```

Parameters are scoped to the call, so a parameter named `x` never disturbs a
variable named `x` defined elsewhere in the document.

```solve
:x = 100
double(x) = x * 2
double(5) // 10
```
