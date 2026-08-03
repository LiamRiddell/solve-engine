---
title: Symbolic evaluation
description: Keeping an unknown as an unknown, and solving a linear system.
---

Ending a line with an arrow evaluates it in a mode where a name with no value
stays symbolic instead of becoming an error.

```solve
1+2+b+3+b => // 2b+6
```

The simplifier is deliberately bounded. It folds constants, applies additive and
multiplicative identities, and collects like terms in a top-level sum. It does
not expand polynomials, apply trigonometric identities, or collect terms through
a product.

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
