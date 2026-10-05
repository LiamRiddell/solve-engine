---
"solve-engine": patch
---

A quadratic over pi factors as one over a whole number does: `factor(x^2 - pi)` is `x^2-3.1415926536`, irreducible over the fractions as `x^2 - 2` is, rather than a refusal

`factor` writes a polynomial as a product of pieces with fractions for coefficients, so `factor(x^2 - 2)` is `x^2-2`: no fraction is a square root of 2, and that is the answer rather than a failure. Pi reaches it as the sixteen-digit fraction of its double, and the search for rational roots, which lists the divisors of the first and last coefficients, cannot list that fraction's within its bounds, so `factor(x^2 - pi)` was refused with "This polynomial's coefficients have too many divisors to search for rational roots" (found while testing the solver over pi). A quadratic needs no search: it has a rational root exactly when its discriminant, `b^2 - 4ac`, is the square of a fraction, one exact square root to test. A quadratic the search cannot reach is now decided that way, and `x^2 - pi`, whose discriminant `4pi` is not a square, comes back as written. Pulling out the shared factor of the coefficients wrote pi's sixteen digits into the answer (`factor(x^2 + pi*x)` was `1e-15x*(1000000000000000x+3141592653589793)`), so a shared factor with more than ten digits above or below the line, which only a long fraction produces, is left in place.

| line | before | now |
| --- | --- | --- |
| `factor(x^2 - pi)` | This polynomial's coefficients have too many divisors to search for rational roots. | `x^2-3.1415926536` |
| `factor(x^2 - e)` | the same refusal | `x^2-2.7182818285` |
| `factor(x^3 - pi*x)` | the same refusal | `x*(x^2-3.1415926536)` |
| `factor(x^2 + pi*x)` | `1e-15x*(1000000000000000x+3141592653589793)` | `x*(x+3.1415926536)` |
| `factor(720720x^2 + x + 720720)` | This polynomial has too many candidate rational roots to test. | `720720x^2+x+720720` |
| `factor(x^3 - pi)` | This polynomial's coefficients have too many divisors to search for rational roots. | This polynomial cannot be factored: a number in it is too long as a fraction (as pi and e are) to try every fraction that could be a root. solve finds its roots as decimals. |
| `factor(x^2 - 2)` | `x^2-2` | `x^2-2` |
| `factor(x^2 - 3.14159)` | `0.00001(100000x^2-314159)` | `0.00001(100000x^2-314159)` |

The boundary: `(x - sqrt(pi))*(x + sqrt(pi))` is not offered, because `factor` does not split over square roots for any number, and `x^2 - 2` stays whole for the same reason. A cubic or higher over pi has no such shortcut, and leaving it whole would claim it has no rational factor, which was never checked, so it is still refused, now in words that say why and point to `solve`. `pi^2` typed as such is rounded to a double that is not exactly the square of pi's, so `x^2 - 2*pi*x + pi^2` stays as written where `(x - pi)^2` factors back.

## Verification

`FoundBug_factorOverAnIrrationalConstant.spec.ts` holds 79 tests: the quadratics over pi, e and tau beside `x^2 - 2`, a shared variable taken out with pi left as written, every earlier answer unchanged, the cubic refusal and `solve` answering it, a quadratic with too many candidates decided, and the line through `evaluateLine`, `parseDocument` and `evaluateDocument`; unit tests of `quadraticRationalRoots` (two roots, one, none, a negative and a non-square discriminant, pi's fraction, pi squared exactly, a zero leading term, the wrong length, three-hundred-digit coefficients in time), `rootsToFactorBy` (the search's own answer, a quadratic out of reach decided, a cubic out of reach refused by code either way) and `readableContent` (a short content kept, the ten-digit line, pi's content and a four-hundred-digit one left in place); and the adversarial cases (prototype words with `Object.prototype` unchanged, a huge multiple, a 34-digit coefficient and the degree ceiling in time, look-alikes of pi, text edges, markup, a typo, the constant from the line above, a unit beside it, every numeric edge times pi, zero, negative zero, the largest and smallest doubles, CRLF). `ErrorCodeReachability.spec.ts` now reaches `SYMBOLIC_FACTOR_LIMIT_EXCEEDED` with `factor(x^3 - pi)`, since its old example is a quadratic and is answered. `AdversarialFeatureSweep.spec.ts` gains `factor(x^2 - (X) * pi)`. Gates: see the verification of `tiny-value-shown-as-zero.md`.

On top of main, the full suite ran 35,461 tests in 864 suites, all passing but 5 skipped, and `npm run test:temporal` passed its 3,777 tests.
