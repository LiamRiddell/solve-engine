---
"solve-engine": minor
---

More colour functions: channel readouts, HSV/HWB, tints, and readable-text helpers.

The colour package gains a wider set of functions:

- **Read a channel** as a number: `red`, `green`, `blue`, `hue`, `saturation`, `lightness`, and `alpha` (with one argument `alpha` reads rather than sets).
- **More colour spaces**: `hsv` (also `hsb`) and `hwb` (CSS Color 4) join `rgb`/`hsl` as ways to build a colour.
- **Tints and shades**: `tint`, `shade` and `tone` mix a colour toward white, black and grey; `negate` is a full invert.
- **Accessible text**: `isdark`/`islight` classify a background, and `readable` (also `contrastcolor`) returns black or white, whichever has the better WCAG contrast on it.

```
red(#3366cc)          51
hue(#ff0000)          0
hsv(120, 100, 100)    #00ff00
tint(#ff0000, 50%)    #ff8080
readable(#3366cc)     #ffffff
```

All of these sit alongside the existing constructors and adjusters and follow the same conventions (an amount reads the same as `0.2`, `20%` or `20`; a non-colour argument gives a clear error).
