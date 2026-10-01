---
"solve-engine": patch
---

A chained check is every link at once, and a check against an infinity is ordered as the comparisons order it

`check 1 == 1 == 1` answered false. The check read one comparison and left the second `== 1` to the rest of the line, which compared the check's tick with 1; `check 1 < 2 > 0` was false the same way. `checkParselet` now reads a whole chain: each link but the last is a new plugin function, `checkLink`, which hands its right side on to the next link when it holds and its failure otherwise, so a side two links share is worked out once and the first link that fails is the one reported. A `within` margin belongs to the last link, the comparison it is written after, and a comparison, `|`, `&` or `xor` written after a check is refused by name (`CHECK_JOIN_UNSUPPORTED`) rather than applied to the tick.

Proving the chain over the numeric edges found a second fault in `checkComparison`: a margin scaled by an infinity was itself infinite and made every pair equal, so `check 0 < 1/0` failed with "0 is not less than ∞" and `check 1/0 == 1/0` with "∞ is not equal to ∞". A side with no finite value is now ordered as the comparison operators order it, after any exact order, so two whole numbers past 1.8e308 are still told apart by their digits.

| line | before | now |
| --- | --- | --- |
| `check 1 == 1 == 1` | false | ✓ |
| `check 1 < 2 > 0` | false | ✓ |
| `check 1 < 3 < 2` | true | check failed: 3 is not less than 2 |
| `check 0 <= 5 <= 10` | true | ✓ |
| `check 22/7 ≈ 3.14 ≈ pi within 0.1%` | Expected an operator or the end of the line, but found "≈" | ✓ (differs by 0.05%) |
| `check 0 < 1/0` | check failed: 0 is not less than ∞ | ✓ |
| `check 1/0 == 1/0` | check failed: ∞ is not equal to ∞ | ✓ |
| `check 1 == 1 \| 2` | 2 | a check ends with its comparison, so "\|" after it is not read. Put a side in brackets to use "\|" in it, or join two checks with "and" |

The boundary. Only a check reads a chain this way. A bare comparison still groups from the left, so `1 == 1 == 1` and `1 < 2 < 3` answer as they did. A margin written in the middle of a chain (`check a ≈ b within 1% ≈ c`) is refused, since it could belong to either link. A chain is bounded by the engine's complexity limit for a line, which refuses one of six hundred links by name. The checks page shows the chained form beside the joined one.

## Verification

`FoundBug_chainedCheck.spec.ts` holds 48 tests: the lines that exposed it, the bare comparison unchanged, a margin on the last link and the reported document through both passes, the infinities through a check and the unit tests of `checkComparison` on them, of `comparisonOf` (each comparison, other tokens, prototype-named token types), `checkLink` (a link that holds hands on its own right side, a failure, a refusal, missing arguments) and `refusalAfterCheck`, and of `checkParselet` reading a chain to the end on a parser holding only the comparisons, and the adversarial cases: prototype words in a chain and as a variable with the prototype checked, a two-hundred-link chain, a six-hundred-link one refused, deep brackets in a link, a long sum and a thousand chained lines, look-alike and markup-shaped text, a half-written line, a unit that does not fit, a what-if, a total that steps over the check, an edit in the live evaluator, the host's check count, an explanation that names no internal function, zero and negative zero, 2^53 and the 34-digit limit, every numeric edge as a chain's middle, and CRLF and blank lines. `FoundBug_checkWithBaseConversion.spec.ts` pinned the old leftover (`check 255 as hex == 255 == 255` left `== 255` unread); that case now reads to the end. The adversarial sweep gains the forms. The fast suite (`npm run test:ci`, run with the worktree path let through its ignore list) ran 26,876 tests in 776 suites: 26,872 passed and 4 were skipped, the proven docs examples, the hardening and integration suites among them, and `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet` and `lint:sidebar` passed.
