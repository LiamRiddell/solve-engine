---
"solve-engine": patch
---

A typed hex, binary or octal literal past 2^53 keeps every digit, so `0xFFFFFFFFFFFFFFFFFFFF` is 1,208,925,819,614,629,174,706,175

A number typed with a base prefix was read with `parseInt` into the nearest double, so a literal past 2^53 showed its last digits invented: `0xFFFFFFFFFFFFFFFFFFFF` was 1,208,925,819,614,629,200,000,000, while `"0xFFFFFFFFFFFFFFFFFFFF" as number` already gave every digit. A long decimal literal has kept its exact value for some time. A base literal past 2^53 is now compiled from its exact digits to the same opcode a long decimal literal takes, so the engine holds its exact integer, arithmetic on it is exact, and the typed literal and the text read by `as number` agree digit for digit.

| line | before | now |
| --- | --- | --- |
| `0xFFFFFFFFFFFFFFFFFFFF` | `1,208,925,819,614,629,200,000,000` | `1,208,925,819,614,629,174,706,175` |
| `0x20000000000001` | `9,007,199,254,740,992` | `9,007,199,254,740,993` |
| `0b100000000000000000000000000000000000000000000000000001` | `9,007,199,254,740,992` | `9,007,199,254,740,993` |
| `0xFFFFFFFFFFFFFFFFFFFF + 1` | `1,208,925,819,614,629,200,000,000` | `1,208,925,819,614,629,174,706,176` |
| `0xFFFFFFFFFFFFFFFFFFFF in hex` | `0x100000000000000000000` | `0xFFFFFFFFFFFFFFFFFFFF` |
| `0xFF` | `255` | `255` |

The boundary: a literal within 2^53 is read as before, with no bigint built for it, and a literal past about 1.8e308 is infinite, as the same number typed in decimal is. The number bases page shows the long literal.

## Verification

`FoundBug_baseLiteralPastSafeRange.spec.ts` holds 20 tests: each base and case past 2^53, a sign, arithmetic and a base conversion on the result, agreement with `as number`, the forms that must not change; unit tests of `pastSafeBaseLiteralDigits` (each base, 2^53 - 1 and 2^53, Infinity and NaN, a decimal literal, malformed digits, an empty prefix, a point, a prototype word and markup, and agreement with `numberFromBaseText`); and the adversarial cases (prototype words beside a long literal with `Object.prototype` unchanged, literals at and past the double's limit, ten thousand digits within budget, a sum of five hundred long literals, text edges, a digit from another script, a literal from a line above through a what-if and a check in both document passes, every numeric edge added to one). `AdversarialFeatureSweep.spec.ts` gains `0xFFFFFFFFFFFFFFFFFFFF + X`.

The fast suite ran across 800 suites (28,880 of 28,884 tests passed, 4 skipped, none failed), and `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, the proven docs examples, the hardening and integration suites and the dispatch-loop size check (44,791 bytecode bytes) passed. `npm run verify` as one command, the bundled-consumer contract and the benchmarks were not run.
