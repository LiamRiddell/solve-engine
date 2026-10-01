---
"solve-engine": patch
---

`as number` reads the base prefixes a typed number reads, so `"0xFF" as number` is 255, and a malformed one is refused by name

`0xFF` typed in a line is 255, but `"0xFF" as number` was refused as "not a number", because `as number` read decimal digits only. Text often carries a number in another base, from a colour code, a log line or a decoded field. `as number` now reads `0x` (hexadecimal), `0b` (binary) and `0o` (octal) as a typed number does, in either case and after a sign, and reads the digits exactly, so a number past 2^53 keeps every digit. A prefix with no digits after it, or with a digit its base does not have, is refused with `TEXT_NOT_A_NUMBER`, and the message says which digits the base has. A check between such text and a number now offers the `as number` it points at.

| line | before | now |
| --- | --- | --- |
| `"0xFF" as number` | "0xFF" is not a number: "as number" reads text that is a number and nothing else. | `255` |
| `"0b101" as number` | refused | `5` |
| `"-0xff" as number` | refused | `-255` |
| `"0x20000000000001" as number` | refused | `9,007,199,254,740,993` |
| `"0xZZ" as number` | the general refusal | "0xZZ" is not a number: after 0x, a hexadecimal number has only the digits 0 to 9 and the letters A to F. |
| `"0x" as number` | the general refusal | "0x" is not a number: 0x starts a hexadecimal number, and no digits follow it. |
| `"255" as number` | `255` | `255` |

The boundary: a number in a base is a whole number, so a point after the prefix (`"0xFF.8"`) is refused, and a number past about 1.8e308 is the infinity a double holds there, as `"1e400" as number` is. `int` and `float` still read decimal text only. The text operations page shows the prefixes and their refusals.

## Verification

`FoundBug_baseTextAsNumber.spec.ts` holds 27 tests: each prefix in either case and with a sign, padding, a large exact value, arithmetic and a conversion on the result, each malformed form refused by name, the forms that must not change and the check's hint; unit tests of `numberFromBaseText` (each prefix, text with none, zero and negative zero, five hundred leading zeros, 2^53 + 1, the largest double and the first value past it, a long text quoted short, a million digits sized before they are read, markup); and the adversarial cases (prototype words with `Object.prototype` unchanged, digits from other scripts and a zero-width space, text edges, a hundred thousand digits within budget, text from a line above with arithmetic, a what-if and a check through both document passes, and every numeric edge after each prefix). `FoundBug_checkAgainstText.spec.ts` pinned the check's hint as offered for decimal text only and now pins it for a base prefix too. `AdversarialFeatureSweep.spec.ts` gains `"0xFF" as number + X` and the prototype-word form `"X" as number`.

The fast suite ran across 792 suites (27,759 of 27,763 tests passed, 4 skipped, none failed), and `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, the proven docs examples and the hardening and integration suites passed. `npm run verify` as one command and the benchmarks were not run.
