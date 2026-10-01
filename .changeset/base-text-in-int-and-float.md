---
"solve-engine": patch
---

`int` and `float` read the base prefixes `as number` reads, so `int("0xFF")` is 255, and a malformed one is refused with the same message

`"0xFF" as number` reads 255, but `int("0xFF")` was refused as "not a number" and `float("0xFF")` as not a number either, because both read decimal text only. They now read `0x` (hexadecimal), `0b` (binary) and `0o` (octal) through the same reader `as number` uses, in either case and after a sign, keeping every digit of a large one, and a prefix with no digits or with a digit its base does not have is refused with `TEXT_NOT_A_NUMBER` and the message `as number` gives, saying which digits the base has.

| line | before | now |
| --- | --- | --- |
| `int("0xFF")` | "0xFF" is not a number: int reads text that is a number and nothing else. | `255` |
| `float("0xFF")` | float takes a number, or text that is a number, and "0xFF" is not one. | `255` |
| `int("-0b101")` | refused | `-5` |
| `int("0x20000000000001")` | refused | `9,007,199,254,740,993` |
| `int("0xZZ")` | the general refusal | "0xZZ" is not a number: after 0x, a hexadecimal number has only the digits 0 to 9 and the letters A to F. |
| `int("2.7")` | `2` | `2` |
| `float("abc")` | float takes a number, or text that is a number, and "abc" is not one. | unchanged |

The boundary: a number in a base is a whole number, so a point after the prefix (`int("0xFF.8")`) is refused as `as number` refuses it. Text with no prefix keeps each function's own reading and refusal. The text operations and number functions pages show the prefixes.

## Verification

`FoundBug_baseTextInIntAndFloat.spec.ts` holds 21 tests: each prefix, case and sign through both functions, a large exact value, arithmetic and a base conversion on the result, each malformed form refused with the message `as number` gives, the forms that must not change; unit tests of `intOfText` and `floatOf` (each prefix, zero and negative zero, three hundred leading zeros, 2^53 + 1 exact, both infinities past the largest double, markup, a prototype word after a prefix, a million digits sized before they are read, a long text quoted short); and the adversarial cases (prototype words with `Object.prototype` unchanged, digits from other scripts and a zero-width space, text edges through both functions, a hundred thousand digits within budget, text from a line above through a what-if and a check in both document passes, every numeric edge after a prefix). `FoundBug_textInNumericBuiltins.spec.ts` listed `"0x10"` among the texts `int` refuses; it now lists `"0xZZ"` and pins `int("0x10")` as 16. `AdversarialFeatureSweep.spec.ts` gains `int("0xFF") + X`, `float("0b101") * X` and the prototype-word form `int("0xX")`.

The fast suite ran across 800 suites (28,880 of 28,884 tests passed, 4 skipped, none failed), and `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, the proven docs examples, the hardening and integration suites and the dispatch-loop size check (44,791 bytecode bytes) passed. `npm run verify` as one command, the bundled-consumer contract and the benchmarks were not run.
