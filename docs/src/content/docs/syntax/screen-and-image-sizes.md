---
title: "Screen and image sizes"
description: The shape of a width and a height, and the other side of a resize.
---

> **Package:** `WEB_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

A screen or an image is a width and a height, written the way they are sold and
saved: `1920x1080`, `4000x3000`. Two questions come up about a pair like that.
What shape is it, and what does it become at a different size.

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
