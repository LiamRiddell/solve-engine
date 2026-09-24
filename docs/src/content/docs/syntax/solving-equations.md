---
title: "Solving equations"
description: Finding the values of an unknown that make an equation true, exactly where possible.
---

> **Package:** `SYMBOLIC_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

Solving an equation means finding the values of the unknown that make it true:
the `x` for which `2x+6=0`, or the two roots of `x^2-4=0`. The engine gives an
exact answer wherever one exists, a square root rather than a decimal, and falls
back to accurate decimals only when no exact form can be written. An equation
the algebra has no method for at all, such as `cos(x) = x`, is
[solved numerically](#equations-with-no-exact-method). Like the other algebra
forms, this does not need a trailing arrow.

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

## Writing the equation on its own line

An equation containing exactly one unknown can be written plainly, then solved
by asking for that unknown with an arrow. This is the same solver, reached a
different way.

```solve
x^2-4 = 0
x => // [-2, 2]
```

```solve
2x+1 = x+4
x => // 3
```

The unknown is whichever name has no value yet, so an equation can refer to
variables already defined above it.

```solve
:a = 2
a*n = 10
n => // 5
```

An equation with two unknowns is not stored, because there would be no way to
tell which one to solve for. Use `solve` and name it.

## Exact answers, including irrational ones

An irrational root is given as a square root rather than a decimal, in lowest
form.

```solve
solve(x^2-2=0, x) // [-sqrt(2), sqrt(2)]
```

Roots that are not rational and not expressible this way are approximated, and
only after every exact method has been tried.

A constant term of zero is not a special case, though it used to behave like
one. `x` divides out first, and what is left goes through the exact methods
like any other equation.

```solve
solve(x^3-x=0, x) // [-1, 0, 1]
solve(x^5-x=0, x) // [-1, 0, 1, -i, i]
```

That second one is exact all the way through: `x^5-x` is `x(x-1)(x+1)(x^2+1)`,
so all five roots are a rational or the imaginary unit and no approximation is
involved anywhere.

## Cubics and quartics

Both have closed forms, and both are used. A cubic goes through Cardano's
method, which returns all three roots including the complex pair.

```solve
solve(x^3-8=0, x) // [2, -1-sqrt(3)*i, -1+sqrt(3)*i]
solve(x^3-2=0, x) // [cbrt(2), -cbrt(2)/2-cbrt(2)*sqrt(3)/2*i, -cbrt(2)/2+cbrt(2)*sqrt(3)/2*i]
```

Cardano's formula for a cubic that has no neat root produces a genuinely long
expression, nested cube roots over square roots. It is returned anyway, because
it is the exact answer and rounding it away would throw information out.

A quartic is solved when it has no odd power, or when it splits into two
quadratics with rational coefficients.

```solve
solve(x^4-4x^2+4=0, x) // [-sqrt(2), sqrt(2)]
solve(x^4-3x^2+1=0, x) // [-sqrt((3+sqrt(5))/2), sqrt((3+sqrt(5))/2), -sqrt((3-sqrt(5))/2), sqrt((3-sqrt(5))/2)]
solve(x^4+4x^2+4x+15=0, x) // [-1-sqrt(2)*i, -1+sqrt(2)*i, 1-2i, 1+2i]
```

A biquadratic whose roots are complex is still exact, nesting one square root
inside another where it has to.

```solve
solve(x^4-2x^2+3=0, x) // [-sqrt((sqrt(3)+1)/2)-sqrt((sqrt(3)-1)/2)*i, -sqrt((sqrt(3)+1)/2)+sqrt((sqrt(3)-1)/2)*i, sqrt((sqrt(3)+1)/2)-sqrt((sqrt(3)-1)/2)*i, sqrt((sqrt(3)+1)/2)+sqrt((sqrt(3)-1)/2)*i]
```

## What stays approximate

A cubic with three distinct real roots and no rational one is the *casus
irreducibilis*, and its roots are reported as decimals.

```solve
solve(x^3-3x+1=0, x) // [-1.88, 0.35, 1.53]
```

That is not a gap in effort. It is a theorem that those three roots cannot be
written with real radicals at all: Cardano's formula reaches them only by taking
cube roots of complex numbers, and the expression that does exist involves a
cosine of an arccosine of an irrational. Three accurate decimals are the more
useful answer.

Any remaining quartic, and every equation of degree five to eight, is solved
numerically for the same kind of reason. A general quartic does have a closed
form, four radicals deep, and no one can read it. A quintic has none at all,
which is Abel's theorem rather than a limitation of this solver.

The numerical method finds every root at once, in the complex plane, so what
comes back is the whole set and not the part of it that happens to lie on the
real line.

```solve
solve(x^5-1=0, x) // [1, -0.8090169944-0.5877852523i, -0.8090169944+0.5877852523i, 0.3090169944-0.9510565163i, 0.3090169944+0.9510565163i]
```

## Equations with no exact method

Everything above is a polynomial equation: powers of the unknown, multiplied by
numbers and added up. Mix the unknown with a function of itself, as `cos(x) = x`
or `2^x = 10` do, and there is usually no formula for the answer at all. There
is still an answer: a value of `x` where the two sides are equal. On one side of
it the left-hand side is the larger, on the other side the smaller, so taking
two values that straddle it and halving the gap between them, again and again,
traps it to as many digits as the engine carries. That is a numeric root, found
by search rather than by algebra.

```solve
solve(cos(x) = x, x) // 0.74
solve(2^x = 10, x) // 3.32
solve(e^x = 10, x) // 2.30
solve(log(x) = 2, x) // 7.39
solve(1000*1.05^n = 2000, n) // 14.21
```

A numeric root is approximate, in the same sense as the roots of a quintic in
the section above: a decimal accurate to the precision of a double, not an exact
form. Every one is checked before it is shown. The candidate is substituted back
into both sides, and it is reported only if they agree there to within a few
parts in a billion. That check is what keeps a place where the curve jumps, or
shoots off to infinity, from being taken for a root: `1/x` changes sign at zero
without ever being zero there.

Several roots come back as a row, in ascending order.

```solve
solve(exp(x) = x + 2, x) // [-1.84, 1.15]
```

The equation can also be written on its own line and solved with an arrow,
exactly as a polynomial one can.

```solve
2^x = 10
x => // 3.32
```

### Where the search looks

Without further instruction the search runs from -1,000,000 to 1,000,000,
looking closely near zero and more coarsely further out, which is where the
roots of everyday equations sit. Two numbers after the unknown name a range to
search instead. That is how to reach a root further out, and how to list the
roots of an equation that repeats forever, as anything built on `sin` or `cos`
does.

```solve
solve(sin(x) = 0.5, x, 0, 3) // [0.52, 2.62]
solve(log(x) = 20, x, 0, 1e9) // 485,165,195.41
```

The ends of a range count as inside it. `pi` can only be written to the
precision of a double, so the sine of it is not quite zero, and the search looks
a hair past each end so that a root sitting on one is still found.

```solve
solve(sin(x) = 0, x, 0, pi) // [0, 3.14]
```

A range works for every equation, not only the numeric ones: the roots outside
it are left out. For a polynomial every root is known, so an empty range is a
real answer.

```solve
solve(x^2 = 4, x, 0, 10) // 2
solve(x^2 = 4, x, 5, 10) // no solution between 5 and 10
```

### What the search cannot see, and says

More than ten roots in the range are declined rather than listed, because a
list cut off at the edge of the search would read as the whole answer.

```solve
solve(sin(x) = 0.5, x) // More than 10 roots lie between -1000000 and 1000000, so this equation may have infinitely many, as one built on sin or cos does. Name a narrower range after the unknown, as in solve(sin(x) = 0.5, x, 0, 3).
```

Finding nothing is reported as finding nothing, never as "no solution", which
is a stronger claim than a search can make. The search looks for places where
the two sides cross. A root where they only touch without crossing, such as
`cos(x) = 1` at zero, is found only if the search happens to land on it
exactly; two roots closer together than the search's spacing can be missed; and
a root outside the range is not looked for.

```solve
solve(log(x) = 20, x) // No root was found between -1000000 and 1000000: the two sides never cross there. This equation is solved numerically, which finds crossings, so a root where the sides only touch, or one outside the range searched, is not found. To search elsewhere, name a range after the unknown, as in solve(log(x) = 20, x, 0, 1e9).
```

A search needs a number for everything but the unknown, so an equation that is
not a polynomial and still has a second unknown in it is refused. Nor does the
search isolate the unknown when it could: `2^x = 10` could be rearranged into
`x = log(10)/log(2)`, but it is answered with the decimal, since the solver does
not yet undo a function to reach the unknown inside it.

## A partial answer is never given as a whole one

The number of roots an equation has is its degree, and the solver knows that
before it starts. If it reaches the end with fewer, it reports how many are
missing rather than handing back the ones it found, because a short list of
correct roots reads exactly like a complete one and there is nothing in it for
a reader to notice.

## Answers that are not numbers

Some equations have a correct answer that is not a list of roots.

```solve
solve(1=2, x) // no solution
```

`x^2+1=0` does have solutions, and they are [complex](/syntax/complex/).
Solving in terms of another unknown works when the equation is linear in the one
being solved for.

```solve
solve(a*x+b=0, x) // -b/a
```

## If you do not want these words

`factor`, `solve`, `expand`, `der`, `derivative`, `integral`, `limit`, `taylor`
and `jacobian` are only treated as functions when the very next character is an
opening parenthesis, so they remain usable as ordinary variable names.

```solve
:factor = 1.5
:factor * 2 // 3
```

If a host wants them gone entirely, the package can be left out at
registration. That is a decision about which words your grammar claims, not a
performance one: it does not measurably speed the engine up, and it does not
make the bundle smaller. See
[the package system](/architecture/package-system/) for the measurements.
