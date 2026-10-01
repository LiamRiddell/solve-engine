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

The boundary: arithmetic between an unknown and a quantity is still worked as
algebra on the numbers alone, so the unit is not carried into the formula
(`foo * 5 km =>` is `5foo`). A formula stored by a bare assignment, `y = x +
1`, is refused the same way when a later line gives it a unit with `x` still
unknown.

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
multiplicative identities, and collects like terms in a top-level sum. It does
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
makes it useful for deriving a formula rather than only a number.
