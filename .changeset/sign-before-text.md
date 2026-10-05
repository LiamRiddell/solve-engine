---
"solve-engine": patch
---

A minus or plus sign before text is refused by name, so `-"abc"` is no longer 0, and `-"0xFF" as number` points at `-("0xFF" as number)`

A sign read its text through the numeric reading text has, which is its leading digits or 0, so `-"abc"` answered 0 and `+"abc"` answered 0. The same reading made `-"0xFF" as number` answer 0: the minus binds to the text before `as number` does, so the line negated the text, got 0, and converted the 0. Text is already refused in arithmetic by name (`TEXT_ARITHMETIC`), and a sign is arithmetic, so a minus or a plus before text is now refused the same way. Text that holds a number is pointed at the conversion in brackets, which is the line the reader meant, and `-("0xFF" as number)` gives -255 as it did.

| line | before | now |
| --- | --- | --- |
| `-"abc"` | `0` | Text cannot be negated: a minus sign works on numbers and quantities, not text. To negate a number held as text, convert it first with "as number", in brackets. |
| `-"0xFF" as number` | `0` | Text cannot be negated: a minus sign works on numbers and quantities, not text. To negate the number "0xFF" holds, convert it first, in brackets: -("0xFF" as number). |
| `-"5"` | `-5` | refused, pointing at `-("5" as number)` |
| `+"abc"` | `0` | Text has no sign: a plus sign works on numbers and quantities, not text. To read a number held as text, convert it with "as number". |
| `-("0xFF" as number)` | `-255` | `-255` |
| `"-5" as number` | `-5` | `-5` |

The boundary: `-"5"` is refused too, though its digits are a number, because quoted digits are text everywhere else in arithmetic (`"5" * 2` is refused), and reading them here alone would make the sign the one operator that converts. A sign inside the quotes is part of the text, so `"-5" as number` is -5. The text operations page explains how the minus binds.

## Verification

`FoundBug_signBeforeText.spec.ts` holds 14 tests: each sign before text that is and is not a number, empty text, the bracketed conversion and the signed forms that must not change; unit tests of `textSignRefused` (each sign, text holding a decimal or a base number, empty and blank text, a malformed base, padding, a long text quoted short, markup, a prototype word); and the adversarial cases (prototype words as text and as a name holding text with `Object.prototype` unchanged, a hundred thousand characters, two thousand signs in a row, digits from other scripts, text edges, text from a line above with arithmetic and a check through both document passes, every numeric edge written as text after each sign). `AdversarialFeatureSweep.spec.ts` gains `-("0xFF" as number) + X`, `-"X"` and the prototype-word form `-"X"`.

The fast suite ran across 800 suites (28,880 of 28,884 tests passed, 4 skipped, none failed), and `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, the proven docs examples, the hardening and integration suites and the dispatch-loop size check (44,791 bytecode bytes) passed. `npm run verify` as one command, the bundled-consumer contract and the benchmarks were not run.

On top of main, the full suite ran 30,590 tests in 816 suites, all passing but 4 skipped, and `npm run test:temporal` passed its 3,527 tests.
