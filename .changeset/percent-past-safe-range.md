---
"solve-engine": patch
---

A number past 2^53 written as a percentage keeps its exact digits, so `9007199254740993.5 as percent` is 900,719,925,474,099,350.00%

The number itself was already shown from its exact decimal, as 9,007,199,254,740,993.50, but the conversion made the percentage from its double alone, and the formatter wrote that double a hundred times over: 900,719,925,474,099,456.00%. A percentage made from a plain number now keeps the number's exact decimal, or its exact whole number, wherever the double cannot hold six places of the percentage, and the formatter writes the digits from it with the point moved two places. `in %` and `to %` share the conversion.

| line | before | now |
| --- | --- | --- |
| `9007199254740993.5 as percent` | `900,719,925,474,099,456.00%` | `900,719,925,474,099,350.00%` |
| `-9007199254740993.5 in %` | `-900,719,925,474,099,456.00%` | `-900,719,925,474,099,350.00%` |
| `(2^53 + 1) as percent` | `900,719,925,474,099,200.00%` | `900,719,925,474,099,300.00%` |
| `225000000000.5 as percent` | `22,500,000,000,050.00%` | `22,500,000,000,050.00%` |
| `0.25 as percent` | `25.00%` | `25.00%` |

The boundary: below that magnitude the double already writes the right digits, so a percentage there carries nothing new and every operation on it is unchanged. The exact value kept is the fraction the percentage stands for, the same number its double holds, so arithmetic on the percentage reads what it did. A quantity, a result with no exact reading (`sqrt`, a fraction such as `1/3`) and a percentage typed with its sign after a number that large (`900719925474099350%`) keep the double; `as percent` of the number is the exact form, and the big integers page says so.

## Verification

`FoundBug_percentPastSafeRange.spec.ts` holds 21 tests: the lines that exposed it, the forms that must not change, the boundary, arithmetic on the percentage, unit tests of `percentOfFraction` (ordinary, zero, a whole number, a negative, a 300-place decimal, a scale outside the contract) and of `percentageExact` (the six-place threshold, an exact whole number, a fraction that is not whole, no exact reading, NaN, an infinity, and every type that is not a plain number) and `toPercentage` carrying it, and the adversarial cases (prototype words with `Object.prototype` unchanged, a 300-digit literal, deep brackets and a long sum, text edges, a number from the line above with a what-if through both document passes, trimmed zeros and German grouping, a typo, and every numeric edge). `AdversarialFeatureSweep.spec.ts` gains `X + 0.5 as percent`.

The fast suite ran across 776 suites (26,551 of 26,555 tests passed, 4 skipped, none failed), with `docs/public/llms-full.txt` regenerated for the changed pages. `npm run typecheck`, `typecheck:tests` (at its baseline of 92 errors in 29 files, none new), `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, the proven docs examples and the hardening and integration suites passed, and `executeBytecode` measured 44,186 bytes by hand (`lint:dispatch-size` cannot find its spec inside a worktree). `npm run verify` as one command was not run.
