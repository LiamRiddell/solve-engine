---
"solve-engine": minor
---

Compare two prices with `vs`.

```
£3 / 500g vs £4 / 750g    the second is cheaper, 11% less
£3 vs £4                  the first is cheaper, 25% less
```

The discount and unit-price maths a shopper wants is already ordinary arithmetic
(`£80 - 20% - 10%` stacks discounts, `£3 / 500g` is a per-gram price); this adds
the one piece that was missing, putting two of them side by side. Lower is
cheaper, and the two sides have to be the same kind of thing, so a price against
a weight is an error rather than a meaningless answer. `versus` is an alias, and
two equal amounts read as `the same`.
