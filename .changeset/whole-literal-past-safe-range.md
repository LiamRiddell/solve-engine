---
"solve-engine": patch
---

A whole number typed past 2^53 keeps the digits it was typed with

A double holds every whole number up to 9,007,199,254,740,991 and only some beyond, and the parser read every integer literal as a double, so `9007199254740993` answered 9,007,199,254,740,992, a confident wrong number, while `2^53 + 1`, a result, already kept its exact integer. A literal in plain digits past the safe range is now compiled with its digits (`isPastSafeWholeLiteral`), and the VM pushes it as a number carrying its exact integer (`exactWholeLiteral`), the same sidecar exact-integer arithmetic reads. This was found by an earlier adversarial batch.

| line | before | now |
| --- | --- | --- |
| `9007199254740993` | 9,007,199,254,740,992 | 9,007,199,254,740,993 |
| `9007199254740993 + 1` | 9,007,199,254,740,992 | 9,007,199,254,740,994 |
| `12345678901234567890 + 1` | 12,345,678,901,234,567,000 | 12,345,678,901,234,567,891 |
| `$123456789012345678901234567890123 * 10` | $1,234,567,890,123,456,860,404,939,216,650,240.00 | $1,234,567,890,123,456,789,012,345,678,901,230.00 |

The boundary is the written form. Scientific notation names a double on purpose, so `1e16 + 1 - 1e16` is still 0. A literal too large for any double is infinity, as before, and no big integer is built from it. Past 2^53 a whole number meeting a fraction or a unit reads its nearest double, as `2^53 + 1` already does: `9007199254740993 * 0.5` and `9007199254740993 m` are unchanged. The big-integers page says so, with the new lines proven, and the money-precision page's 35-digit example now shows the nearest double to the true product, `$1.234567890123457e+34`.

## Verification

`FoundBug_wholeLiteralPastSafeRange.spec.ts` (23 tests) holds the lines above, the safe range and scientific notation unchanged, the fraction and unit boundary, the chained-dot grouping under a German locale, unit tests of `isPastSafeWholeLiteral` and `exactWholeLiteral` (other scripts' digits, a 400-digit literal, prototype words), and the adversarial sides: a literal past the line limit refused by name, zero-width and direction characters, markup, the value from the line above through both passes and the single-line path, and every numeric edge beside it. Three existing specs that pinned the rounded literal (`ArithmeticFloatingPoint`, `ArithmeticExactIntegers`, `Issue828_vectorFunctionChecks`) and one that pinned the invented money digits (`Issue735_moneyDigitCeiling`) are updated.

Gates run: `npm run typecheck`, `typecheck:tests` (at the baseline, which fell by two), `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, `lint:units` and `lint:links` passed; the docs, hardening and integration suites passed (9,242 tests in 98 suites); the fast suite ran 25,718 tests in 764 suites, all passing but 4 skipped once one merged spec that used `0/0` as a NaN was moved to `1/0 - 1/0`. `executeBytecode` stays under its size margin. `npm run verify` and the bundled-consumer contract were not run.
