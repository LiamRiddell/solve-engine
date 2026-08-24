---
title: Calculus
description: Derivatives, integrals, Taylor series and Jacobians of symbolic expressions.
---

> **Package:** `SYMBOLIC_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

Calculus here is genuinely symbolic: the rules are applied to the expression
itself, so the answers are exact rather than numerical approximations.

## Derivatives

`der(expression, variable)` differentiates. `derivative` is the same function
under a longer name.

```solve
der(x^3, x) // 3x^2
der(x^3+x, x) // 3x^2+1
der(sin(x), x) // cos(x)
derivative(exp(x), x) // exp(x)
```

A third argument repeats the differentiation.

```solve
der(x^3, x, 2) // 6x
der(x^3, x, 3) // 6
```

The product, quotient and chain rules all apply, so composed expressions work
without anything special.

```solve
der(x*y, x) // y
```

A function whose derivative is not known is left as an unevaluated `der` call
rather than guessed at.

## Integrals

`integral(expression, variable)` finds an indefinite integral. The constant of
integration is left off, as is conventional for a calculator.

```solve
integral(x^2, x) // 1/3x^3
integral(3x^2+2x+1, x) // x^3+x^2+x
integral(cos(x), x) // sin(x)
integral(1/x, x) // log(x)
```

### Rational functions

Any quotient of polynomials is integrable, and this is the one family where that
is a guarantee rather than a table lookup. There is no single rule for a
rational function, so it is first split into
[partial fractions](/syntax/algebra/), and each of those pieces does have a
rule: a logarithm, a power, or an arctangent.

```solve
integral((3x+5)/(x^2-1), x) // 4*log(x-1)-log(x+1)
integral(x^2/(x^2+1), x) // x-atan(x)
integral(1/(x-1)^2, x) // -1/(x-1)
integral(1/(x^2+2x+2), x) // atan(x+1)
```

The one shape left out is a denominator with a repeated irreducible quadratic
factor, such as `1/(x^2+1)^2`, which needs a reduction formula rather than the
three rules above.

### What integration cannot do

Unlike differentiation, integration has no method that always succeeds. Many
ordinary-looking expressions have no elementary antiderivative at all, and for
those this says so rather than returning something approximate.

```solve
integral(exp(x^2), x) // Cannot integrate this: no elementary antiderivative is known for this expression.
```

That is deliberate. A wrong integral is indistinguishable from a right one
wherever it gets used, so reporting the limit is more useful than hiding it.

What is covered: any polynomial, a constant, any rational function whose
denominator has no repeated irreducible quadratic factor, the standard functions
`exp`, `sin`, `cos` and `log` applied to a linear argument, sums of any of
those, and a constant multiple of any of those.

## Taylor series

`taylor(expression, variable = point, degree)` expands about a point.

```solve
taylor(exp(x), x=0, 4) // 1/24x^4+1/6x^3+0.5x^2+x+1
taylor(sin(x), x=0, 5) // 1/120x^5-1/6x^3+x
```

The coefficients are exact, because each one is a derivative evaluated at the
point and then divided by a factorial, all in exact arithmetic. A series whose
coefficients would not come out exactly is reported rather than rounded.

## Jacobians

`jacobian(f1, f2, ...)` builds the matrix of partial derivatives, one row per
function. The variables are taken from the functions themselves, in alphabetical
order.

```solve
jacobian(x*y, x+y) // [y, x; 1, 1]
```
