---
"solve-engine": patch
---

`det` of a matrix with no rows answers instead of leaking a TypeError

`determinant` accepts a 0x0 matrix, because it is square, and then took the
integer route, which ends by reading the last pivot at `rows[n - 1][n - 1]`.
With no rows that is `rows[-1]`, so the host was handed `Cannot read properties
of undefined (reading '-1')` as an `UNEXPECTED_ERROR`: a raw JavaScript
exception wearing an engine error's clothes, which is the one thing the VM's
contract says cannot happen.

| input          | before                              | now |
| ---            | ---                                 | --- |
| `det` of a 0x0 | `UNEXPECTED_ERROR` from a TypeError | `1` |

One is the empty product, and it is not a new opinion: the numeric and symbolic
routes already returned `1` for the same matrix, since their elimination loops
do not run and they return the `1` they started from. The integer route was the
only one that disagreed, and it disagreed by crashing.

The boundary: no expression can build such a matrix. A literal `[]` is refused
for having no shape, and there is a test asserting that, so the day it becomes
constructible the same page says what the answer should be. The VM is reachable
without the parser, through bytecode and through plugins, and its promise not to
leak an exception is made to those callers too.

Found by the bytecode fuzzer in a six-opcode program: build a 0x0 matrix, call
`det`. The case is in the regression corpus.

## Verification

5 new tests: no `UNEXPECTED_ERROR`, the empty product as the answer, a one-cell
matrix unaffected, a singular matrix still exactly zero, and the literal `[]`
still refused.
