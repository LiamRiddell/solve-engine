---
"solve-engine": patch
---

A decimal past 2^53 is cut to its whole number exactly before it is written in a base, so `12345678901234567890.5 in hex` is 0xAB54A98CEB1F0AD2

A base conversion truncates a fraction, toward zero, but it read the number's floating-point value to do it. Past 2^53 that value holds no fraction and can sit some way from the number typed: the double nearest 12,345,678,901,234,567,890.5 is 12,345,678,901,234,567,168, so its hex digits ended `0800`. The literal keeps its exact decimal, and a sum such as `2^60 + 1.5` keeps its exact fraction, so `in hex`, `in binary`, `in octal` and `hex()` now cut that exact value to its whole number first and write the whole number's digits.

| line | before | now |
| --- | --- | --- |
| `12345678901234567890.5 in hex` | `0xAB54A98CEB1F0800` | `0xAB54A98CEB1F0AD2` |
| `-12345678901234567890.5 in hex` | `-0xAB54A98CEB1F0800` | `-0xAB54A98CEB1F0AD2` |
| `(2^60 + 1.5) in hex` | `0x1000000000000000` | `0x1000000000000001` |
| `12345678901234567890 in hex` | `0xAB54A98CEB1F0AD2` | `0xAB54A98CEB1F0AD2` |
| `255.7 in hex` | `0xFF` | `0xFF` |

The boundary: a number typed in exponent form (`1e30`) names a floating-point number rather than a decimal, as it does everywhere else, so its digits are that number's. A decimal whose point sits more than 340 places from its digits keeps the floating-point path, since its whole part is zero or its value is already past the largest number. The number bases page shows the cut under "A base is still a number".

## Verification

`FoundBug_decimalPastSafeRangeInABase.spec.ts` holds 18 tests: the lines that exposed it in each base and sign, a sum carrying an exact fraction, arithmetic and `as number` on the result, and the forms that must not change; unit tests of `truncatedDecimal` (either sign, a whole decimal, trailing zeros, a value below one, the largest scale either way, and a scale past it, not whole or NaN) and of `baseConversionOperand` (an exact decimal and fraction past and within 2^53, a plain double, money, a percentage and text); and the adversarial cases (prototype words with `Object.prototype` unchanged, a long sum, deep brackets, a huge power, a 34-digit decimal, text edges and look-alike digits, a value from the line above with a what-if and a check through both document passes, and every numeric edge plus a large fraction in each base). `AdversarialFeatureSweep.spec.ts` gains `(X + 12345678901234567890.5) in hex`.

The fast suite ran across 792 suites (27,759 of 27,763 tests passed, 4 skipped, none failed), and `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, the proven docs examples and the hardening and integration suites passed. `npm run verify` as one command and the benchmarks were not run.

On top of main, the full suite ran 30,590 tests in 816 suites, all passing but 4 skipped, and `npm run test:temporal` passed its 3,527 tests.
