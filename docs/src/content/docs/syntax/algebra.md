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

## Solving

`solve` takes an equation and the unknown to solve for.

```solve
solve(2x+6=0, x) // -3
solve(x^2-4=0, x) // [-2, 2]
solve(x^2-3x+2=0, x) // [1, 2]
solve(3x-1=0, x) // 1/3
```

A missing right-hand side means zero, so `solve(x^2-4, x)` asks the same
question.

```solve
solve(x^2-4, x) // [-2, 2]
```

### Exact answers, including irrational ones

An irrational root is given as a square root rather than a decimal, in lowest
form.

```solve
solve(x^2-2=0, x) // [-sqrt(2), sqrt(2)]
```

Roots that are not rational and not expressible this way are approximated, and
only after every exact method has been tried.

### Answers that are not numbers

Some equations have a correct answer that is not a list of roots.

```solve
solve(x^2+1=0, x) // no real solutions (the discriminant is negative, so both roots are complex)
solve(1=2, x) // no solution
```

`x^2+1=0` has no real solutions because both of its roots are complex, and
complex numbers are not supported. Solving in terms of another unknown works
when the equation is linear in the one being solved for.

```solve
solve(a*x+b=0, x) // -b/a
```

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
