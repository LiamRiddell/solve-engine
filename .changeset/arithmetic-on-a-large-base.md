---
"solve-engine": patch
---

Arithmetic straight on a whole number past 2^53 written in a base keeps every digit

`(2^100 + 1) in hex + 1` answered 1,267,650,600,228,229,400,000,000,000,000, although `(2^100 + 1) in binary as hex` keeps the final 1. `in hex` holds the exact integer inside the value it writes, and the conversions read it, but `+`, `-`, `*`, `/`, `mod`, `^`, a minus sign and the comparisons read the value as the nearest double; `+ 1n` answered 2^100 + 1, the digit it added lost in the rounding. Each now reads the whole number the base holds (`bigBaseInteger` in `vm/ExactIntegers.ts`) and goes through the exact path an ordinary large whole number takes (`bigBaseArithmetic` in `vm/VMConversion.ts`), from helpers outside the VM's dispatch loop, which shrinks from 44,222 to 44,086 bytecode bytes.

| line | before | now |
| --- | --- | --- |
| `(2^100 + 1) in hex + 1` | 1,267,650,600,228,229,400,000,000,000,000 | 1,267,650,600,228,229,401,496,703,205,378 |
| `(2^100 + 1) in hex * 2` | 2,535,301,200,456,459,000,000,000,000,000 | 2,535,301,200,456,458,802,993,406,410,754 |
| `((2^100 + 1) in hex) mod 10` | 6 | 7 |
| `(2^100 + 1) in hex + 1n` | 1267650600228229401496703205377 | 1267650600228229401496703205378 |
| `((2^100 + 1) in hex) == ((2^100) in hex)` | true | false |
| `((2^100 + 1) in hex) > 2^100` | false | true |
| `(2n^2000) in hex + 1` | ∞ | 2^2000 + 1, all 603 digits, as an `n` number |
| `hex(255) + 1` | 256 | 256 |

The boundary. The exact path is taken against a plain number or another value in a base; against a quantity, a percentage or a number with a tolerance the value is read as the nearest double, as any large number is there. A division that does not come out whole shows as an ordinary number, though `as fraction` gives it exactly, and a power past about 1.8e308 is infinite, as it is for any ordinary number. A value in a base holding an `n` number past a double's range adds, subtracts, multiplies and takes a remainder as that `n` number, and divides and raises as a double would. The answer is an ordinary number, as `0x10 + 1` is 17. The number bases page gains the proven examples.

## Verification

`FoundBug_arithmeticOnBigBase.spec.ts` holds 35 tests: the line that exposed it, eighteen operations on a large value in a base (a bigint, a fraction, a chain back into hex, 2^53 + 1 and the comparisons among them), an `n` number past a double's range, small values unchanged, the stated boundary, the unit tests of `bigBaseInteger`, `wholeFromBase` and `bigBaseArithmetic` (ordinary, boundary at the safe limit, a zero divisor and an overflowing power, hostile quantities, text, a tolerance and a colour) and of the two readers it alters, `toBigIntOperand` and `compareRationalOperands`, and the adversarial cases: prototype words holding a large value in a base with the prototype checked, a 300-term sum and a 60,000-bit product within budget, a value from the line above with a check and a what-if over it through both document passes, and the numeric edges against a large value in a base. The fast suite (`npm run test:ci`, run with the worktree path let through its ignore list) ran 25,703 tests in 757 suites: 25,699 passed and 4 were skipped, the proven docs examples, the hardening and integration suites among them. `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet` and `lint:sidebar` passed, and `executeBytecode` measures 44,086 bytecode bytes on Node 22 (`lint:dispatch-size` measured by hand, since its spec is ignored inside a worktree).

On top of main, the full suite ran 28,105 tests in 786 suites, all passing but 4 skipped once the guide manifest and one docs link followed main's async data source guide (both in this change); `npm run test:temporal` passed its 3,493 tests, and the bundled-consumer contract passed its 27 checks, including 2,092 documented examples.
