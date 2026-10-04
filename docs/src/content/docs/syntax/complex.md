---
title: Complex numbers
description: Exact complex arithmetic, and the roots that need it.
---

> **Package:** `SYMBOLIC_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

A complex number has two parts: a real part, an ordinary number, and an
imaginary part, a multiple of `i`, the number whose square is -1. They are what
the square root of a negative number turns out to be, and they appear in
electronics, signal processing and the roots of equations. Writing a number
flush against `i` makes it imaginary.

```solve
3i // 3i
2+3i // 2+3i
1i*1i // -1
```

Arithmetic is exact, in the same sense the rest of the engine is: both parts are
exact fractions, never floating-point approximations.

```solve
(2+3i)+(1-1i) // 3+2i
(1+1i)*(1-1i) // 2
```

That exactness is what lets a value be recognised as really real. `(1+i)(1-i)`
is `2`, not `2` with a residue of imaginary noise, so the imaginary part
disappears when it should.

## `i` is still a variable name

`i` is not a reserved word. It is one of the most common variable names there
is, so claiming it would break more than it fixed.

```solve
:i = 5
:i + 1 // 6
3 * i // 15
```

The imaginary literal is recognised only when the letter is written flush
against a number, with no space: `3i` is imaginary, `3 i` and `3 * i` are a
number times a variable. Write `1i` for the imaginary unit on its own.

## Square roots of negative numbers

These have answers now.

```solve
sqrt(-4) // 2i
sqrt(-2) // sqrt(2)*i
```

The first is exact. The second keeps its surd, because the square root of two is
irrational and rounding it would be the one thing this engine will not do.

## Taking a complex number apart

Each part of a complex number can be read on its own. `re` gives the real part
and `im` the imaginary part (as a plain number, without the `i`). `conj` gives
the conjugate, the same number with its imaginary part negated, which is what
multiplies with the original to give a real answer.

```solve
re(2+3i) // 2
im(2+3i) // 3
conj(2+3i) // 2-3i
abs(3+4i) // 5
```

`abs` gives the modulus, which is exact whenever it is rational.

## Roots that are complex

Every quadratic has two roots, and now they are both returned.

```solve
solve(x^2+1=0, x) // [-i, i]
solve(x^2+2x+5=0, x) // [-1-2i, -1+2i]
solve(x^2+2=0, x) // [-sqrt(2)*i, sqrt(2)*i]
```

## Factoring stays over the rationals

Factoring is only defined once you say over what, and the default here is the
rational numbers, which is the usual convention.

```solve
factor(x^2+1) // x^2+1
```

`x^2+1` does factor over the complex numbers, as `(x-i)(x+i)`, but returning
that by default would mean `factor` changed what it meant depending on the
input. Use `solve` when you want the roots.
