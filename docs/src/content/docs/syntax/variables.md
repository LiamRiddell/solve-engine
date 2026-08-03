---
title: Variables
description: Defining values, reading them back, and user-defined functions.
---

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
