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

## Pi, e and the other irrational constants

Pi is irrational: no fraction equals it, so the engine holds it as the
sixteen-digit decimal nearest to it, and `x^2 - pi` is a polynomial over that
long fraction. A quadratic is decided without any searching: it has a rational
root exactly when the number under the square root in the quadratic formula (its
discriminant, `b^2 - 4ac`) is the square of a fraction. For `x^2 - pi` it is
`4pi`, which is not, so the answer is the polynomial as written, as it is for
`x^2 - 2`. A shared variable still comes out in front.

```solve
factor(x^2 - pi) // x^2-3.1415926536
factor(x^2 - e) // x^2-2.7182818285
factor(x^2 + pi*x) // x*(x+3.1415926536)
factor((x - pi)^2) // (x-3.1415926536)^2
```

A cubic or anything higher has no such shortcut. Finding its rational roots
means trying every fraction whose top divides the last coefficient and whose
bottom divides the first, and the divisors of pi's sixteen-digit fraction are
too many to list, so it is refused rather than guessed at. Leaving it whole would
claim it has no rational factor, which was never checked. `solve` finds its roots
as decimals instead.

```solve-doc
factor(x^3 - pi) // ERROR: This polynomial cannot be factored: a number in it is too long as a fraction (as pi and e are) to try every fraction that could be a root. solve finds its roots as decimals.
solve(x^3 = pi, x) // [-0.7322959438-1.2683737808i, -0.7322959438+1.2683737808i, 1.46]
```

Pi squared, typed as `pi^2`, is rounded to a double of its own, which is not
exactly the square of pi's double, so `x^2 - 2*pi*x + pi^2` stays as written
where `(x - pi)^2`, which is expanded exactly, factors back.

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
