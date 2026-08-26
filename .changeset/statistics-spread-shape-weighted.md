---
"solve-engine": minor
---

Add spread and shape aggregates and a weighted average (issues #184, #185).

The aggregate family could find a list's centre (`average of`, `median of`) but
said nothing about its variation, and averaged every value as equal. Both gaps
are filled in place, over a bare list and over a table column.

## Spread and shape

`standard deviation`, `variance`, `spread` and `mode` join `average` and
`median`, reading a bare list or a named column the same way.

| expression | result |
| --- | --- |
| `standard deviation of 2, 4, 4, 4, 5, 5, 7, 9` | `2` |
| `variance of 2, 4, 4, 4, 5, 5, 7, 9` | `4` |
| `spread of 3, 7, 2, 9` | `7` |
| `mode of 4, 2, 4, 3, 4, 2` | `4` |
| `standard deviation of column "score" above` | the column's spread |

Standard deviation and variance take the **population** form by default, since a
note over a fixed column of readings is usually the whole set rather than a draw
from a larger one; the sample form is a named variant (`sample standard
deviation of ...`, `sample variance of ...`). `spread` is the largest minus the
smallest, spelled that way because `range` already means a `start:end` interval
elsewhere in the engine. A tie for `mode` is broken by first appearance, so the
same list always gives the same answer.

## Weighted average

`weighted average of` pairs each value with its own weight through `at`, for the
grades, scorecards, portfolio splits and blended rates a plain mean gets wrong.

| expression | result |
| --- | --- |
| `weighted average of 72 at 30%, 88 at 70%` | `83.20` |
| `weighted average of 4.0 at 3 credits, 3.0 at 1 credit` | `3.75` |
| `weighted average of 10 at 2, 20 at 3` | `16` |

The weights are normalised by their own total, so they need not sum to 1 or to
100%: the grade-point case divides by the four credits, and percentages that
already sum to 100 come out unchanged. A trailing label on a weight (`3
credits`) is read for its number and the word ignored.

## The boundaries

- **The missing weight is an error, not a silent 1.** A value written with no
  `at` clause (`weighted average of 72, 88`) is reported rather than filled in
  with a weight of one, because guessing would quietly change the answer of a
  list that was simply mistyped. In a document it surfaces as that line's error
  and leaves the others working.
- **Population is the default, sample is named.** The classic set above gives a
  population standard deviation of exactly `2`; the sample form is asked for by
  name.
- **`spread`, not `range`.** `range` keeps its existing `start:end` meaning.
- **Percentiles and quartiles are a follow-up.** They need a leading ordinal
  (`90th percentile of ...`) and are deliberately out of this slice.

## Verification

`npm run verify` (typecheck, the full test suite, build, the package smoke
script and the bundled-consumer tree-shaking contract) passes, along with
`npm run lint`, the comment-style and doc-coverage checks, and the docs example
suite (the spread/shape and weighted-average examples are proven live on the
statistics and table-columns pages). New tests: `SpreadShapeAggregates.spec.ts`
(the inline forms and the weighted-average boundary) and `ColumnSpreadShape.spec.ts`
(the column forms).
