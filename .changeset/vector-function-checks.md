---
"solve-engine": patch
---

`vec2`, `vec3` and `vec4` refuse a wrong number of components by name, `dot` is the dot product of two vectors, and `float` is a number

The three vector keywords built their vector from however many values sat on top of the stack, so a component too many was dropped without a word and one too few reached below the line's own values, a stack underflow that surfaced as an internal fault. `dot` was the matrix product, so two row vectors of the same length were refused and a row and a column gave a one-by-one matrix rather than a number, and `float` built a one-by-one matrix too (#828).

| line | before | now |
| --- | --- | --- |
| `vec2(1, 2, 3)` | [2, 3] | refused: `vec2() takes 2 arguments, but was given 3 arguments` |
| `vec3(1, 2)` | throws `Stack underflow: an opcode expected a value on the stack but it was empty` | refused: `vec3() takes 3 arguments, but was given 2 arguments` |
| `dot([1,2,3], [4,5,6])` | refused as a matrix product, in a message carrying an em-dash and `3 !== 1` | 32 |
| `dot([1,2,3], [4;5;6])` | [32] | 32 |
| `dot([1,2], [4,5,6])` | refused as a 1x2 by 1x3 matrix product | `dot needs two vectors of the same length, but one has 2 components and the other 3.` |
| `float(2.5)` | [2.50] | 2.50 |

A wrong count is refused at parse time with `BUILTIN_ARITY_MISMATCH`, the code and wording a builtin's wrong count already has. `dot` multiplies matching components and adds them, reading a row and a column alike; a matrix that is not a vector is refused with `DIMENSION_MISMATCH`, pointing at `*` for the matrix product, which is unchanged. `float(x)` is the plain number `x` is: a number is itself, a percentage its fraction, and text that spells a number whole is that number; a quantity, a list, other text and true or false are refused with `FLOAT_TAKES_NUMBER`. The matrix-product refusal no longer carries an em-dash or a JavaScript operator: it now reads `the first has 3 columns and the second 1 row, and the two must match`.

The boundary: `dot` of a number and a vector is refused as two vectors of different lengths, rather than scaling the vector, since that is a product and `*` writes it. A quantity inside a list still loses its unit, as every list does (see the vectors and matrices page). Because `dot` no longer builds a matrix, the long `dot()` product that the retained-memory hardening spec pinned against the allocation budget is now an ordinary sum and answers; that spec is updated to pin the new answer and the refusal of a matrix. The vectors and matrices page gains proven examples of dot products, `vec2` to `vec4` and `float`.

## Verification

`Issue828_vectorFunctionChecks.spec.ts` holds 51 tests: each keyword's exact count and every wrong count; `dot` on rows, columns and a mix, on unequal lengths and on a matrix; `float` on a number, a percentage, numeric and other text, a quantity, money, a list, a date and a single-cell matrix; unit tests of `fixedArityError`, `vectorLength`, `dotProduct` (including a symbolic component), `notPlainNumberKind` and `floatOf`; and adversarial cases from the three sides (prototype words, argument lists past the line limits, long text, look-alike and markup-shaped text, the forms meeting each other, and the numeric corpus). The adversarial sweep gains templates for each form. `npm run typecheck`, `npm run lint`, `npm run lint:comments`, `npm run lint:docs`, `npm run lint:cheatsheet` and `npm run lint:sidebar` passed, the proven docs examples passed, and the fast suite passed, 16,029 of 16,033 tests in 618 suites with 4 skipped. `executeBytecode` is 47,517 bytecode bytes on Node 22.
