---
"solve-engine": patch
---

A base conversion of an infinity is refused by name instead of showing "Infinity"

`(1/0) in hex` and `2^4000 in binary as hex` displayed "Infinity" as though it were a numeral. An infinity has no digits in any base, and an ordinary number past about 1.8e308 (the largest a double holds) is already infinite before the conversion sees it. Every base conversion, `in hex`, `as binary`, `in octal`, `hex()` and `bin()`, now goes through one function (`valueInBase` in `vm/ExactIntegers.ts`), which refuses a value with no digits with the new code `BASE_NOT_FINITE` and points at the `n` form, which writes a very large whole number out in full.

| line | before | now |
| --- | --- | --- |
| `(1/0) in hex` | Infinity | An infinite value has no digits to write in hex. An ordinary number past about 1.8e308 is infinite; a whole number written with n, as in 2n^4000, keeps every digit. |
| `2^4000 in binary as hex` | Infinity | An infinite value has no digits to write in binary. (the same sentence) |
| `hex(1/0)` | Infinity | An infinite value has no digits to write in hex. (the same sentence) |
| `2n^200 in hex` | 0x100000000000000000000000000000000000000000000000000 | 0x100000000000000000000000000000000000000000000000000 |
| `255 in hex` | 0xFF | 0xFF |

The boundary. The stated bound is a double's range for an ordinary number: `2^4000` itself still answers ∞, since making every overflowing power an exact integer would change what a large power is everywhere, not only in a base. A whole number written with `n` has no such ceiling up to its own power limit (`2n ^ 100000` is refused by `BIGINT_POW_LIMIT_EXCEEDED`), and is written out digit for digit. A result with no value (a NaN) is refused the same way. `hardening/ArithmeticBases.spec.ts` had pinned "Infinity" and "NaN" as the display of these lines; it now asserts the refusal. The number bases page gains a section on what has no digits.

## Verification

`FoundBug_nonFiniteBaseConversion.spec.ts` holds 23 tests: the lines that exposed it, ten ways into a base each refused, very large exact values written in full, finite values unchanged, the unit tests of `nonFiniteInBase` (each base, the largest and smallest doubles and negative zero, NaN) and `valueInBase` (a number, a bigint, an exact integer, each base's tag, an infinity and text), and the adversarial cases: prototype words holding an infinity with the prototype checked, a huge power and a sixty-link chain within budget, an infinity from the line above with a what-if over it through both document passes, and every numeric edge through each base. The fast suite (`npm run test:ci`, run with the worktree path let through its ignore list) ran 25,703 tests in 757 suites: 25,699 passed and 4 were skipped, the proven docs examples, the hardening and integration suites among them. `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet` and `lint:sidebar` passed, and `executeBytecode` measures 44,086 bytecode bytes on Node 22 (`lint:dispatch-size` measured by hand, since its spec is ignored inside a worktree).

On top of main, the full suite ran 28,105 tests in 786 suites, all passing but 4 skipped once the guide manifest and one docs link followed main's async data source guide (both in this change); `npm run test:temporal` passed its 3,493 tests, and the bundled-consumer contract passed its 27 checks, including 2,092 documented examples.
