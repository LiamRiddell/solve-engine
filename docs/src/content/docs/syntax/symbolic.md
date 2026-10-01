---
title: Symbolic
description: Keeping an unknown as an unknown, and solving a linear system.
---

> **Built in.** The arrow belongs to the engine rather than to a package, so plain arithmetic on unknowns works whichever packages are registered. Some examples on this page read a form a package supplies: a name the lexer also reads as a unit (`b`) needs `VARIABLES_PACKAGE`, a function call such as `sqrt(x)` needs `FUNCTION_PACKAGE`, and a matrix needs `MATRIX_PACKAGE`. `createEngine()` registers all three.

Symbolic arithmetic works with letters that have no value yet, the way algebra
on paper does: `x + x` is `2x` whatever `x` turns out to be. Ending a line with
an arrow evaluates it in a mode where a name with no value
stays symbolic instead of becoming an error.

```solve
1+2+b+3+b => // 2b+6
```

An unknown survives arithmetic, exponentiation, negation and function calls, so
an expression keeps its shape rather than losing the terms that involve it.

```solve
x^2+3x+2 => // x^2+3x+2
-x =>       // -x
sqrt(x) =>  // sqrt(x)
```

## An unknown has no amount

Some operations need one amount to work on: giving a value a unit or a
currency (`km`, `$`), writing it as a percentage, in another base, as a
fraction or in scientific notation, and `as number`. An unknown has no amount,
so under the arrow those are refused with the same error the line gives
without it, naming the unknown. They used to read the unknown as zero, so
`foo percent =>` answered `0.00%` while `foo percent` said the name was
undefined.

```solve
foo + 1 =>     // foo+1
```

```solve-doc
foo percent => // ERROR: Undefined variable: foo
foo km => // ERROR: Undefined variable: foo
foo as hex => // ERROR: Undefined variable: foo
```

Once the name has a value, the same lines answer with it.

```solve-doc
foo = 12 // 12
foo percent => // 12.00%
foo km => // 12.00 km
```

A formula stored by a bare assignment, `y = x + 1`, is refused the same way
when a later line gives it a unit with `x` still unknown.

## Constants are values

A constant is a number with a name, so it is never an unknown. `pi`, `e`,
`tau` and `phi` are read as their values under the arrow, and so are `π`
and `ans`, the line above's answer: each line answers what it answers without
the arrow. A formula holds a constant as its decimal, the way it holds any
other number.

```solve
π km =>  // 3.14 km
pi + x => // x+3.1415926536
```

```solve-doc
2 + 3 // 5
ans km => // 5.00 km
```

An equation that mentions `π` has one unknown fewer for it, so `2x = π` is
stored and solved for `x`. A note that gives `π` or `ans` a value of its own
is read with that value, under the arrow too.

## A formula keeps no units

A formula is algebra on numbers: it records how the unknowns combine, and it
has nowhere to keep a unit beside them. Arithmetic between an unknown and an
amount in a unit (a length, a weight, money) is therefore refused by name,
saying which unit would be lost, rather than answered with the unit dropped.
Once the unknown has a value, the line is ordinary arithmetic and keeps its
unit.

```solve-doc
foo * 5 km => // ERROR: A formula keeps no units, so combining "foo" with an amount in km would drop the km. Give "foo" a value on a line above, or write the formula without the unit.
```

```solve-doc
foo = 3 // 3
foo * 5 km => // 15.00 km
```

The same refusal covers a power, a function call and either side of `solve`,
so `solve(2x = 4 km, x)` is refused rather than answered 2. A plain number and
a percentage are not units and combine as before. Carrying units through a
formula is a feature of its own, and not one this page offers yet.

## A percentage of an unknown

A percentage is a share of something. Added to a number it is a share of that
number, so `200 + 10%` adds a tenth of 200 and is 220. Added to an unknown it
is a share of the unknown in the same way: `foo + 10%` is `1.1foo`, and once
`foo` is 200 the formula answers 220, as the line with the number does.

