---
"solve-engine": minor
---

Solving for the missing part of a percentage, base conversions in words, and a multiplier fix.

**`20/5 as multiplier` returned 5x. It returns 4x.** The converter added 1 unconditionally, which is right for a percentage (50% more is 1.5x) and wrong for a plain ratio. Telling those apart only became possible once `%` started producing a percentage-typed value.

**The `is ... what` family.** `5% of what is 6` already worked; this is the order the documentation uses, where you state what you know first:

```
20 is 10% of what        200
180 is 10% off what      200
220 is 10% on what       200
20 is what % of 200      10%
180 is what % off 200    10%
180 is what % on 150     20%
50 to 75 is what %       50%
50 is 1/5 of what        250
81 is 9 to what power    2
```

**Base conversion in the other prepositions.** `256 as hex` always worked; `99 in binary`, `0x9F31 to decimal` and `0b1000101 to octal` did not, because `in` belongs to unit conversion and `to` to percentage change. They are rewritten to `as` before parsing, so each of those parselets keeps one job. `as base 2`, `as base 8` and `as base 16` also work, and an unsupported radix says which ones do.
