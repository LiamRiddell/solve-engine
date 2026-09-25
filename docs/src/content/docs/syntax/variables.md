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

A bare name also works, and behaves as the colon form does while the note is
edited: change the value a name is given, and every line that uses it follows.

```solve
count = 10
count + 5 // 15
```

That includes another bare definition, so changing `deposit` below updates
`payment`.

```solve-doc
deposit = 100
payment = deposit * 40 // 4,000
```

A name can be a letter that is also a unit symbol, `m` for mass or `s` for
distance, as a physics formula would write it. A unit is always written after a
value (`9.81 m/s^2`), so where a name stands on its own, at the start of a line or
after an operator, it is read as your variable:

```solve-doc
m = 3
s = 2
m/s^2 // 0.75
9.81 m/s^2 // 9.81 m/s²
```

A slash is an operator too, and a bare unit after one is otherwise read as a
rate: `100 / t` on its own is a hundred per tonne. When a variable of that name
is defined above the line, the slash divides by it instead, as it would by any
other name:

```solve-doc
distance = 120
t = 2
speed = distance / t // 60
```

What decides it is the line above, so defining or deleting `t` changes the
answer of every line that divides by it. A unit written before the slash keeps
the rate whatever the name holds, because a unit after a value is a unit:
`$15 / h`, `60 km / h` and `100 per h` are rates even with `h` defined.

```solve-doc
h = 4
100 / h // 25
$15 / h // 15.00 USD/h
60 km / h // 60.00 km/h
```

A name that was never defined is an error, and when it is one or two letters
from a name that was, the error says so rather than quietly using it:

```solve-doc
budget = 100
budgte * 2 // ERROR: Undefined variable: budgte. Did you mean budget?
sqr(16) // ERROR: Undefined function: sqr. Did you mean sqrt?
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

`*=` and `/=` do the same by multiplying and dividing, for a balance that grows by
a rate or a quantity cut down in place. Money stays exact to the penny and a unit
stays its unit.

```solve
:balance = $1000
balance *= 1.05 // $1,050.00
balance *= 1.05 // $1,102.50
```

```solve
:length = 10 m
length /= 4 // 2.50 m
```

There is no starting value for a product: zero would make every product zero, so
a first `*=` or `/=` on a name that has not been set is refused as an undefined
variable, where `+=` and `-=` start from zero.

The compound forms apply to bare names, not the colon `:name` or `global :name`
grammars, and the right-hand side keeps its own precedence, so `budget -= 1 + 2`
subtracts three and `balance *= 1 + 0.05` multiplies by 1.05.

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
