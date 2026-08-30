---
title: "Factoring"
description: Writing a polynomial as a product of simpler factors.
---

> **Package:** `SYMBOLIC_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

Factoring is the reverse of [expanding](/syntax/expanding/): it takes a
polynomial written out as a sum, like `x^2+3x+2`, and rewrites it as a product
of simpler pieces, like `(x+1)*(x+2)`. It is how you find the values that make an
expression zero, and how a fraction of polynomials reveals what cancels. Like the
other algebra forms, this does not need a trailing arrow.

`factor` is the inverse: it writes a polynomial as a product.

```solve
factor(x^2-4) // (x-2)*(x+2)
factor(x^2+3x+2) // (x+1)*(x+2)
factor(x^2-2x+1) // (x-1)^2
factor(2x^2+4x) // 2x*(x+2)
factor(x^3-1) // (x-1)*(x^2+x+1)
```

A repeated root becomes a power rather than a repeated factor, and a shared
constant or variable comes out in front.

## Factoring over what

Factoring only means something once you say over which numbers. `x^2-2` factors
over the real numbers as `(x-sqrt(2))(x+sqrt(2))`, and `x^2+1` factors only over
the complex numbers. Both are left alone here, because this factors over the
**rationals**.

```solve
factor(x^2-2) // x^2-2
factor(x^2+1) // x^2+1
```

That is an answer rather than a failure. A polynomial with no rational roots is
returned as-is, including in the cases where it would split into higher-degree
rational pieces, which are not searched for.

## More than one variable

Factoring in several variables at once is a much harder problem than in one, so
this recognises the standard shapes rather than running a general algorithm.

```solve
factor(x^2-y^2) // (x-y)*(x+y)
factor(x^3-8y^3) // (x-2y)*(x^2+2x*y+4y^2)
factor(x^2+2x*y+y^2) // (x+y)^2
factor(a*x+a*y+b*x+b*y) // (a+b)*(x+y)
```

A difference of squares, a sum or difference of cubes, a perfect-square
trinomial, and four terms that group into two pairs. Anything else stops after
any shared constant and variable have been taken out.

```solve
factor(x^2+3x*y+y^2) // x^2+3x*y+y^2
```
