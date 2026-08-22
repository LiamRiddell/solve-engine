---
"solve-engine": minor
---

Colours are values now, the way numbers and dates already are.

Write a colour and the engine treats it as a value you can compute with, not as text. All four CSS hex forms are literals (`#f00` expands to `#ff0000`, `#ff0000ff` carries alpha), alongside `rgb()`/`rgba()`/`hsl()`/`hsla()` and every CSS colour name through `color("...")` (including `transparent` and `rebeccapurple`):

```
#ff0000                     #ff0000
rgb(255, 128, 0)            rgb(255, 128, 0)
color("rebeccapurple")      rebeccapurple
```

A DevTools-style function set adjusts them: `lighten`/`darken`, `saturate`/`desaturate`, `rotate` (hue), `complement`, `mix`, `grayscale`, `invert`, and `alpha`. The amount reads the same whether written `0.2`, `20%` or `20`. `contrast` and `luminance` return the WCAG contrast ratio and relative luminance as plain numbers, so they compose with the rest of the engine. `as rgb`/`as hsl`/`as hex` re-print a colour without changing it, and two colours are equal when their channels match however each was written.

```
lighten(#3366cc, 20%)              #85a3e0
mix(#ff0000, #0000ff)              #800080
contrast(#ffffff, #767676)         4.54
#ff0000 == rgb(255, 0, 0)          true
```

Every colour result carries its channels, a hex string and a ready CSS string across the worker boundary, so a frontend can render an inline swatch beside the answer without recomputing anything.

One behaviour to note: a bare `#` sequence that is exactly 3, 4, 6 or 8 hex digits now reads as a colour rather than as a markdown heading or tag, so `#face`, `#c0ffee` and `#deadbeef` evaluate to colours. A `#` followed by anything that is not one of those lengths, or by a non-hex character, is unchanged, so `# Heading` and `#todo` still behave as before. Colour arithmetic operators are deliberately out of scope; manipulate colours through the named functions.