```solve
foo + 10% =>  // 1.1foo
foo - 10% =>  // 0.9foo
200 + 10%    // 220
```

```solve-doc
y = x + 10% // 1.1x
x = 200 // 200
y // 220
```

The boundary: a percentage written first is a percentage plus a number, which
the engine reads as a proportion (`10% + 5` is 510%), so `10% + foo =>` stays
`foo+0.1`, the same value.

## How a formula is written

A formula is shown in a form that reads back as itself: typed into a line, the
answer it shows is the formula you started from. A fraction that has no short
decimal goes after its term as a division, so one 1200th of a salary is
`salary/1200` rather than `1/1200salary`, which reads as one over 1200
salaries. The engine reads a leading minus as part of what follows, so
`-x^2` is `(-x)^2`; the negative of a square is therefore written `-(x^2)`.
Two minus signs that cancel are removed, and a quotient under a quotient is
turned over.

```solve
x*(1/3) =>       // x/3
x/(1/y) =>       // x*y
-x/-y =>         // x/y
-(x^2) =>        // -(x^2)
solve(salary/1200 * rate = net, rate) // 1200*net/salary
```

A coefficient is written beside its term (`2x`) only where the two read as a
product; otherwise a `*` separates them, as in `1200*net`, since `1200n` is a
whole number. The boundary: the printer knows no units, so a name that is also
a unit is still written beside its coefficient, and `2b` typed back is two
bytes. A fraction whose parts are over a million is shown as its decimal, to
ten significant figures.

## Exact arithmetic

Coefficients are exact rationals rather than floating-point numbers, so a value
reads back as it was written and a fraction stays a fraction.

```solve
x/3 =>      // x/3
2^10 + x => // x+1024
```

This matters most where rounding would be indistinguishable from a real result:
a matrix entry that is structurally zero can arrive as a value like
`0.0000000000000000555` in floating point, which is enough to make a singular
matrix look invertible.

A function of a number folds to its value: `sqrt(4)` becomes `2` and `sqrt(2)`
its decimal `1.41`. A function of an unknown is left as written, so `sqrt(x)`
stays `sqrt(x)` rather than inventing a value for the unknown.

An expression that divides by zero has no value, whatever its unknowns are, so
it is refused where it is written rather than carried into the algebra. Expanding
it, differentiating it or solving an equation over it would otherwise work on a
quantity that does not exist. Only an exact zero counts: a very small number is
an ordinary divisor.

```solve
expand((x+1)/0) // This expression divides by zero, so it has no value, whatever its unknowns are.
der(x/0, x) // This expression divides by zero, so it has no value, whatever its unknowns are.
expand((x*0)^-1) // This expression divides by zero, so it has no value, whatever its unknowns are.
```

## The bounded simplifier

Simplification is deliberately limited. It folds constants, applies additive and
multiplicative identities, collects like terms in a top-level sum, cancels two
minus signs, and turns a quotient under a quotient over (`x/(1/y)` is `x*y`). It does
not apply trigonometric identities, and it never expands or factors on its own,
which is what keeps `x^2` from turning back into `x*x`.

## Solving a linear system

Writing a product chain equal to a value stores an equation. Asking for the
unknown solves it.

```solve
a = [1, 2; 3, 4]
a*x = [60; 70]
x => // [-50.00; 55.00]
```

This also works when the coefficients are themselves unknown, which is what
makes it useful for deriving a formula rather than only a number: a matrix
whose cells are unknowns solves to a matrix of formulas.

A factor that has no value at all leaves nothing to multiply out, so asking
for the unknown names the factor and the other way to ask: `solve`, which
treats the factor as an unknown and gives the formula.

```solve-doc
a*x = b // x stored as an equation: solve with "x =>"
x => // ERROR: Cannot solve for "x": "a" is not yet defined. Give "a" a value on a line above, or solve for "x" in terms of it with solve(a*x = b, x).
solve(a*x = b, x) // b/a
```
