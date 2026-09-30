---
title: "Screen and image sizes"
description: The shape of a width and a height, the other side of a resize, and how large an image prints.
---

> **Package:** `WEB_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

A screen or an image is a width and a height, written the way they are sold and
saved: `1920x1080`, `4000x3000`. Three questions come up about a pair like that.
What shape is it, what does it become at a different size, and how large does it
print.

## The shape of a pair

The **aspect ratio** is the shape of a rectangle with the size taken out of it: a
1920 by 1080 screen and a 3840 by 2160 screen are both `16:9`, which is why a
film fills either one the same way. `as ratio` reduces a pair to that shape.

```solve
1920x1080 as ratio // 16:9
3840x2160 as ratio // 16:9
1024x768 as ratio // 4:3
```

The spaces are yours to keep or drop, and `in` reads the same as `as`.

```solve
1920 x 1080 as ratio // 16:9
1920x1080 in ratio // 16:9
```

This is the same reduction [`ratio`](/syntax/ratios/) does, in the spelling a
screen is written in. `ratio(1920, 1080)` gives the same answer, and takes more
than two parts.

## The other side of a resize

Scaling a picture down usually means fixing one side and letting the other
follow, so the shape survives. State the side you know and `resize` works out
the other.

```solve
resize 4000x3000 to 1200 wide // 1200 x 900
resize 4000x3000 to 900 tall // 1200 x 900
```

Both lines are the same resize written from either end. `width` and `across`
read as `wide`, and `height` and `high` read as `tall`, so the sentence can sit
whichever way it comes out.

```solve
resize 4000x3000 to 1200 width // 1200 x 900
resize 4000x3000 to 900 high // 1200 x 900
```

The side that follows is rounded to a whole pixel, because that is what an image
file holds. A pair whose shape does not divide evenly lands on the nearest one
rather than a fraction of a pixel that nothing can store.

```solve
resize 1000x333 to 500 wide // 500 x 167
```

## How large it prints

A pixel has no physical size of its own. How large an image comes out on paper
depends on the **density** it is printed at: how many dots the printer packs into
each inch, written `dpi` (dots per inch) or `ppi` (pixels per inch). A
4000-pixel-wide photo at 300 dots per inch is 4000 ÷ 300, or 13.33 inches, across.
`at <n> dpi` states the density and does that division.

```solve
4000px at 300 dpi // 13.33 in
4000px at 300 dpi in mm // 338.67 mm
3000 px at 300 ppi in cm // 25.40 cm
```

It works the other way round too, which answers how many pixels a print of a
given size needs: a length becomes pixels at that density.

```solve
8 in at 300 dpi // 2,400.00 px
210 mm at 300 dpi // 2,480.31 px
```

A density is the only bridge between pixels and physical length, which is why
`96 px in inches` is refused (see [CSS units](/syntax/css-units/)): without a
stated density there is no answer to give. The density binds to the size beside
it, like `at 20px base` does, so a sum is bracketed first:

```solve
(4000px + 200px) at 300 dpi // 14.00 in
```

A density of zero or below is refused by name, and so is a size that is neither
pixels nor a length:

```solve
4000px at 0 dpi // a density is a finite number of dots per inch above zero, and 0 is not
4 kg at 300 dpi // a density relates pixels and a printed length, and "kg" is neither
```

The boundary: only a density written on the line converts. A screen's own
density (a phone's pixels per inch, a device pixel ratio) is not known to the
engine and is not guessed, and the density is a number, not a name: `at d dpi`
asks for a number. `dpi` stays an ordinary name everywhere else, so `dpi = 300`
is a variable, and `at` keeps its other meanings (`30 hours at $30/hour`,
`01:02:03:04 at 30 fps`) because the phrase is read as a density only when a
number and `dpi` or `ppi` follow it.

## When it cannot answer

A resize says which side the size is, and the number alone does not say it. A
half-written `resize 4000x3000 to 1200` is reported as a line that still needs
`"wide" or "tall"` rather than guessed at, and a `resize 4000x3000` with no size
at all says it expects `to` and then a size. Both are reported where the missing
part should be, so a line being typed says what it is still waiting for.

## Why the pair needs the rest of the line

`1920x1080` on its own is still 1920 times a variable called `x1080`, which is
what it has always been, and a note that says `3x4` still means what it did. The
pair is only read as a width and a height when the line goes on to ask something
of it: after `resize`, or before `as ratio`. A rule that claimed every
`<number>x<number>` would quietly change what other people's lines mean, and
this deliberately does not.
