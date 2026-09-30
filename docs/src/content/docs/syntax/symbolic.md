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
