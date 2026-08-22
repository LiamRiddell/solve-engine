---
"solve-engine": minor
---

Set the decimal places on a number, and it shows exactly that many.

A number shows to two places by default. Rounding it to a different precision, with `<x> to N dp` or the two-argument `round(x, N)`, used to round the value but still display at the default, so `3.14159 to 4 dp` read `3.14` and `100 to 2 dp` read `100` — the precision you asked for was invisible.

```
3.14159 to 4 dp     was 3.14,  now 3.1416
100 to 2 dp         was 100,   now 100.00
round(1.5, 2)       new,       1.50
```

The place count is now a precision carried on the value, so it shows exactly that many places with trailing zeros kept, reads the way you asked, and travels into the next line rather than being a global display setting. The rounding is exact where the number has an exact decimal, so a half at the last place rounds away from zero the way money already does:

```
1.005 to 2 dp       was 1,     now 1.01
round(2.675, 2)     2.68
```

`round(x)` on its own is still the nearest whole number, and a number you did not ask to round is unchanged.
