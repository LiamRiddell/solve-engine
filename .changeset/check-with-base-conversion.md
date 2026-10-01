---
"solve-engine": patch
---

A conversion on either side of a comparison or a check belongs to its own side

`check 255 in hex == 255` was refused with "a check compares two things", and `A in hex == B in hex` (with `A = 255` and `B = 0xff` above it) answered `0x1`. Both had one cause: a display conversion (`as hex`, and `in hex`, which is read as it) bound at the same level as the comparisons. A check read each side at that level, so its left side stopped before the `as` and found no comparison sign after it, and in a bare comparison the second conversion took the whole comparison as its operand, `((A in hex) == B) in hex`, the hex form of true. The comparisons now bind one step looser than the phrase operators (`BindingPower.Comparison`, below `Conditional`, in `parser/BindingPower.ts`), and a check reads each of its sides at that level. A number shown in a base is still the number, so the check passes, as `check 1 km in m == 1000 m` always has. `getBindingPower` also answers 0 for a name every object inherits (`constructor`, `toString`), where it answered the inherited function.

| line | before | now |
| --- | --- | --- |
| `check 255 in hex == 255` | a check compares two things, as in "check :spent <= :budget" or "check 22/7 ≈ pi within 0.1%" | ✓ |
| `check 255 in hex == 0xff in hex` | a check compares two things, as in "check :spent <= :budget" or "check 22/7 ≈ pi within 0.1%" | ✓ |
| `check 255 in binary == 0xff in octal` | a check compares two things, as in "check :spent <= :budget" or "check 22/7 ≈ pi within 0.1%" | ✓ |
| `255 in hex == 0xff in hex` | 0x1 | true |
| `255 in binary == 0xff in octal` | 0o1 | true |
| `check 800 to 1000 == 25%` | a check compares two things, as in "check :spent <= :budget" or "check 22/7 ≈ pi within 0.1%" | ✓ |
| `check 40 is what % of 50 == 80%` | a check compares two things, as in "check :spent <= :budget" or "check 22/7 ≈ pi within 0.1%" | ✓ |
| `5 > 3 as number` | 1 | true |

The boundary. Every phrase operator at `Conditional` now reads on its own side of a comparison, not only the conversions: a percentage change (`to`) and `is what % of` on a check's side are read whole too, as the table shows. The one line whose meaning changes is a conversion written after the right-hand side of a comparison, which is now that side's: `5 > 3 as number` converts the 3, and `(5 > 3) as number` still converts the answer, 1. The other `in` forms are unchanged: a unit conversion (`5 km in m`), an address in a block (`192.168.1.7 in 192.168.1.0/24`), a proportion (`5 km is to 500m as 5 cm is to what`) and `20 to 40 as x` read as they did, and comparison chains (`1 < 2 < 3`) still group from the left. The checks, number bases and conditionals pages show the forms, and the operator and converter guides for package authors name the two levels.

## Verification

`FoundBug_checkWithBaseConversion.spec.ts` holds 57 tests: the lines that exposed it and the reported document through both passes, the existing `in` and `as` forms beside them, the unit tests of the binding-power ladder and of `getBindingPower` (ordinary, an unknown or empty name, and every prototype word), of `ComparisonParselet` with `as` beside it on a parser holding only the two, and of `checkParselet` reading each side to the comparison sign (a missing comparison, a missing converter name and a hostile one), and the adversarial cases: prototype words as a side, a target and a variable with the prototype checked, look-alike and markup-shaped text on either side, a five-hundred-link chain, a long sum, deep brackets and a thousand check lines, a typo in the base, a side that is not a number, values from the lines above, a line reference, an edit in the live evaluator, a total under a check, zero and negative zero, 2^53 + 1, the 34-digit literal, the largest double, an infinity, every numeric edge on both sides, and CRLF and blank lines. The adversarial sweep gains the forms. The fast suite (`npm run test:ci`, run with the worktree path let through its ignore list) ran 26,301 tests in 769 suites: 26,297 passed and 4 were skipped, the proven docs examples, the hardening and integration suites among them, and `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet` and `lint:sidebar` passed.
