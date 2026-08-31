---
"solve-engine": minor
---

Convert between CSS pixels and rem.

`px` and `rem` are now units, for the front-end habit of switching between them:

```
16px in rem     1.00 rem
1.5rem in px    24.00 px
```

One rem is 16px, the CSS default root font size. They add and subtract like any
other unit, and are a measure of their own, kept apart from physical length: a
CSS pixel is a reference pixel, not a slice of a centimetre. `em` is left out on
purpose, since it is relative to an element's own font size rather than the root,
so a single fixed value would be misleading.
