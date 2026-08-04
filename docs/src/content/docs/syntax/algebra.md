---
title: Algebra
description: Multiplying out an expression, and working with exact coefficients.
---

Algebra works on expressions containing unknowns. Unlike
[symbolic evaluation](/syntax/symbolic/), these do not need a trailing arrow:
asking to expand something already says its unknowns are meant to stay unknown.

## Expanding

`expand` multiplies out every product and power, then collects like terms.

```solve
expand((x+1)*(x+2)) // x^2+3x+2
expand((x+1)^3) // x^3+3x^2+3x+1
expand((x+y)^2) // x^2+2x*y+y^2
```

Terms come out in descending degree, so an expression always reads the way it
is conventionally written and two equal expressions always render identically.

## Factoring

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

### Factoring over what

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

Factoring in more than one variable stops after any shared constant and
variable have been taken out.

## Exact coefficients

Coefficients are exact rationals, not floating-point numbers. In ordinary
floating point `0.1 + 0.2` is `0.30000000000000004`; here it is not.

```solve
0.1x + 0.2x => // 0.3x
x/3 + x/3 =>   // 2/3x
```

A fraction that cannot be written as a short decimal stays a fraction rather
than being rounded into one.

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
