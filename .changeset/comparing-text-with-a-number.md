---
"solve-engine": patch
---

A comparison treats text and a number as two kinds of thing, as a check does, so `255 == "255"` is false and `"5" > 3` is refused by name

A comparison read text through its numeric reading, so `255 == "255"` was true while `check 255 == "255"` was refused as `CHECK_INCOMPARABLE`, and the same reading made `"abc" == 0` true (text that is not a number read as 0), `"5" > 3` true, and `"a" < "b"` and `"b" > "a"` both false. The conditionals page and the existing tests pinned none of this. `==` between text and a value that is not text now answers false and `!=` true, the answer it already gives for a length beside a mass, and `<`, `<=`, `>` and `>=` with text on either side are refused with the new `TEXT_COMPARISON`, which says which side is text and, for text that holds a number, points at `as number`, as a check's refusal does.

| line | before | now |
| --- | --- | --- |
| `255 == "255"` | `true` | `false` |
| `"abc" == 0` | `true` | `false` |
| `if "5" == 5 then 1 else 2` | `1` | `2` |
| `"5" > 3` | `true` | "5" on the left is text and the other side is a number, so they cannot be put in order. To read the text as a number, write "5" as number. |
| `"a" < "b"` | `false` | Text has no order: two pieces of text can only be compared with == or !=, not <. |
| `"255" as number == 255` | `true` | `true` |
| `"paid" == "paid"` | `true` | `true` |

The boundary, and why `==` answers rather than refuses: a condition such as `if status == "paid"` has to work whatever the variable holds, and `==` already answers false for two things that cannot be equal (`1 m == 1 kg`). A check is stricter, since a check that cannot hold is a mistake in the note, and it keeps its refusal; the checks page now says how the two differ, and the conditionals page has a section on comparing text.

## Verification

`FoundBug_comparingTextWithANumber.spec.ts` holds 23 tests: each equality and each refused order, the forms that must not change and the check beside them; unit tests of `textAgainstOther`, `textOrderRefused` (every operator, empty and long text, a number in a base, markup and a prototype word), `valuesEqual` and `valuesOrdered` (text beside each kind, and a fault that still wins); and the adversarial cases (prototype words with `Object.prototype` unchanged, a long text, deep brackets, look-alike digits and a zero-width space, text edges, text from a line above in a condition, a what-if and an order through both document passes, and every numeric edge against its own text). `ErrorCodeReachability.spec.ts` reaches `TEXT_COMPARISON` with `"5" > 3`, and `AdversarialFeatureSweep.spec.ts` gains `X == "X"`, `X != "X"` and `"X" > X`, and the prototype-word forms `X == "X"` and `"X" < 1`.

The fast suite ran across 792 suites (27,759 of 27,763 tests passed, 4 skipped, none failed). `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, the proven docs examples and the hardening and integration suites passed, with `guide/error-codes.md` regenerated. `npm run verify` as one command and the benchmarks were not run; the plain-number comparison path is untouched.
