---
"solve-engine": patch
---

`as int` truncates a number's exact value, so `9007199254740993.5 as int` is 9,007,199,254,740,993, as `floor` and `int` already answered

Past 2^53 a double holds no fraction, so the literal `9007199254740993.5` is the double 9,007,199,254,740,994. The literal keeps its exact decimal beside the double, and `floor`, `trunc` and `int` read that, but `as int` (the networking package's converter, which also truncates a plain number) truncated the double. A whole number kept exact past the safe range lost its last digit the same way. A value that is not an address now takes the chain `int` uses: an exact integer is handed back as it is, an exact decimal is truncated in base ten, towards zero, and anything else truncates its double, as before.

| line | before | now |
| --- | --- | --- |
| `9007199254740993.5 as int` | `9,007,199,254,740,994` | `9,007,199,254,740,993` |
| `-9007199254740993.5 as int` | `-9,007,199,254,740,994` | `-9,007,199,254,740,993` |
| `(2^53 + 1) as int` | `9,007,199,254,740,992` | `9,007,199,254,740,993` |
| `floor(9007199254740993.5)` | `9,007,199,254,740,993` | `9,007,199,254,740,993` |
| `3.7 as int` | `3` | `3` |
| `10.0.0.0/8 as int` | `167,772,160` | `167,772,160` |

The boundary: a value with no exact decimal or exact integer keeps the double, exactly as `floor` and `int` do, so a quantity (`9007199254740993.5 m as int` is 9,007,199,254,740,994) and an exact fraction that is not a decimal (`(2^60 + 0.5) as int`, which `floor` also reads from its double) are unchanged. An address still converts to its own integer. The big integers page gains the conversion beside the literal.

## Verification

`FoundBug_asIntPastSafeRange.spec.ts` holds 19 tests: the lines that exposed it and their neighbours, agreement with `int`, `trunc`, `floor` and `ceil`, the addresses, text and quantity forms unchanged, the boundary, unit tests of `truncateToWhole` (an exact decimal, an exact integer, a plain double, zero and negative zero, a negative exact decimal, the largest and smallest doubles, NaN, the infinities, text, a boolean and a quantity) and of `ipAsInt` handing over to it, and the adversarial cases (prototype words with `Object.prototype` unchanged, a 300-digit literal, deep brackets and a long sum, text edges, digits from another script, a number from the line above with a check and a what-if through both document passes, and every numeric edge). `AdversarialFeatureSweep.spec.ts` gains `X + 0.5 as int` and `-(X) as int`.

The fast suite ran across 776 suites (26,551 of 26,555 tests passed, 4 skipped, none failed), with `docs/public/llms-full.txt` regenerated for the changed pages. `npm run typecheck`, `typecheck:tests` (at its baseline of 92 errors in 29 files, none new), `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, the proven docs examples and the hardening and integration suites passed, and `executeBytecode` measured 44,186 bytes by hand (`lint:dispatch-size` cannot find its spec inside a worktree). `npm run verify` as one command was not run.
