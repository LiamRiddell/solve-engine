---
"solve-engine": minor
---

Fractions are exact. A third written with `/` computes like a third.

A quotient of two integers was an IEEE double from the moment it was written, so a chain of fractions drifted the way doubles do. `1/49 * 49` came back `0.9999999999999999`, `5/6 - 1/6 - 1/6 - 1/6 - 1/6 - 1/6` came back `1.6653345369377348e-16` instead of `0`, and `1/1000003 as fraction` answered `0/1`, because the continued-fraction guess ran past its ceiling and collapsed to zero. Those are the drifts a person who wrote a recipe, a split or a share notices.

A fraction now carries an exact rational (a bigint numerator and denominator, always reduced) alongside the double. Integer division seeds it, `+`, `-`, `*`, `/`, unary minus and comparison keep it, and `as fraction` renders it exactly:

```
1/3 + 1/3 + 1/3    exactly 1
2/7 * 14           exactly 4
1/49 * 49          was 0.9999999999999999, now exactly 1
5/6 - 1/6*5        was 1.6e-16, now exactly 0
1/3 as fraction    1/3
10/4 as fraction   5/2
(1/3 + 1/7) as fraction   was approximated, now exactly 10/21
1/1000003 as fraction     was 0/1, now 1/1000003
```

The boundary is deliberate, and chosen so no existing float result flips. A fraction is shown as its decimal by default, so `10/4` is still `2.50` and `1/3` is still `0.33`; ask for `as fraction` to see the fraction and `as decimal` for the decimal. Only a fraction written with `/` is exact: a decimal literal is unchanged, so `0.1 + 0.2` is still `0.30000000000000004`, a plain integer sum keeps its float association, so `1e16 + 1 - 1e16` is still `0`, transcendental work (`sqrt`, `sin`, a non-integer power) stays float, and a bigint quotient (`100n / 3n`) stays exact integer division.

The double is still there and is recomputed from the reduced rational, so reading a fraction as a number through `.value` or `toNumber()` is unchanged, except that a fraction that reduces to a whole number now reads back as that number exactly rather than the double it drifted to.
