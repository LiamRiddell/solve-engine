---
"solve-engine": minor
---

More colour functions: channel readouts, HSV/HWB, tints, and readable-text helpers.

The colour package gains a wider set of functions:

- **Read a channel** as a number: `red`, `green`, `blue`, `hue`, `saturation`, `lightness`, and `alpha` (with one argument `alpha` reads rather than sets).
- **More colour spaces**: `hsv` (also `hsb`) and `hwb` (CSS Color 4) join `rgb`/`hsl` as ways to build a colour.
- **Tints and shades**: `tint`, `shade` and `tone` mix a colour toward white, black and grey; `negate` is a full invert.
- **Accessible text**: `isDark`/`isLight` classify a background, and `readable` (also `contrastColor`) returns black or white, whichever has the better WCAG contrast on it.
- **WCAG compliance**: `isContrastCompliant(a, b)` tests whether two colours meet a contrast bar (AA normal text by default; a level name like `"AAA"` or `"AA large"`, or a plain ratio, overrides it), and `wcagLevel(a, b)` (also `wcag`) reports the best rating a pair reaches (`AAA`, `AA`, `AA Large` or `Fail`).

```
red(#3366cc)                             51
hue(#ff0000)                             0
hsv(120, 100, 100)                       #00ff00
tint(#ff0000, 50%)                       #ff8080
readable(#3366cc)                        #ffffff
wcagLevel(#ffffff, #767676)              AA
isContrastCompliant(#fff, #000, "AAA")   true
```

Function names are matched case-insensitively, so the multi-word ones can be written in camelCase (`isDark`, `isContrastCompliant`, `wcagLevel`).

All of these sit alongside the existing constructors and adjusters and follow the same conventions (an amount reads the same as `0.2`, `20%` or `20`; a non-colour argument gives a clear error).
