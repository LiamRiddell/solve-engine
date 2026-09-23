---
"solve-engine": minor
---

`solve` finds numeric roots, `integral` takes bounds, and `limit` is new

An equation that mixes the unknown with a function of itself, such as `cos(x) = x` or `2^x = 10`, has no formula for its answer, and `solve` refused every one of them as "not a polynomial equation". It now searches the real line for where the two sides cross, closes in on each crossing by bisection, and substitutes each candidate back into both sides before reporting it. `integral` with two bounds after the variable is the definite integral, the area under the curve between them, and `limit(f, x, a)` is the value `f` settles towards as `x` approaches `a`.

| expression | before | now |
| --- | --- | --- |
| `solve(cos(x) = x, x)` | error: not a polynomial equation | 0.74 |
| `solve(2^x = 10, x)` | error: not a polynomial equation | 3.32 |
| `solve(e^x = 10, x)` | error: not a polynomial equation | 2.30 |
| `solve(log(x) = 2, x)` | error: not a polynomial equation | 7.39 |
| `solve(exp(x) = x + 2, x)` | error: not a polynomial equation | [-1.84, 1.15] |
| `solve(sin(x) = 0.5, x, 0, 3)` | parse error | [0.52, 2.62] |
| `integral(x^2, x, 0, 3)` | parse error: expected `)` | 9 |
| `integral(x^2, x, 0, 1)` | parse error: expected `)` | 1/3 |
| `integral(exp(x^2), x, 0, 1)` | parse error: expected `)` | 1.46 |
| `integral(1/x, x, 0, 1)` | parse error: expected `)` | error: improper integral |
| `limit(sin(x)/x, x, 0)` | error: undefined variable x | 1 |
| `limit((x^2-1)/(x-1), x, 1)` | error: undefined variable x | 2 |
| `limit(abs(x)/x, x, 0)` | error: undefined variable x | error: the sides disagree, -1 and 1 |

A numeric root is approximate, as the roots of a quintic already were, and the solving page now has a section saying which answers are found by search. The search runs from -1,000,000 to 1,000,000 unless two numbers after the unknown name a range; a range also filters the exact roots of a polynomial, so `solve(x^2 = 4, x, 0, 10)` is 2. More than ten roots in the range is declined (`SYMBOLIC_SOLVE_TOO_MANY_ROOTS`) rather than listed, since a list cut off at the edge of the search would read as complete, and finding none is `SYMBOLIC_SOLVE_NO_ROOT_FOUND`, never "no solution", which is a stronger claim than a search can make. A pole (`1/x = 0`) and a side that underflows to zero (`e^x = 0`) are not reported as roots.

A definite integral is exact through the antiderivative where `integral` finds one, and a fraction stays a fraction. The antiderivative is trusted on its own only for an integrand continuous everywhere by its shape; for anything else a numeric estimate is made too and must agree, which is what stops `integral(1/x^2, x, -1, 1)` answering -2 across the pole at zero. Where there is no antiderivative, adaptive Gauss-Kronrod quadrature gives the answer once its error estimate is within one part in ten billion. A limit of a rational function is exact; any other is extrapolated numerically from both sides, with each value's own rounding error tracked so that cancellation near the point cannot pass for a trend.

Each way these can fail is its own named error: `SYMBOLIC_INTEGRAL_IMPROPER` for an integrand with no finite value in the range or an infinite bound, `SYMBOLIC_INTEGRAL_UNSETTLED` for an estimate that does not settle, and `SYMBOLIC_LIMIT_SIDES_DISAGREE`, `SYMBOLIC_LIMIT_DIVERGES`, `SYMBOLIC_LIMIT_UNSETTLED` and `SYMBOLIC_LIMIT_UNDEFINED` for a limit that does not exist. A bound, range or point that is not a plain finite number is `SYMBOLIC_BOUND_INVALID`.

The boundary, and why:

- A root where the two sides touch without crossing (`cos(x) = 1` at 0) is found only if the search lands on it exactly, and two roots closer together than its sample spacing can be missed. The error for finding nothing says so.
- The solver does not isolate the unknown from inside a function, so `2^x = 10` is answered with the decimal rather than `log(10)/log(2)`.
- An improper integral is refused even when it converges (`1/sqrt(x)` from 0 to 1 is 2), and a bound of infinity is refused, because both need a limit at the edge of the range and a wrong one looks exactly like a right one.
- A limit at infinity is not evaluated, and there is no one-sided form; the disagreeing-sides error names what each side approaches.
- An equation, integrand or limit with a second unknown in it is refused, as the exact forms refuse it.
- A numeric answer is an ordinary number, not marked approximate in the value itself; the documentation says which forms produce one.

`limit` is a plugin function of the symbolic package rather than a new builtin index, and, like the other algebra words, is a function only when directly followed by `(`, so `limit = 40` is still a variable.

## Verification

New suites cover the root search (poles, jumps, underflow and domain gaps never reported as roots), the quadrature against integrals with known values, the error-bounded evaluation, limits and definite integrals below the engine, and every form above through the engine, each checked against values computed independently with JavaScript's own functions. The symbolic property suite now substitutes every numeric root back into its equation. The solving-equations, calculus and cheatsheet pages gain the new forms as proven examples. `npm run verify` passes: 10,709 tests across 517 suites, with the bundled-consumer contract.
