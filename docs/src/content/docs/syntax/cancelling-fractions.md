---
title: "Cancelling a fraction"
description: Reducing a quotient of polynomials to its lowest terms.
---

> **Package:** `SYMBOLIC_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

Cancelling a fraction is reducing a quotient of polynomials to lowest terms, the
same as reducing `6/8` to `3/4` but with expressions on top and bottom: when the
numerator and denominator share a factor, that factor divides out. Like the other
algebra forms, this does not need a trailing arrow.

A quotient of polynomials reduces to lowest terms, automatically and on request.

```solve
cancel((x^2-1)/(x-1)) // x+1
cancel((x^3-1)/(x-1)) // x^2+x+1
cancel((2x^2+4x)/(2x)) // x+2
```

A fraction with nothing to cancel is left as written, and so is one whose parts
share no polynomial factor.

```solve
cancel((x^2+1)/(x-1)) // (x^2+1)/(x-1)
```
