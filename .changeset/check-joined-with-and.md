---
"solve-engine": patch
---

Comparisons joined with `and` in a check are one check of all of them, and `or` is refused by name

`check 1 == 1 and 1 == 1` answered "Text and a number cannot be added". The check read its first comparison and stopped, and the line went on to add the check's tick to the second comparison, since `and` between two values is also addition (`5 and 3` is 8); `check 1 == 1 or 1 == 2` answered false, the tick read as a yes-or-no answer. `checkParselet` now reads comparisons joined with `and` or `&&` as one check, joined by a new plugin function, `checkBoth`: it passes when every part holds, keeps the margin each approximate part passed by, and fails with the first part that does not. `or` and `||` are refused by name (`CHECK_JOIN_UNSUPPORTED`), pointing at the form that already works.

| line | before | now |
| --- | --- | --- |
| `check 1 == 1 and 1 == 1` | Text and a number cannot be added: + joins text only to other text. To add a number held as text, convert it first with "as number". | ✓ |
| `check 1 == 1 and 1 == 2` | Text and a number cannot be added: + joins text only to other text. To add a number held as text, convert it first with "as number". | check failed: 1 is not equal to 2 |
| `check 1 == 1 && 2 > 1` | false | ✓ |
| `check 22/7 ≈ pi within 0.1% and 5 m ≈ 5.01 m within 1 cm` | Expected an operator or the end of the line, but found "≈" | ✓ (differs by 0.04% and by 0.01 m) |
| `check 1 == 1 or 1 == 2` | false | a check states things that must all hold, so it joins them with "and", not "or". To check that one of two things holds, compare the answer, as in "check (:a > 0 or :b > 0) == true" |

The boundary. A check states what must hold, so `or` is not read as a way to join its parts: it would let a broken part pass unnoticed, and `check (A or B) == true` already says the weaker thing when it is meant. A joined line is one check in a host's `checks` count, however many parts it has. Each part is worked out whatever the others answer, and when several fail the first written is reported. Outside a check, `and` keeps both its meanings (`5 and 3` is 8, `5 > 3 and 2 > 1` is true). The checks page gains a section on stating several things at once, with the chained and the joined forms as proven examples.

## Verification

`FoundBug_checkJoinedWithAnd.spec.ts` holds 26 tests: the lines that exposed it, `or` refused and the form it points to, the other meanings of `and` unchanged and the reported document through both passes, the unit tests of `checkBoth` (two ticks, each margin kept, the combined answer still counted as a check, and anything but two ticks refused) and of `refusalAfterCheck` on both spellings of `or`, and the adversarial cases: prototype words on either side and as a variable with the prototype checked, a hundred and four hundred parts in one line, deep brackets and a thousand joined lines, a Cyrillic letter in `and`, a zero-width character, every text edge and markup-shaped text, a half-written line, a part that is not a comparison, a unit that does not fit and an unknown name on either side, a what-if, a total that steps over the check, an edit in the live evaluator, the host's check count, an explanation that names no internal function, zero, 2^53, the infinities and 0/0, every numeric edge on each side, and CRLF. The new code `CHECK_JOIN_UNSUPPORTED` is catalogued, in the snapshot and reachable from a line. The fast suite (`npm run test:ci`, run with the worktree path let through its ignore list) ran 26,876 tests in 776 suites: 26,872 passed and 4 were skipped, the proven docs examples, the hardening and integration suites among them, and `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet` and `lint:sidebar` passed.

On top of main, the full suite ran 29,773 tests in 801 suites, all passing but 4 skipped once two package pages and one spec linked main's createQueryResolver section by its heading (in this change), and `npm run test:temporal` passed its 3,509 tests.
