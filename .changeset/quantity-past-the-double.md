---
"solve-engine": patch
---

A quantity past 2^53 keeps the exact value it was written as, so `ceil((2^60 + 0.5) m)` is ...977 m, not a metre short

`ceil((2^60 + 0.5) m)` and `round((2^60 + 0.5) m)` answered 1,152,921,504,606,846,976.00 m, where the answer is ...977, and `(2^60 + 0.5) m` itself was written ...976.00 m. `floor` and `trunc` were right only because the error fell their way. A plain `2^60 + 0.5` keeps its exact value, but giving a number a unit kept that value for money only, and past 2^53 a double holds no fraction, so the half was gone before any rounding ran.

A number past 2^53 now keeps its exact value when it is given any unit, the formatter writes the quantity from it, and `floor`, `ceil`, `round`, `trunc`, `int` and `as int` round it. Adding or subtracting another amount in the same unit and scaling by a plain number keep it exact too. Below 2^53 a quantity is its double, as before.

| line | before | now |
| --- | --- | --- |
| `(2^60 + 0.5) m` | 1,152,921,504,606,846,976.00 m | 1,152,921,504,606,846,976.50 m |
| `ceil((2^60 + 0.5) m)` | 1,152,921,504,606,846,976.00 m | 1,152,921,504,606,846,977.00 m |
| `round((2^60 + 0.5) m)` | 1,152,921,504,606,846,976.00 m | 1,152,921,504,606,846,977.00 m |
| `floor((2^60 + 0.5) m)` | 1,152,921,504,606,846,976.00 m | unchanged |
| `(2^53 + 1) kg` | 9,007,199,254,740,992.00 kg | 9,007,199,254,740,993.00 kg |
| `(2^60 + 0.5) m + 1 m` | 1,152,921,504,606,846,976.00 m | 1,152,921,504,606,846,977.50 m |
| `9007199254740993.5 m as int` | 9,007,199,254,740,994 | 9,007,199,254,740,993 |

The boundary: a conversion into another unit (`in km`), a product of two quantities and `mod` read the double, since a conversion factor is itself a double; so does a fraction that never ends in base ten (`(2^60 + 1/3) m`). Three earlier specs and the big integers page pinned the old answers as the boundary of a length; they now hold the exact ones.

## Verification

`FoundBug_quantityPastTheDouble.spec.ts` (32 tests) holds the lines above through all three entry points and a value from the line above, unit tests of `exactPastTheDouble` and `valueInUnit` (exactly 2^53 and one below, the infinities, NaN, negative zero, text, a fraction that never ends), `exactLargeQuantityOp` (same and different units, a product of quantities, a zero divisor, a scalar with no exact reading, prototype words as the unit) and `roundExactQuantityToWhole` on a length, and the adversarial sides: a huge power, a long sum and deep brackets as the magnitude, prototype words as the unit, every text and numeric edge under each rounding, a check and a column total over it, and the document edges. `FoundBug_roundingMoneyPastSafeRange`, `FoundBug_decimalLiteralPastSafeRange` and `FoundBug_asIntPastSafeRange` were updated where they pinned the old double.

Gates run: `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:changeset`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet` and `lint:sidebar`; the docs, hardening, integration, packages and bugs suites, and the fast suite. `npm run verify` and the bundled-consumer contract were not run.
