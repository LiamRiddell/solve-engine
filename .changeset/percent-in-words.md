---
"solve-engine": minor
---

Percentages can be written in words: `15 percent of 60`, `50 increased by 20%`, `reduce 50 by 20%`, `percent change from 50 to 75` and `75 is what % more than 50`

`percent` was read only as a converter's name, after `as`, so a reader who wrote the word instead of the sign got a parse error on the commonest percentage question, and the sentences people use for a change by a percentage were missing (#705).

| line | before | now |
| --- | --- | --- |
| `15 percent of 60` | throws `Unexpected token after expression: "percent"` | 9 |
| `20 is what percent of 80` | throws `Expected "%" after "is what", as in "20 is what % of 200"` | 25.00% |
| `50 increased by 20%` | throws `Unexpected token after expression: "by"` | 60 |
| `reduce 50 by 20%` | throws `Unexpected token after expression: "50"` | 40 |
| `percent change from 50 to 75` | throws `No prefix parselet found for token: CONVERTER_NAME ("percent")` | 50.00% |
| `75 is what % more than 50` | throws `Unexpected token after expression: "more"` | 50.00% |

Each gives the answer of the symbol form it mirrors: `percent` and `percentage` after a number, a bracket or a name are the `%` sign; `increased by`, `decreased by` and `reduced by` are `increase by` and `decrease by` (so `+ 20%` and `- 20%`); `reduce` is `decrease`; `percent change from A to B` is `A to B as %`; and `A is what % more than B` is the change from B to A as a percentage of B, with `less than` for the fall. A change from zero is refused in words as it is in symbols. Money and units carry through (`$50 increased by 20%` is `$60.00`).

The boundary: after `as`, `in` or `to`, `percent` and `percentage` still ask for a number as a percentage (`0.25 as percent` is `25.00%`). `reduce` is also map-reduce's call, so it is read as `decrease` only before an amount and a `by` with a percentage after it; `reduce(...)` with a bracket is map-reduce as before, and `reduce 50 by 20`, with no percentage, is left unread rather than given the decrease form's reading of a bare factor. `100 percent sure` is not a number. The percentages page gains proven examples of each form.

## Verification

`Issue705_percentInWords.spec.ts` holds 31 tests. Each worded form gives the answer of the symbol form it mirrors, `less than` gives the fall and a value above gives a negative one, money, a unit and a negative change carry through, and a zero base is refused in words as in symbols. What must not break is held: `as percent`, `as percentage` and `in percent`, the `increase` and `decrease` forms and the other `by` phrases, `reduce` without a percentage and `reduce` as a name, `percent` in prose, and a name before `percent`. The adversarial cases: prototype words before `percent` and after `is what %`, and `more` without `than`.

The full suite (`npm run test:full`) passed, 15,825 of 15,829 tests in 617 suites with 4 skipped, and `npm run verify:ci` passed end to end, including the three-zone temporal run (2,888 tests in 90 suites each) and the bundled-consumer contract (25 checks against an installed copy, including 1,404 documented examples). `executeBytecode` is unchanged at 47,528 bytecode bytes on Node 24.16.0.
