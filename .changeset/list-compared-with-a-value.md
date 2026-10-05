---
"solve-engine": patch
---

A list compared with one value is compared element by element, so `[100, 200] > 150` is `[false, true]` rather than one `true` or `false` for the whole list

The six comparison operators already compared two lists element by element, but a list beside one value fell through to the last rule, which read each side as one number, and a list's one number is 0. So `[100, 200] < 5` answered `true` and `[100, 200] > 5` answered `false`. Each element now meets the other side as the number or quantity it stands for, by the rule one value follows on its own line, so a list with a unit converts as one quantity does and a length beside a mass is refused for the whole list. The list is read only once the plain-number test has failed, so a comparison of two numbers does no new work. A list of answers joins with `and`, `or`, `&&` and `||` element by element, where `and` used to add the answers as 1 and 0, and `not` negates one element by element.

| line | before | now |
| --- | --- | --- |
| `[100, 200] < 5` | `true` | `[false, false]` |
| `[100, 200] > 5` | `false` | `[true, true]` |
| `5 > [1, 2]` | `true` | `[true, true]` |
| `[100, 200] > 150` | `false` | `[false, true]` |
| `[1, 2] == 1` | `false` | `[true, false]` |
| `[100 m, 200 m] > 150 m` | `false` | `[false, true]` |
| `[1, 2] > 1 and true` | `false` | `[false, true]` |
| `([1, 2] == [1, 2]) and ([1, 2] == [1, 3])` | `[2, 1]` | `[true, false]` |
| `not ([1, 2] > 1)` | `true` | `[true, false]` |
| `if [1, 2] > 0 then 1 else 2` | `2` | refused: `"if" needs one true or false, and this is a list of 2 cells. ...` |
| `check [1, 2] > 0` | `check: [1, 2] and 0 cannot be compared` | `check: [1, 2] is a list, and a check gives one verdict, so it compares one value at a time: ...` |

The boundary: a list of answers is not one answer, so the condition of an `if` refuses a list by name (`LIST_CONDITION_UNSUPPORTED`, new), pointing at one element (`v[0] > 5`) or at `map` to choose for each element, and a `check`, which gives one verdict, names the list in its refusal. Two lists of different shapes are refused as before. A list holds each element as a double, so the one value is compared at that precision: `[1/3] == 1/3` is `[true]`, as `[1/3] == [1/3]` is. `[1, 2] + true` and `[true, false] + 1` still add, since a number is on one side; only two answers, or lists of them, are joined as `and`.

## Verification

`FoundBug_listComparison.spec.ts` holds 52 tests: every operator in both orders, lists with units and money, two lists of one and of different shapes, each element agreeing with the same comparison on its own line, `and`, `or`, `&&`, `||` and `not` over lists of answers, the `if` and `check` refusals, both document passes agreeing and the single-line entry point agreeing with them; unit tests of `listAgainstOne`, `atListPrecision`, `answersCellByCell`, `isListOfAnswers` and `listConditionRefused` (ordinary, empty, the extreme doubles, a cell's refusal, a 50,000-element list) and of the changed `valuesEqual`, `valuesOrdered`, `logicalNot` and `checkComparison`; and the adversarial cases (prototype words with `Object.prototype` unchanged, a 5,000-element list, a long sum, a huge range, deep brackets, text edges and markup-shaped text, a typo, a unit that does not fit, the feature meeting a cell read, a sum, `map`, a conversion and a section, an edit through both passes, every numeric edge, CRLF). The two pins in `FoundBug_listPercentage.spec.ts` are now passing tests, and `AdversarialFeatureSweep.spec.ts` gains six list comparison forms.

The fast suite ran across 870 suites (35,170 of 35,175 tests passed, 5 skipped, none failed). `npm run typecheck`, `typecheck:tests` (at its baseline of 92 errors in 29 files, none new), `lint`, `lint:comments`, `lint:messages`, `lint:changeset`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar` and `lint:dispatch-size` (`executeBytecode` at 47,376 bytes) passed, as did the proven docs examples and the hardening, integration and error-code suites, with `guide/error-codes.md` and `docs/public/llms-full.txt` regenerated. `npm run verify` as one command was not run.

On top of main, the full suite ran 37,299 tests in 887 suites, all passing but 5 skipped, and `npm run test:temporal` passed its 3,839 tests.
