---
"solve-engine": patch
---

A whole number past 2^53 keeps every digit through a chain of base conversions

`(2^100 + 1) in binary as hex` answered 0x10000000000000000000000000, dropping the final 1. `in binary` keeps the exact integer inside the value it writes in base two, but the next conversion read that value as an ordinary number, which rounds to the nearest double. The conversions now read the whole number a value written in a base already holds (`baseConversionOperand` in `vm/ExactIntegers.ts`), and `as number` at the end of a chain gives the exact whole number.

| line | before | now |
| --- | --- | --- |
| `(2^100 + 1) in binary as hex` | 0x10000000000000000000000000 | 0x10000000000000000000000001 |
| `(2^100 + 1) in hex in octal` | 0o2000000000000000000000000000000000 | 0o2000000000000000000000000000000001 |
| `(2^100 + 1) in hex as number` | 1,267,650,600,228,229,400,000,000,000,000 | 1,267,650,600,228,229,401,496,703,205,377 |
| `255 in binary as hex` | 0xFF | 0xFF |

The boundary. This covers the conversions between bases and `as number`. Arithmetic straight on a large value written in a base, `(2^100 + 1) in hex + 1`, still reads it as the nearest double; convert it `as number` first, which keeps every digit, until the arithmetic reads it exactly too. A result past a double's range, such as `2^4000`, is still an infinity before any conversion, since no exact integer is made for it. The number bases page gains the proven examples.

## Verification

`FoundBug_bigintBaseChain.spec.ts` holds 20 tests: the line that exposed it, eleven links of conversion chains (a negative, a written bigint, 2^53 + 1, an IPv6 address among them), small values unchanged, the unit tests of `baseConversionOperand` with ordinary, boundary (zero, a negative, the safe limit) and hostile arguments (text, an infinity, an IPv6 address), and the adversarial cases: prototype words holding a large value in a base with the prototype checked, a sixty-link chain and 2^1000 within budget, a value from the line above converted twice through both document passes, and every numeric edge through a binary-to-hex chain.

The fast suite (`npm run test:ci`, run with the worktree path let through its ignore list) ran 25,315 tests in 753 suites: 25,309 passed and 4 were skipped. The two failures were existing specs this change reaches: `Issue828_vectorFunctionChecks.spec.ts` expected a date given to `float` to be refused as "This calculation", and it now names `float`, so the assertion was updated; `Issue642_unitNamedVariableAfterSlash.spec.ts` showed the new text check reading the unit a rate carries as text, so the rate path now checks the value alone. Both, the new specs, the hardening, integration and proven docs suites were rerun and pass (9,960 tests). `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet` and `lint:sidebar` passed.
