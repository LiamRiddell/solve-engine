---
"solve-engine": patch
---

A number too large for its double to hold the places shown is written from its exact digits, so `9007199254740993.5` answers `9,007,199,254,740,993.50` rather than `9,007,199,254,740,994`

Past 2^53 a double holds no fraction at all, so the typed literal `9007199254740993.5` is the double 9,007,199,254,740,994, and that was what the line showed: a confident wrong number. The literal already kept its exact decimal beside the double, and exact arithmetic on it kept that too, but the formatter printed the double. The same literal also compared equal to `9007199254740994`, because the exact reading of an operand looked at its whole double before its exact decimal. The previous batch made a whole literal past 2^53 exact; this is its decimal counterpart.

A plain number is now written from its exact decimal, or from its exact fraction, wherever the double's spacing could reach half of the last place shown (about 2.25 × 10^13 at the default two places, 2^51 for a whole number), and an operand's exact reading takes its exact decimal first.

| line | before | now |
| --- | --- | --- |
| `9007199254740993.5` | `9,007,199,254,740,994` | `9,007,199,254,740,993.50` |
| `9007199254740993.5 + 1` | `9,007,199,254,740,994` | `9,007,199,254,740,994.50` |
| `9007199254740993.5 / 2` | `4,503,599,627,370,497` | `4,503,599,627,370,496.75` |
| `9007199254740993.5 + 9007199254740993` | `18,014,398,509,481,988` | `18,014,398,509,481,986.50` |
| `2^60 + 0.5` | `1,152,921,504,606,847,000` | `1,152,921,504,606,846,976.50` |
| `9007199254740993.5 == 9007199254740994` | `true` | `false` |
| `0.1 + 0.2` | `0.30` | `0.30` |

The boundary: below that magnitude the double already rounds to the right digits, so nothing a smaller number shows changes. A value with no exact reading keeps its double (`sqrt(2^106) + 0.5` is `9,007,199,254,740,992`), and so does a quantity with a unit (`9007199254740993.5 m` is `9,007,199,254,740,994.00 m`), as a whole literal with a unit already did; money keeps its exact decimal as before. An exact decimal past the 34-digit limit leaves the exact path in arithmetic, as it did. The big integers page gains the decimal case beside the whole one.

## Verification

`FoundBug_decimalLiteralPastSafeRange.spec.ts` holds 31 tests: the lines that exposed it and their neighbours, comparisons and a check, the lines that must not change, the unit and inexact boundary, a German-grouped literal, unit tests of `exactDigitsWhereDoubleCannot` (ordinary, whole, the magnitude thresholds, no exact value, NaN and the infinities, place counts out of range, a 300-digit decimal) and of the exact reading through `compareRationalOperands` and `exactRationalOp`, and the adversarial cases (long literals and a long sum of them, look-alike digits, zero-width and direction characters, markup and prototype words, a literal from the line above through both document passes, and every numeric edge beside it). `AdversarialFeatureSweep.spec.ts` gains the form `X + 9007199254740993.5`.

The fast suite ran across 767 suites (25,907 of 25,912 tests passed, 4 skipped); its one failure was `LlmsTxt.spec.ts`, since the pages changed, and it passes after `docs/public/llms-full.txt` was regenerated. `npm run typecheck`, `typecheck:tests` (at its baseline of 92 errors in 29 files, none new), `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar` and the proven docs examples passed, and `executeBytecode` measured 44,322 bytes by hand, unchanged (`lint:dispatch-size` cannot find its spec inside a worktree). `npm run verify` as one command was not run.
