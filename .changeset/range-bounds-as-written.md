---
"solve-engine": patch
---

A range that counts down is refused with its bounds as the reader wrote them: `total(1 + 24:00)` names `1 + 24` and `00`, with the numbers 25 and 0 they came to, where it named only 25 and 0

In the list that `sum`, `total`, `prod`, `map` and `reduce` work through, a colon is a range, so in `total(1 + 24:00)` the bounds are `1 + 24` and `00` (found bug, no issue). The bounds are worked out before the range is built, and the refusal showed only what they came to: "A range's min (25) cannot be greater than its max (0)", two numbers nobody typed. The parser now keeps each side's text beside a range whose sides are more than plain whole numbers (a new opcode, `RANGE_NEW_WRITTEN`, with the two texts as operands), and the refusal quotes it, adding the number when the two differ (`vm/RangeBounds.ts`). A range of two plain numbers compiles to the same bytecode as before.

| line | before | now |
| --- | --- | --- |
| `total(1 + 24:00)` | `A range's min (25) cannot be greater than its max (0). Did you mean "0:25"?` | `A range's min (1 + 24, which is 25) cannot be greater than its max (00, which is 0). Did you mean "0:25"?` |
| `sum(1+24:00)` | `A range's min (25) cannot be greater than its max (0). Did you mean "0:25"?` | `A range's min (1+24, which is 25) cannot be greater than its max (00, which is 0). Did you mean "0:25"?` |
| `total(2*3:1)` | `A range's min (6) cannot be greater than its max (1). Did you mean "1:6"?` | `A range's min (2*3, which is 6) cannot be greater than its max (1). Did you mean "1:6"?` |
| `sum(x:1)`, with `x = 5` above | `A range's min (5) cannot be greater than its max (1). Did you mean "1:5"?` | `A range's min (x, which is 5) cannot be greater than its max (1). Did you mean "1:5"?` |
| `sum(5:1)` | `A range's min (5) cannot be greater than its max (1). Did you mean "1:5"?` | the same (unchanged) |

The boundary: the colon in that list stays a range, as it was designed, rather than becoming a refusal of `24:00` as a time; the refusal now shows which reading it took, through the reader's own text. The suggestion stays in numbers, since the two sides swapped as written (`00:1 + 24`) read worse than the range they come to. A side longer than 64 tokens is named by its number alone, and a side past 40 characters is shortened.

## Verification

`FoundBug_rangeBoundsAsWritten.spec.ts` holds 19 tests: each line through `evaluateExpression`, the single-line `evaluateLine`, `parseDocument` and `evaluateDocument`, with the two document passes agreeing on a bound read from the line above; every place a range is written (the element form, `map`, `reduce`, a list slice); unit tests of `boundAsWritten`, `descendingRangeMessage`, `isPlainNumber`, `tokensBack` and `emitRange`, and of `RANGE_NEW_WRITTEN` in the VM with a hand-built stream, including an operand past the string pool, which is refused as malformed bytecode; and adversarial cases from the kit (prototype words as bounds, a 200-term side, a 2,000-term sum, a huge range, deep brackets, 150 ranges on one line, digits from another script, a fullwidth colon, a zero-width space, a direction override, markup, the text and numeric edges, a typo, a check, a tag, a section, the edit the suggestion names, CRLF and a blank line). The operand-width corpus reaches the new opcode, the bytecode fuzzer emits it, the adversarial sweep has the new templates, and the map, reduce and aggregates page has proven examples.

Gates run: `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:changeset`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, `lint:dispatch-size` (the dispatch loop at 46,202 bytecode bytes, under its margin); the docs examples, the `NormaliserRulesRejectCheaply` oracle and the operand-width spec; and the fast suite (837 suites, 32,395 tests passing). `npm run verify` and the bundled-consumer contract were not run.

On top of main, the full suite ran 35,461 tests in 864 suites, all passing but 5 skipped, and `npm run test:temporal` passed its 3,777 tests.
