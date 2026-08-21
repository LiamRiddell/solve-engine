---
"solve-engine": minor
---

Measurements carry a tolerance, and the tolerance travels through the arithmetic.

A reading usually comes with an error term, and until now there was no way to carry it: you tracked it by hand on a second line, which stopped being practical after one operation. Write `12.3 ± 0.5`, or the ASCII `12.3 +/- 0.5` since the symbol is awkward to type, and the number carries a one-sigma uncertainty of `0.5`. `+`, `-`, `*` and `/` propagate it, combining independent errors in quadrature:

```
12.3 +/- 0.5              12.3 ± 0.5
(12.3 +/- 0.5) * 4        49.2 ± 2.0
(10 +/- 1) + (20 +/- 2)   30 ± 2.24
```

A sum or difference adds the spreads as `sqrt(a² + b²)`; a product or quotient adds the relative spreads the same way. A plain number counts as an exact operand, so a scalar multiply scales the spread by the factor. The `±` binds tighter than `+ - * /`, so `12.3 ± 0.5 * 4` is `(12.3 ± 0.5) * 4`; parenthesise to group otherwise.

The boundary is deliberate. Uncertainty is a sidecar on an ordinary Number, so a value with no tolerance behaves exactly as a plain number always did, and everything other than the four arithmetic ops reads the centre and drops the tolerance: a comparison compares the centres, and `sqrt`, `sin` and the like work on the centre alone. Correlated errors are a much larger problem and out of scope, as is a tolerance on a value that also carries a unit.
