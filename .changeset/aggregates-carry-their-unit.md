---
"solve-engine": patch
---

One rule for aggregating quantities: the first unit written, or a refusal

`total of` over a comma list threw the unit away and added values of different
measures as though they were the same number. The document forms carried the
unit but refused a column that spelled one measure two ways, so the four ways of
naming a set disagreed with each other.

| expression | before | now |
| --- | --- | --- |
| `total of $4.99, $12.50, $3.20` | `20.69` | `$20.69` |
| `total of 1.2 km, 3 km, 800 m` | `804.20` | `5.00 km` |
| `average of 5 kg, 3 m` | `4` | `mass and length cannot be averaged` |
| `1.2 km` / `800 m` / `total above` | a refusal | `2.00 km` |

The second row is the worse one: kilometres and metres were added as equals, so
the answer was wrong by three orders of magnitude on the last term.

The rule now, everywhere: read the whole set in the first unit written, and
refuse a set that mixes measures by naming the two dimensions. It is the rule
`min` and `max` have always followed, applied to the aggregates. The unit is the
first one written rather than the smallest, so the same three distances answer
`5.00 km` written one way round and `5,000.00 m` the other, which is the unit the
reader started in.

All four ways of naming a set follow it, and a test pins them to the same answers:
the inline `total of X, Y, Z` list, `total above`, `total of #tag`, and
`total(line1 : line3)`. `average`, `median` and `spread` carry the unit too.

The boundary is a bare number sitting in a list of quantities. It contributes its
magnitude, which is what a count written beside a column of measurements has
always done, so `total of 1 km, 500` is `501.00 km`. `count of` counts, so it
carries no unit. Standard deviation and variance are unchanged, because a
variance carries the square of its data's unit and that is its own decision.

[Statistics](https://liamriddell.github.io/solve-engine/syntax/statistics/) gains
a proven section for a list with units and states the refusal.
