---
"solve-engine": patch
---

A comma inside a call or bracket is read as a separator, so `rgb(255,255,255)` and `[100,200,300]` work without spaces.

A comma followed by exactly three digits was always coalesced into the number as a thousands group, whatever surrounded it, so a comma-separated list written without a space after each comma fused into one number:

```
rgb(255,255,255)     was an arity error,       now white
hsl(0,100,50)        was an arity error,       now the colour
[100,200,300]        was [100200300] (1x1),    now a 1x3 vector
```

`255,255,255` reads identically to the thousands-grouped `255255255`, so nothing local to the number could tell them apart — only the surrounding `(` or `[` can. The lexer now tracks that nesting: a comma inside a call or a bracket is an argument or element separator and is not coalesced, while a top-level comma still groups thousands (`1,000,000` is unchanged). The space form (`rgb(255, 255, 255)`) already worked and still does, and `.`-grouping is untouched.
