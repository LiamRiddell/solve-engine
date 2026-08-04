---
title: Calculus
description: Derivatives, integrals, Taylor series and Jacobians of symbolic expressions.
---

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

### What integration cannot do

Unlike differentiation, integration has no method that always succeeds. Many
ordinary-looking expressions have no elementary antiderivative at all, and for
those this says so rather than returning something approximate.

```solve
integral(exp(x^2), x) // Cannot integrate this: no elementary antiderivative is known for this expression.
```

That is deliberate. A wrong integral is indistinguishable from a right one
wherever it gets used, so reporting the limit is more useful than hiding it.

What is covered: any polynomial, a constant, `1/x` and `1/(1+x^2)`, the standard
functions `exp`, `sin`, `cos` and `log` applied to a linear argument, sums of
any of those, and a constant multiple of any of those.

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
