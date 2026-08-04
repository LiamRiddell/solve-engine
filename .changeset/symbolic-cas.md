---
"solve-engine": minor
---

Symbolic algebra: a bounded computer-algebra system with exact rational coefficients.

`expand`, `factor`, `solve`, `der`/`derivative`, `integral`, `taylor` and `jacobian` are new. Factoring and solving work over the rationals, so `x^2-2` and `x^2+1` come back unchanged rather than being approximated, and an irrational root is given as a square root rather than a decimal.

Also fixes three silent wrong answers in symbolic mode. `SymbolicNode` had no representation for exponentiation or function application, and `Value.toNumber()` reports `0` for a symbolic operand, so `x^2 + 3x + 2 =>` returned `3x+2`, `-x =>` returned `-0`, and `sqrt(x) =>` returned `0`, all without any error. Exact coefficients additionally fix a symbolic matrix inverse treating a structurally-zero pivot as non-zero when it arrived as `5.551e-17`.

Opcodes 159 and 160 (`THEREFORE_SOLVE`, `STORE_EQUATION_OR_ASSIGNMENT`) are removed. Both were declared but never emitted or handled.
