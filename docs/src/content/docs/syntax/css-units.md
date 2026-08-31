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

The 16px root is the CSS default and is treated as fixed here. `em`, which is
relative to an element's own font size rather than the root, is deliberately not
converted: what an `em` is worth depends on where it sits, so a single fixed
value would be misleading.

These are a measure of their own, kept apart from physical length. A CSS pixel is
a reference pixel, not a slice of a centimetre, so a pixel converts to a `rem`
and back but not to a physical length.
