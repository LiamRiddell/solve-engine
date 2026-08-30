---
title: "Expanding"
description: Multiplying out an expression and collecting like terms.
---

> **Package:** `SYMBOLIC_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

Expanding takes an expression written as a product, like `(x+1)*(x+2)`, and
multiplies it out into a sum of terms. It is the everyday algebra of removing
brackets, done for you. Unlike [symbolic evaluation](/syntax/symbolic/), this
does not need a trailing arrow: asking to expand something already says its
unknowns are meant to stay unknown.

`expand` multiplies out every product and power, then collects like terms.

```solve
expand((x+1)*(x+2)) // x^2+3x+2
expand((x+1)^3) // x^3+3x^2+3x+1
expand((x+y)^2) // x^2+2x*y+y^2
```

Terms come out in descending degree, so an expression always reads the way it
is conventionally written and two equal expressions always render identically.

## What expanding does not do

`expand` leaves anything that is not a polynomial alone rather than reporting an
error, since there is nothing to multiply out but nothing wrong either.

```solve
expand(sin(x)) // sin(x)
```

Division by an unknown makes an expression a rational function rather than a
polynomial, so it is also left as written.

```solve
expand(x/y + 1) // x/y+1
```
