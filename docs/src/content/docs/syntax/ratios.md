---
title: Ratios
description: "Reduce a ratio to its lowest whole-number terms, like 1920:1080 to 16:9."
---

> **Package:** `RATIO_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

A **ratio** compares quantities: a `16:9` screen, a `2:1` mix, a `1:2:3` split. The
same ratio can be written many ways (`1920:1080` and `16:9` are the same shape),
and `ratio` reduces one to its simplest whole-number form.

```solve
ratio(1920, 1080) // 16:9
ratio(4, 8) // 1:2
ratio(2, 4, 6) // 1:2:3
```

It takes any number of parts, so it works for a two-part aspect ratio or a
several-part mix, and it divides them all by their largest common factor.

## Why it is a function

`ratio(16, 9)` is written as a function rather than as `16:9`, because a colon
between two numbers already means something else here: a **range**, `1:10`, the
whole run of numbers from 1 to 10 (see [ranges](/syntax/map-reduce-and-aggregates/)).
Keeping ratios as a function leaves that meaning of the colon untouched.

The parts must be whole positive numbers, and there must be at least two; anything
else (a fraction, a negative, a single value) is reported as an error rather than
guessed at.

## A screen or an image

A pair written the way a screen is sold reduces the same way, without the
brackets: `1920x1080 as ratio` is `16:9`. That spelling, and the resize that
goes with it, are on [screen and image sizes](/syntax/screen-and-image-sizes/).
