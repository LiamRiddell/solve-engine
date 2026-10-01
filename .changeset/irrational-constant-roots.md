---
"solve-engine": patch
---

An equation over pi or e is solved: `solve(x^2 = pi, x)` is `[-1.77, 1.77]`, the two square roots of pi, rather than a refusal

Pi and e are irrational, so no fraction equals either, and the engine holds each as the sixteen-digit decimal nearest to it: pi reaches the solver as `3141592653589793/10^15`. The solver tries every rational root before anything else, by the rational-root theorem, which lists the divisors of the first and last coefficients by trial division. Those of a sixteen-digit fraction cannot be listed within the search's bounds, the search threw "This polynomial's coefficients have too many divisors to search for rational roots", and the throw ended the solve. So `x^2 = pi`, `x^2 = e`, `x^3 = pi` and `2x^2 = e` were all refused, while `x^2 = 2` answered (found while testing the solver).

The search is a refinement, not the method. A factor whose rational roots cannot be searched now goes to the numerical root finder, which finds every root of it at once in the complex plane, the way a cubic with no exact form already did. Its roots are shown as decimals: the exact form would be the square root of that sixteen-digit fraction, exact only for the rounded constant and unreadable. Any rational root found before the search ran out is still exact. While there, a real square-root answer kept a factor of its leading coefficient outside the root, where nothing cancelled it: `x^2 = 3.14159` was `0.002*sqrt(3141590)/2` and `3x^2 = 1` was `2*sqrt(3)/6`. The division is now folded into the root, as it already was for a complex pair.

| line | before | now |
| --- | --- | --- |
| `solve(x^2 = pi, x)` | This polynomial's coefficients have too many divisors to search for rational roots. | `[-1.77, 1.77]` |
| `solve(x^2 = e, x)` | the same refusal | `[-1.65, 1.65]` |
| `solve(2x^2 = e, x)` | the same refusal | `[-1.17, 1.17]` |
| `solve(x^3 = pi, x)` | the same refusal | `[-0.7322959438-1.2683737808i, -0.7322959438+1.2683737808i, 1.46]` |
| `x^2 = pi`, then `x =>` | the same refusal | `[-1.77, 1.77]` |
| `solve((x-1)*(x^2 - pi) = 0, x)` | the same refusal | `[-1.77, 1, 1.77]` |
| `solve(x^2 = 2, x)` | `[-sqrt(2), sqrt(2)]` | `[-sqrt(2), sqrt(2)]` |
| `solve(x^2 = 3.14159, x)` | `[-0.002*sqrt(3141590)/2, 0.002*sqrt(3141590)/2]` | `[-0.001*sqrt(3141590), 0.001*sqrt(3141590)]` |
| `solve(3x^2 = 1, x)` | `[-2*sqrt(3)/6, 2*sqrt(3)/6]` | `[-sqrt(3)/3, sqrt(3)/3]` |

The boundary: what decides between the exact and the numerical answer is the size of the fraction, not where the number came from. A coefficient with more than about ten digits above or below the line, which is what pi, e, a long typed decimal and a value such as `0.1 + 0.2` in floating point become, is solved numerically; `3.14159` keeps its square root. The decimals are shown to two places like any other answer, and the value held is the full double (`1.7724538509...`). Where the numerical method does not converge either, as for a cubic whose constant is near the largest double (`solve(x^3 = e + 1e308, x)`), the answer says how many roots were not found rather than building a closed form of such numbers, which took tens of seconds. `factor(x^2 - pi)` is still refused by name, since a factorisation has no numerical fallback to offer. Found and not fixed here: `tau` and `phi` inside `solve` are refused as though they were live values, and `2tau` there is a parse error; this is pinned as a failing test in the spec below.

## Verification

`FoundBug_irrationalConstantRoots.spec.ts` holds 84 tests: the reported equations and their checks (`x^2 = 3.14159`, `x^3 = pi`, `2x^2 = e`), each root against `Math.sqrt` and `Math.cbrt` of the constant, the shape against `x^2 = 2`, a rational root beside an irrational factor, a range, and the equation through `evaluateLine`, `parseDocument` and `evaluateDocument`; unit tests of `searchRationalRoots` (ordinary, empty and linear input, a zero constant term, a sixteen-digit coefficient and two highly composite ones named rather than thrown, and `rationalRoots` still refusing them), `extractRationalRoots` (searched, a power of x first, an unsearchable factor left whole), `realSurdQuadraticRoots` (centred on zero, off it, large parts in time) and `solveForVariable` over pi; and the adversarial cases (prototype words as the unknown with `Object.prototype` unchanged, a huge multiple, a 34-digit coefficient and degree eight in time, degree nine refused, a look-alike of pi, text edges, markup, a typo, a unit on a side, the constant from the line above under a check and a what-if, every numeric edge times pi, zero, negative zero, the largest and smallest doubles, a cubic near the largest double reported unsolved in time, an infinite side, CRLF). `AdversarialFeatureSweep.spec.ts` gains `solve(x^2 = X * pi, x)` and `solve(x^3 = e + X, x)`. Gates: see the verification of `unit-named-unknown.md`, which ran for the whole batch.
