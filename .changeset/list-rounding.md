---
"solve-engine": patch
---

A list is rounded number by number: `[0.001, 0.006] to 4 dp` is `[0.0010, 0.0060]`, where it answered `0.0000`

A list is a matrix, and a matrix reads as 0 wherever one number is asked of it, so every rounding form (`to N dp`, `to N sf`, `round`, `ceil`, `floor`, `int`, `as int`, and `rounded` and `to nearest`, which are built from them) rounded that 0 and answered a single zero for the whole list (found in testing). A list is now rounded cell by cell (`roundEachCell` in `vm/ListRounding.ts`), keeping its length, order and unit, and each cell is shown to the places its rounding set (`MatrixData.places`), as the same number is on its own line. A cell rounds from the decimal it is written as, so `[1.005] to 2 dp` goes up to 1.01 as `1.005 to 2 dp` does. The conversions that write one number (`as sci`, `as %`, `as fraction`, `as number`, `in hex`, binary and octal) answered `0e+0`, `0.00%`, `0` and `0x0`; a list has no single number for them, so each refuses it by name (`LIST_CONVERSION_UNSUPPORTED`). `in km` already converted a list.

| line | before | now |
| --- | --- | --- |
| `[0.001, 0.006] to 4 dp` | `0.0000` | `[0.0010, 0.0060]` |
| `map(x/1000, 1:3) to 4 dp` | `0.0000` | `[0.0010, 0.0020, 0.0030]` |
| `round([1.5, 2.4])` | `0` | `[2, 2]` |
| `[1234, 0.5] to 2 sf` | `0.0` | `[1,200, 0.50]` |
| `[12, 37] to nearest 10` | `0` | `[10, 40]` |
| `[1.5, -2.5] as int` | `0` | `[1, -2]` |
| `[1234, 5678] as sci` | `0e+0` | A list cannot be written in scientific notation: it holds several numbers, not one. Convert one value at a time. |
| `[0.5, 0.25] as %` | `0.00%` | A list cannot be written as a percentage: it holds several numbers, not one. Convert one value at a time. |
| `[true, false] to 2 dp` | `0.00` | A list can be rounded only when every cell is a number: this one holds a true or false. |

The boundary: only the rounding forms and the one-number conversions are covered. The other builtins that read one number (`sqrt`, `sin`, `log` and the rest) still read a list as 0, so `sqrt([4, 9])` answers 0; that is a separate fix, pinned as a `test.failing` in the spec. A list of one cell is still rounded as the one number it is. The places a list was rounded to are a display setting like a number's, so arithmetic on the list afterwards re-decides them.

## Verification

`FoundBug_listRounding.spec.ts` holds 44 tests: the lines that exposed it through `evaluateExpression` and `evaluateLine`, the one-number conversions refused by name, `int`, `as int` and `as number` on a list, both document passes agreeing, a cell rounding as the same number does alone; unit tests of `cellDecimal` (ordinary; boundary: zero, negative zero, exponent forms, the extreme doubles; hostile: infinities and NaN), `isManyCellList`, `roundEachCell` (shape, unit, places, each cell's exact decimal, a list of one, a cell of true or false, a refusing rounding, fifty thousand cells) and `listConversionRefused`; the adversarial cases (prototype words as a cell with `Object.prototype` unchanged, five thousand cells, a long sum and a huge range in time, markup-shaped and look-alike cells, a list from the line above, a check and a section around it, arithmetic after the rounding, an edit from a number to a list, zero, negative zero, halves, the place limit, every numeric edge with `to 2 dp` and `to 3 sf`, CRLF and a trailing newline); and one `test.failing` pinning `sqrt([4, 9])`. `AdversarialFeatureSweep.spec.ts` gains `[X, 0.006] to 4 dp`, `[X, 2] to 2 sf` and `[X, 2] as sci`. Gates run: `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:changeset`, `lint:error-codes`, `lint:docs`, the docs example specs, the format and map-reduce specs, the hardening and integration specs, and the whole fast suite.
