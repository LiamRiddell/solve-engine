---
title: "Splitting a fraction"
description: Breaking a rational function into the simple fractions that add up to it.
---

> **Package:** `SYMBOLIC_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

Splitting a fraction apart, the partial-fraction decomposition, breaks a single
rational function into a sum of simpler ones, one for each factor of the
denominator. It is the reverse of adding fractions over a common denominator, and
it is what turns a rational function into a form that can be integrated. Like the
other algebra forms, this does not need a trailing arrow.

`apart` is the other direction: it breaks a rational function into the simple
fractions that add up to it, one for each factor of the denominator.

```solve
apart((3x+5)/(x^2-1)) // 4/(x-1)-1/(x+1)
apart((x^2+1)/(x^3-x)) // -1/x+1/(x-1)+1/(x+1)
```

A repeated factor gets one piece per power of it, and a fraction that is not
proper keeps its polynomial part out front.

```solve
apart(1/(x*(x+1)^2)) // 1/x-1/(x+1)-1/(x+1)^2
apart((x^3+1)/(x^2-1)) // x+1/(x-1)
```

A denominator with nothing to split, because it is already irreducible, comes
back as it was.

```solve
apart((2x+3)/(x^2+x+1)) // (2x+3)/(x^2+x+1)
```

This is what makes a rational function integrable. See
[calculus](/syntax/calculus/).
