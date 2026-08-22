---
title: Colours
description: Hex, rgb and hsl colours as values, with functions to adjust them.
---

Colours are values. Write one as a hex literal, an `rgb()`/`hsl()` call, or a CSS
name, then lighten it, rotate its hue, mix two together, or check a contrast
ratio. Every colour result carries its channels and a ready CSS string, so an
editor can render an inline swatch beside the answer (this page does).

## Writing a colour

The four CSS hex forms all work, and `#rgb`/`#rgba` expand each nibble the way a
browser does:

```solve
#ff0000 // #ff0000
#f00 // #ff0000
rgb(255, 128, 0) // rgb(255, 128, 0)
rgba(255, 0, 0, 0.5) // rgba(255, 0, 0, 0.5)
hsl(210, 50, 40) // hsl(210, 50%, 40%)
```

Any CSS colour name is available through `color("...")` (also spelled
`colour`), including `transparent` and `rebeccapurple`:

```solve
color("red") // red
color("rebeccapurple") // rebeccapurple
```

A bare `#ff0000` on its own line is a colour, not a markdown heading. A `#`
followed by anything that is not exactly 3, 4, 6 or 8 hex digits stays a heading
or a tag as before, so `# Heading` and `#todo` are untouched.

## Adjusting a colour

The amount an adjuster takes reads the same whether you write it as a fraction, a
percent, or a bare number: `0.2`, `20%` and `20` all mean the same step.

```solve
lighten(#3366cc, 20%) // #85a3e0
darken(#ff0000, 20%) // #990000
saturate(#8899aa, 30%) // #6999c9
rotate(#ff0000, 120) // #00ff00
complement(#ff0000) // #00ffff
mix(#ff0000, #0000ff) // #800080
grayscale(#3366cc) // #626262
invert(#ff0000) // #00ffff
alpha(#ff0000, 0.5) // #ff000080
```

`rotate` turns the hue by an angle in degrees; `mix` blends two colours (a third
argument weights the blend toward the second, defaulting to the midpoint);
`alpha` (also `opacity`, `fade`) sets transparency; `saturate`/`desaturate`,
`lighten`/`darken` and `grayscale`/`invert`/`complement` (and `negate`) do what
they say. `tint`, `shade` and `tone` mix a colour toward white, black and grey:

```solve
tint(#ff0000, 50%) // #ff8080
shade(#ff0000, 50%) // #800000
tone(#ff0000, 50%) // #c04040
```

## More colour spaces

Besides `rgb`/`hsl`, colours can be built with `hsv` (also `hsb`, the value/
brightness wheel most pickers show) and `hwb` (CSS Color 4 hue/whiteness/
blackness). The result is a colour like any other:

```solve
hsv(120, 100, 100) // #00ff00
hwb(0, 50, 0) // #ff8080
```

## Reading a colour

Pull a channel out as a number with `red`, `green`, `blue`, `hue`, `saturation`,
`lightness` or `alpha` (given one argument, `alpha` reads rather than sets):

```solve
red(#3366cc) // 51
hue(#ff0000) // 0
lightness(#ff0000) // 50
```

`contrast` returns the WCAG contrast ratio between two colours (1 to 21), and
`luminance` returns a single colour's relative luminance (0 to 1). Both are plain
numbers, so they compose with the rest of the engine:

```solve
contrast(#ffffff, #000000) // 21
contrast(#ffffff, #767676) // 4.54
luminance(#ffffff) // 1
```

For accessible text, `isdark`/`islight` classify a background, and `readable`
(also `contrastcolor`) returns black or white, whichever reads better on it:

```solve
isdark(#000000) // true
islight(#ffffff) // true
readable(#3366cc) // #ffffff
```

## Converting between formats

`as rgb`, `as rgba`, `as hsl`, `as hsla` and `as hex` change how a colour prints
without touching its channels:

```solve
#ff0000 as hsl // hsl(0, 100%, 50%)
#ff0000 as rgb // rgb(255, 0, 0)
```

Two colours are equal when their channels match, regardless of how each was
written, so `#ff0000` and `rgb(255, 0, 0)` are the same colour.
