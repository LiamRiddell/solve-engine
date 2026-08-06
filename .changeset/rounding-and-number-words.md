---
"solve-engine": minor
---

Rounding, and magnitudes written as words.

**Rounding is now something you can write in an expression.** The engine could already round, but only by configuring the formatter, which changes how every answer is displayed rather than rounding one value inside a calculation. The two are not the same: the formatter cannot express `21 rounded up to nearest 5`, and it cannot feed a rounded number into the next line.

```
5.5 rounded                       6
5.5 rounded down                  5
37 to nearest 10                  40
$490 rounded to nearest hundred   $500
21 rounded up to nearest 5        25
1/3 to 2 dp                       0.33
pi to 5 digits                    3.14159
```

`to the nearest` and `to 2 decimal places` read the same as their shorter forms. Rounding binds below arithmetic, so `1/3 to 2 dp` rounds a third rather than rounding the 3 and then dividing.

`round(x)` is untouched: only the word `rounded` became a keyword, because claiming `round` would have broken every existing call. The cost is that `:rounded` is no longer usable as a variable name, the same accepted trade as `between` and `from`.

**`3 million` works, not just `3M`.** The single-letter magnitudes only ever matched when written touching the number, which is right for letters and wrong for words, so the ordinary spelling failed with "Undefined variable: million". `thousand`, `million`, `billion`, `trillion`, their plurals, and `mn`/`bn`/`tn` are all accepted, with or without the space.

`5 m` is still five metres, and `million` is still usable as a variable name.
