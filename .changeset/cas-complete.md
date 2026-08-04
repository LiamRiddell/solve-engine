---
"solve-engine": minor
---

Completes the computer-algebra system: complex numbers, polynomial GCD, closed-form cubics and quartics, partial fractions, and multivariate factoring.

Every item here was a stated limitation of the previous release rather than a new idea.

**Complex numbers.** Exact arithmetic over the Gaussian rationals, with `i` as a literal and `conj`, `re` and `im` as functions. `solve(x^2+1=0, x)` now gives `[-i, i]` rather than reporting no real solutions, and `sqrt(-4)` is exactly `2i`.

**`cancel`.** Polynomial GCD, so `cancel((x^2-1)/(x-1))` is `x+1`.

**Cubics and quartics in closed form.** `solve(x^3-2=0, x)` gives `cbrt(2)` and its conjugate pair rather than a decimal. A quartic is solved exactly when it is biquadratic or when it splits into two quadratics over the rationals, so `solve(x^4+1=0, x)` returns four exact roots. A cubic with three distinct real roots and no rational one is still reported numerically, because those roots provably cannot be written with real radicals.

**`apart`, and integrating rational functions.** `apart((3x+5)/(x^2-1))` is `4/(x-1)-1/(x+1)`, and `integral` now handles any quotient of polynomials whose denominator has no repeated irreducible quadratic factor.

**Multivariate factoring** for the standard shapes: `factor(x^2-y^2)`, `factor(x^3-8y^3)`, `factor(x^2+2x*y+y^2)` and `factor(a*x+a*y+b*x+b*y)` all factor now, where before they stopped at any shared constant and variable.

Also fixes a formatting bug where a sum whose right side had a negative leading coefficient rendered as `0.5*log(x-1)+-0.5*log(x+1)`.
