---
title: Colours
description: Hex, rgb, hsl and named colours as values, with functions to build, adjust, read and check them.
---

> **Package:** `COLOUR_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

Colours are values. Write one as a hex literal, an `rgb()`/`hsl()` call, or a CSS
name, then lighten it, rotate its hue, mix two together, read a channel out as a
number, or check a contrast ratio against WCAG. Every colour result carries its
channels and a ready CSS string, so an editor can render an inline swatch beside
the answer, as this page does.

Function names are matched case-insensitively, so `isDark`, `ISDARK` and `isdark`
are the same function; the examples here use camelCase for the multi-word ones.

## Writing a colour

All four CSS hex forms are literals. `#rgb` and `#rgba` expand each nibble the way
a browser does (`#f00` is `#ff0000`), and the four- and eight-digit forms carry an
alpha channel:

```solve
#ff0000 // #ff0000
#f00 // #ff0000
#ff000080 // #ff000080
```

`rgb()` and `hsl()` build a colour from channels; their `rgba()`/`hsla()` forms
add an alpha of 0 to 1. Saturation and lightness may be written with or without a
`%`:

```solve
rgb(255, 128, 0) // rgb(255, 128, 0)
rgba(255, 0, 0, 0.5) // rgba(255, 0, 0, 0.5)
hsl(210, 50, 40) // hsl(210, 50%, 40%)
```

Two more colour wheels are available: `hsv` (also `hsb`, the value/brightness
wheel most colour pickers show) and `hwb` (the CSS Color 4 hue, whiteness and
blackness model). A colour built this way is the same as any other and prints as
hex:

```solve
hsv(120, 100, 100) // #00ff00
hwb(0, 50, 0) // #ff8080
```

Every CSS colour name is available through `color("...")` (also spelled
`colour`), including `transparent` and `rebeccapurple`:

```solve
color("rebeccapurple") // rebeccapurple
color("transparent") // transparent
```

A bare `#ff0000` on its own line is a colour, not a markdown heading: a heading
always has a space after its `#` (`# Total`), and a hex colour never does. A `#`
followed by anything that is not exactly 3, 4, 6 or 8 hex digits (a tag like
`#todo`, a reference like `#42`) is left alone.

## Reading a colour's channels

Pull any channel out as a number. `red`, `green` and `blue` read the 0 to 255
sRGB channels; `hue` (0 to 360), `saturation` and `lightness` (0 to 100) read the
HSL channels; and `alpha`, given a single argument, reads the alpha rather than
setting it:

```solve
red(#3366cc) // 51
green(#3366cc) // 102
blue(#3366cc) // 204
hue(#ff0000) // 0
saturation(#ff0000) // 100
lightness(#3366cc) // 50
alpha(rgba(255, 0, 0, 0.5)) // 0.50
```

## Adjusting a colour

`lighten` and `darken` move a colour along its HSL lightness; `saturate` and
`desaturate` (also `desat`) along its saturation. `rotate` (also `spin`,
`adjustHue`) turns the hue by an angle in degrees, and `complement` turns it a
half-turn to the colour opposite on the wheel:

```solve
lighten(#3366cc, 20%) // #85a3e0
darken(#ff0000, 20%) // #990000
saturate(#8899aa, 30%) // #6999c9
desaturate(#6999c9, 30%) // #8899aa
rotate(#ff0000, 120) // #00ff00
complement(#ff0000) // #00ffff
```

The amount an adjuster takes reads the same whether written as a fraction, a
percent, or a bare number, so `0.2`, `20%` and `20` all mean a fifth.

`invert` (also `negate`) flips every channel, and `grayscale` (also `greyscale`)
drops a colour to grey by its perceived brightness:

```solve
invert(#ff0000) // #00ffff
grayscale(#3366cc) // #626262
```

`mix` blends two colours; a third argument weights the blend toward the second,
defaulting to the midpoint. `tint`, `shade` and `tone` are the common special
cases: mixing toward white, black and mid-grey:

```solve
mix(#ff0000, #0000ff) // #800080
tint(#ff0000, 50%) // #ff8080
shade(#ff0000, 50%) // #800000
tone(#ff0000, 50%) // #c04040
```

`alpha` (also `opacity`, `fade`), given two arguments, sets transparency. A hex
colour keeps hex display and shows the alpha as `#rrggbbaa`:

```solve
alpha(#ff0000, 0.5) // #ff000080
```

## Contrast and accessibility

`contrast` returns the WCAG contrast ratio between two colours (1 to 21), and
`luminance` returns a single colour's relative luminance (0 to 1):

```solve
contrast(#ffffff, #000000) // 21
contrast(#ffffff, #767676) // 4.54
luminance(#ffffff) // 1
```

`isDark` and `isLight` classify a background by which of black or white text
reads better on it, and `readable` (also `contrastColor`) returns that better
text colour directly:

```solve
isDark(#3366cc) // true
isLight(#ffffff) // true
readable(#3366cc) // #ffffff
```

`isContrastCompliant` answers whether two colours meet a WCAG contrast bar. With
no third argument it tests the AA rule for normal text (4.5:1); a level name
(`"AA"`, `"AAA"`, `"AA large"`, `"AAA large"`) or a plain number overrides that:

```solve
isContrastCompliant(#ffffff, #000000) // true
isContrastCompliant(#ffffff, #949494, "AA large") // true
isContrastCompliant(#ffffff, #767676, "AAA") // false
```

`wcagLevel` (also `wcag`) reports the best rating a pair reaches for normal text,
one of `AAA` (7:1 or better), `AA` (4.5), `AA Large` (3, which only meets AA for
large text or UI), or `Fail`:

```solve
wcagLevel(#ffffff, #000000) // AAA
wcagLevel(#ffffff, #767676) // AA
wcagLevel(#ffffff, #949494) // AA Large
wcagLevel(#ffffff, #cccccc) // Fail
```

## Converting between formats

`as rgb`, `as rgba`, `as hsl`, `as hsla` and `as hex` change how a colour prints
without touching its channels:

```solve
#ff0000 as hsl // hsl(0, 100%, 50%)
#ff0000 as rgb // rgb(255, 0, 0)
```

Two colours are equal when their channels match, regardless of how each was
written, so `#ff0000` and `rgb(255, 0, 0)` are the same colour:

```solve
#ff0000 == rgb(255, 0, 0) // true
```
