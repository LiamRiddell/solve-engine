---
"solve-engine": minor
---

`*=` and `/=` beside `+=` and `-=`, for a balance that grows by a rate

The running-total forms stopped at `+=` and `-=`, so a balance grown by a rate, or a quantity halved in place, could not be written the same way (#670).

| note | before | now |
| --- | --- | --- |
| `bal = $100`, `bal *= 1.05` | No prefix parselet found for token: EQUALS | $105.00 |
| `a = 8`, `a /= 2` | No prefix parselet found for token: EQUALS | 4 |
| `len = 10 m`, `len /= 4` | No prefix parselet found for token: EQUALS | 2.50 m |
| `y *= 2`, with nothing named `y` | No prefix parselet found for token: EQUALS | Undefined variable: y |

They are read exactly as `+=` and `-=` are: the right-hand side keeps its own brackets (`q *= 2 + 1` multiplies by 3), the arithmetic is the ordinary multiplication and division, so money stays exact to the penny and a unit stays its unit, and the line answers with the new value. Tracing, renaming and highlighting treat the new lines as they treat a running total, and highlighting one runs nothing.

What differs from `+=`: a first `*=` or `/=` on a name that has not been set is refused as an undefined variable, since starting from zero would make every product zero. `%=` and `^=` are not added.

The variables page shows a balance grown by a rate.

## Verification

`Issue670_starAndSlashEquals.spec.ts` has 19 tests: the lexer reading both operators while a comment and a plain division stay untouched; running products and quotients over numbers, money (exact to the penny) and quantities, a trace and a rename; and adversarial cases: a first use on an unknown name, division by zero, a missing right-hand side, a number on the left, a length on the right, and highlighting a running product, which runs nothing.

The engine suite is 14,209 tests in 588 suites, all passing (four skipped), and `npm run verify:ci` passes on the branch, including the docs proofs, the three-zone `test:temporal` run, `lint:dispatch-size` (47,331 bytes on Node 24, 14,109 under the ceiling) and the bundled-consumer contract.
