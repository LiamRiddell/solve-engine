---
"solve-engine": patch
---

A parenthesised thousands number reads as one number again: `(1,000)` is `1000`, not a vector.

The comma-separator change suppressed the thousands-comma inside every paren, but `(` groups as well as calls. A bare grouping paren was wrongly treated like a function call, so `(1,000)` split into the two-element vector `[1, 0]` and silently corrupted the arithmetic around it:

```
(1,000)          was [1, 0],   now 1000
(1,000 + 500)    was a vector, now 1500
2 * (1,000)      was a vector, now 2000
```

The lexer now tells a call from a grouping by what precedes the `(`: an identifier or a closing bracket makes it a call (`rgb(255,255,255)`, `vec2(1,2)` — commas separate), while an operator or the line start makes it a grouping (`(1,000)`, `2 * (1,000)` — the comma still groups thousands). `[...]` stays a separator context, so `[100,200,300]` is unchanged, and `2(1,000)` reads as implicit multiplication over the grouping rather than a call.
