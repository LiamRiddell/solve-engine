---
"solve-engine": patch
---

A number written in a base holds the whole number it shows

`255.7 in hex` showed `0xFF`, as the number bases page says ("a fraction is truncated"), but the value under it kept the .7: `255.7 in hex == 255` was false, `(255.7 in hex) + 1` was 256.70, and `check (0.5 in hex) == 0` failed with "check failed: 0x0 is not equal to 0", two sides that read alike. The display was the documented behaviour and the existing tests pinned it, so the value now follows the display: the conversion to a base cuts the fraction off toward zero before it stores the number (`wholeForBase` in `vm/ExactIntegers.ts`, called from `valueInBase`, which `in hex`, `as binary`, `in octal`, `hex()` and `bin()` share). A fraction that leaves nothing, such as `-0.5`, is 0 rather than a negative zero.

| line | before | now |
| --- | --- | --- |
| `255.7 in hex == 255` | false | true |
| `(255.7 in hex) + 1` | 256.70 | 256 |
| `(255.7 in hex) as number` | 255.70 | 255 |
| `check (0.5 in hex) == 0` | check failed: 0x0 is not equal to 0 | ✓ |
| `check 0.5 in hex == 0.5` | ✓ | check failed: 0x0 is not equal to 0.50 |
| `-0.5 in hex` | -0x0 | 0x0 |

The boundary. Only the conversion into a base changes. A number that is never put into a base keeps its fraction (`255.7 + 1` is still 256.70), arithmetic on a value already in a base still answers an ordinary number (`0xFF / 2` is 127.50), and a whole number past 2^53 keeps every digit, as before. The display of a value in a base, the refusal of an infinity and the colour forms of `as hex` are unchanged. The number bases page says the value is truncated with the display and shows it.

## Verification

`FoundBug_fractionInABase.spec.ts` holds 33 tests: the lines that exposed it and the reported document through both passes, the forms beside it that keep their meaning, the unit tests of `wholeForBase` (ordinary, negative zero and the smallest double, 2^53 and the largest double, and a bigint, an infinity and a NaN passed through) and of `valueInBase`, a snapshot round trip, and the adversarial cases: prototype words as a value and a variable with the prototype checked, look-alike digits and markup-shaped text, a long sum, deep brackets and a thousand lines, a value from the line above, a check, a what-if and an edit in the live evaluator, values added by line number, negative fractions, 2^53 plus a half, every numeric edge through two bases, and CRLF. The adversarial sweep gains the forms. The fast suite (`npm run test:ci`, run with the worktree path let through its ignore list) ran 26,876 tests in 776 suites: 26,872 passed and 4 were skipped, the proven docs examples, the hardening and integration suites among them, and `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet` and `lint:sidebar` passed.

On top of main, the full suite ran 29,773 tests in 801 suites, all passing but 4 skipped once two package pages and one spec linked main's createQueryResolver section by its heading (in this change), and `npm run test:temporal` passed its 3,509 tests.
