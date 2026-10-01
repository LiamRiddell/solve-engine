---
"solve-engine": patch
---

A function of one number works on a list number by number: `sqrt([4, 9])` is `[2, 3]`, where it answered `0`

A list is a matrix, and a matrix reads as 0 wherever one number is asked of it, so every builtin that reads one number answered a list with its answer for 0: `sqrt([4, 9])` was 0, `cos([0, 1])` was 1, `fact([3, 4])` was 1 and `hex([10, 11])` was `0x0` (found in testing). The rounding family was fixed for lists before this; the rest were not. The call is now decided once, where a builtin is called (`listBuiltinCall` in `vm/VMBuiltins.ts`), not in each builtin. A function of one number with an answer for each number (`sqrt`, `cbrt`, `exp`, `ln`, `log`, the trigonometric and hyperbolic functions and their inverses and degree forms, `sign`, `trunc`, `fact`, `degtorad`, `radtodeg`, `fround`, `clz32`) is worked out for each cell and keeps the list's shape (`applyEachCell` in `vm/ListArguments.ts`), as element-wise arithmetic and rounding already treat a list. Any other builtin that reads its inputs as single numbers (`gcd`, `lcm`, `root`, `atan2`, `imul`, `hex`, `bin`, `combination`, `permutation`, `isprime`, `nextprime`, `modpow`, `modinv`, `re`, `im`, `conj`, `log ... base`, `clamp`, the proportion phrase), and the phrase forms that read one number (a rate such as `[1, 2] per hour`, `at` a speed, a split, `in hours and minutes`), refuse a list by name and point at `map` (`LIST_ARGUMENT_UNSUPPORTED`); those phrase forms answered `0.00 /hour`, `0 each` and `0 hours 0 minutes`. A number in the list with no real answer, or a cell that is not a number, refuses the list rather than being left out (`LIST_CELL_UNSUPPORTED`).

| line | before | now |
| --- | --- | --- |
| `sqrt([4, 9])` | `0` | `[2, 3]` |
| `cos([0, 1])` | `1` | `[1, 0.54]` |
| `sin([30 deg, 90 deg])` | `0` | `[0.50, 1]` |
| `[3, 4]!` | `1` | `[6, 24]` |
| `ln([1, 2])` | ln(0) has no real value | `[0, 0.69]` |
| `sqrt([4 m2, 9 m2])` | `0` | `[2.00 m, 3.00 m]` |
| `hex([10, 11])` | `0x0` | hex takes numbers, not a list: a list holds several numbers, and hex works on one at a time. To work it out for each number, use map, with x standing for each one. |
| `root(3, [8, 27])` | `0` | root takes numbers, not a list: a list holds several numbers, and root works on one at a time. To work it out for each number, use map, with x standing for each one. |
| `[1, 2] per hour` | `0.00 /hour` | This calculation takes numbers, not a list: a list holds several numbers, and it works on one at a time. To work it out for each number, use map, with x standing for each one. |
| `sqrt([4, -9])` | `0` | sqrt of -9 in this list has no real answer, and a list holds real numbers. Work that number out on its own line. |

The boundary: `abs` is unchanged, since `abs` of a square matrix is its determinant (the `|a|` notation), so `abs([-1, 2])` is still refused as a determinant of a matrix that is not square. The builtins that take a list as a whole (`sum`, `total`, `det`, `inv`, `dot`, `transpose`, the statistics, `round` and `int`) are unchanged, and `min`, `max`, `hypot` and `median` keep their own refusal of a bracketed list. A list of one cell is still the one number it holds. A builtin that refuses a list could work it out for each number instead; `map` does that today, and leaving the choice to the reader keeps `gcd([4, 6], 2)` from being guessed at.

## Verification

`FoundBug_listBuiltins.spec.ts` holds 68 tests: the lines that exposed it through `evaluateExpression` and `evaluateLine`, every refused builtin by name, the phrase forms that read one number, every function worked for each number checked against the same function on each number alone, the builtins that take a list unchanged, a list of one, both document passes agreeing; unit tests of `applyEachCell` (shape, unit, each cell's exact decimal, a list of one, zero, negative zero and the extreme doubles, a cell of true or false, a cell with no real answer, a cell's own refusal, answers in two units, fifty thousand cells), `listArgumentRefused` and `listBuiltinCall`, and the two index sets; the adversarial cases (prototype words as a cell and as a function name with `Object.prototype` unchanged, five thousand cells, a long sum, a huge range and deep brackets in time, markup-shaped and look-alike cells, a list from the line above with a check and a section around it, a unit that does not fit, an edit from a number to a list, rounding and arithmetic after it, zero, negative zero, infinities, 2^53, the largest factorial, every numeric edge with `sqrt`, `sin` and `gcd`, CRLF and a trailing newline); and one `test.failing` pinning a separate bug the sweep found, `[100, 200] + 10%` answering `[100.10, 200.10]`. The pin in `FoundBug_listRounding.spec.ts` turned red with the fix and is now a passing test. `AdversarialFeatureSweep.spec.ts` gains `sqrt([X, 9])` and `gcd([X, 6], 2)`. Gates run: `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:changeset`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, the docs example specs, batch AC's six found-bug specs, the hardening and integration specs, and the whole fast suite.
