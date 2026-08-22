---
"solve-engine": patch
---

A thousands number in a grouping paren survives a keyword operator too: `100 mod (1,000)` is `100`, not a vector.

The grouping-vs-call rule told a function call from a grouping by the symbol before the paren, but a **keyword** operator (`mod`, `xor`, `and`, `or`, `to`) is a word, so it was mistaken for a function name and the thousands number inside the following paren was split on its comma:

```
100 mod (1,000)    was [0, NaN],  now 100
255 xor (1,000)    was 255,       now 791
1 and (1,000)      was [2, 1],    now 1001
```

The lexer now checks the word against its keyword table: a keyword that is not a function (an operator, connective, or constant like `mod`, `to`, `pi`) is not a call, so the `(...)` after it is a grouping and its comma stays a thousands separator, while a real function name (`rgb`, `sqrt`) or a variable still opens a call where the comma separates.
