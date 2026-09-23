---
title: Calculus
description: Derivatives, integrals, limits, Taylor series and Jacobians of symbolic expressions.
---

> **Package:** `SYMBOLIC_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

Derivatives, indefinite integrals, Taylor series and Jacobians here are
genuinely symbolic: the rules are applied to the expression itself, so the
answers are exact rather than numerical approximations.

A definite integral and a limit are different in kind. Each asks for a number
rather than an expression, and each is worked out exactly where the algebra
reaches and numerically where it does not. Their sections below say which
answers are which.

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

`integral(expression, variable)` finds an indefinite integral, the expression
whose derivative is the one given. The constant of integration is left off, as
is conventional for a calculator. With two bounds after the variable it is a
[definite integral](#definite-integrals) instead, an area.

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
[partial fractions](/syntax/splitting-fractions/), and each of those pieces does have a
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

## Definite integrals

A definite integral measures the area between a curve and the horizontal axis,
from one value of the variable to another: the distance travelled under a speed
curve, say, or the total that builds up from a rate. Area below the axis counts
as negative. The answer is a number, not an expression, and the two values it
runs between (the bounds) follow the variable.

```solve
integral(x^2, x, 0, 3) // 9
integral(x^2, x, 0, 1) // 1/3
integral(3x^2+2x+1, x, 0, 1) // 3
integral(x^2, x, 3, 0) // -9
```

Running from the larger bound to the smaller one, as the last line does,
reverses the sign. That is the convention, and it keeps two ranges that meet end
to end adding up.

### Exactly, through the antiderivative

Where an indefinite integral exists, the area is its value at the upper bound
minus its value at the lower bound, and that is worked out in exact arithmetic:
the 9 above is `3^3/3 - 0^3/3`, and a fraction stays a fraction. Where the
antiderivative involves a function whose value is irrational, such as `sin(1)`,
the difference is evaluated to double precision, the same accuracy as `sin(1)`
anywhere else.

```solve
integral(sin(x), x, 0, pi) // 2
integral(cos(x), x, 0, 1) // 0.84
integral(1/(1+x^2), x, 0, 1) // 0.79
```

### Numerically, where there is no antiderivative

`exp(x^2)` has no elementary antiderivative, so its indefinite integral is
refused above. The area under it between two bounds is still a perfectly good
number, and it is found numerically instead.

```solve
integral(exp(x^2), x, 0, 1) // 1.46
integral(sin(x)/x, x, 0, 1) // 0.95
```

The method is adaptive Gauss-Kronrod quadrature. It samples the curve at
carefully chosen points and weights the samples, in two ways at once, so the gap
between the two results says how accurate each is. Wherever that gap is too
large the range is split and sampled again, until the estimated error is below
one part in ten billion of the answer. An answer found this way is approximate,
in the same sense as the numeric roots on the
[solving equations](/syntax/solving-equations/) page, and it is given only once
its error estimate is that small.

`sin(x)/x` has no value at zero, where it is `0/0`, but it settles on 1 there
from both sides. A point like that is a gap in the formula rather than in the
curve, and it is filled with the value the curve settles on.

### What a definite integral refuses

The antiderivative shortcut is only valid when the curve is finite across the
whole range. `-1/x` is an antiderivative of `1/x^2`, and it gives -2 between -1
and 1, but the curve shoots up to infinity at zero, so the area there is not
-2, and not any number. An integral like that, whose curve has no finite value
somewhere in the range, is called improper, and it is refused by name rather
than answered.

```solve
integral(1/x, x, 0, 1) // Cannot integrate this: the integrand has no finite value at x = 0, the lower bound, so this is an improper integral.
integral(1/x^2, x, -1, 1) // Cannot integrate this: the integrand has no finite value at x = 0, inside the range, so this is an improper integral.
```

The antiderivative is trusted on its own only for a curve that cannot have such
a point anywhere, such as a polynomial or `sin` of one. For anything else the
numeric estimate is made as well, and the antiderivative's answer is given only
when the two agree. An integral whose numeric estimate never settles, which is
what a curve climbing without bound inside the range looks like, is refused too:

```solve
integral(tan(x), x, 0, 2) // Cannot integrate this: the numeric estimate does not settle on a value; the integrand may grow without bound near x = 1.570796327, which would make the integral diverge.
```

Deliberately not covered: a bound of infinity, and an improper integral that
does happen to converge, such as `1/sqrt(x)` from 0 to 1 (whose area is 2).
Both need a limit taken at the edge of the range, which is a different
calculation from an area over a finite range, and a wrong one would look exactly
like a right one. An integrand with a second unknown in it is refused, as it is
by the indefinite integral. And like any numeric method, the quadrature can only
see what it samples: a spike narrower than the gaps between its sample points
can be missed.

## Limits

A limit is the value an expression settles towards as its variable gets closer
and closer to a point, whether or not the expression has a value at the point
itself. `sin(x)/x` is `0/0` at zero, which means nothing as written, but just
either side of zero it is almost exactly 1, and closer still it is closer to 1,
so its limit at zero is 1.

`limit(expression, variable, point)` takes the expression, the variable, and
the point it approaches.

```solve
limit(sin(x)/x, x, 0) // 1
limit((x^2-1)/(x-1), x, 1) // 2
limit((1-cos(x))/x^2, x, 0) // 0.50
limit((1+x)^(1/x), x, 0) // 2.72
```

A quotient of polynomials, like the second line, is exact: it is reduced to
lowest terms, which turns `(x^2-1)/(x-1)` into `x+1`, and the result is
evaluated at the point. Everything else is numeric. The expression is evaluated
closer and closer to the point from each side, and the trend in those values is
extrapolated to the point itself, which reads off the limit before the values
get close enough for rounding to spoil them. A numeric limit is approximate, and
one that is a whole number to within its own error is shown as that whole
number.

### When there is no limit

A limit exists only when both sides settle on the same finite value. Each of the
ways that can fail is its own error, never a number.

```solve
limit(abs(x)/x, x, 0) // The limit does not exist: from the left it approaches -1 and from the right 1 as x approaches 0.
limit(1/x^2, x, 0) // The limit does not exist: it grows without bound, towards +∞ from both sides, as x approaches 0.
limit(sin(1/x), x, 0) // The limit does not exist: the values do not settle on one number as x approaches 0; they may oscillate, as sin(1/x) does at 0.
```

The first error names what each side approaches, which is also how to read a
one-sided limit: there is no separate form for approaching from one side only.
A side on which the expression has no real value at all is left out, so the
limit of `sqrt(x)` at zero is taken from the right alone.

```solve
limit(sqrt(x), x, 0) // 0
```

Not covered: a limit as the variable grows without bound (at infinity), and an
expression with a second unknown in it.

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
