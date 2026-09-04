---
title: "CSS units"
description: Convert between px and rem for front-end work.
---

> **Package:** `UOM_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

Front-end work keeps switching between pixels and `rem`, the unit that scales
with the page's root font size. These convert both ways, treating one `rem` as
16px, the CSS default root size.

```solve
16px in rem // 1.00 rem
24px in rem // 1.50 rem
1.5rem in px // 24.00 px
```

They add and subtract like any other unit, the result taking the first value's
unit:

```solve
2rem + 8px // 2.50 rem
```

## A root that is not 16px

One `rem` is whatever the page's root font size is, and 16px is only the default
a browser starts at. A page that sets its own root needs the same sum against a
different number, and `at <n>px base` states it.

```solve
1.5rem at 16px base // 24.00 px
1.5rem at 20px base // 30.00 px
24px at 20px base // 1.20 rem
```

It converts to the other unit, so it reads both ways round: a `rem` comes back
as pixels, and pixels come back as `rem`.

> **Package:** the `at <n>px base` form comes from `WEB_PACKAGE`, alongside
> [screen and image sizes](/syntax/screen-and-image-sizes/). The plain
> conversions above are `UOM_PACKAGE`.

The whole phrase is needed, down to the word `base`. `at` is the rate operator
everywhere else in the engine (`30 hours at $30/hour`), so it is only read as a
root font size when `20px base` follows it.

## What is left out

`em`, which is relative to an element's own font size rather than the root, is
deliberately not converted: what an `em` is worth depends on where it sits, so a
single fixed value would be misleading.

These are a measure of their own, kept apart from physical length. A CSS pixel is
a reference pixel, not a slice of a centimetre, so a pixel converts to a `rem`
and back but not to a physical length.
