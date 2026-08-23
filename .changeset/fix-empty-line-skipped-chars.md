---
"solve-engine": patch
---

A line of only backslashes, or any run of characters the lexer discards, no longer evaluates to 0.

`\`, `\\` and `\\\\` showed a result of **0** in the notepad and the playground, a number on screen for a line that holds no expression, while a blank line, a heading and a prose line all correctly showed nothing.

```
\           was 0, now no result
\\          was 0, now no result
\\\\        was 0, now no result
```

The lexer discards an unknown ASCII character, a backslash falls through to the same skip path as whitespace, so a line built only from them tokenises to an empty token stream. The line was still classified as an expression and evaluated, and the engine reports an empty token stream as the number 0. Such a line is now classified as empty, the same as a blank line, so every surface (the batch parse, the incremental evaluator, and the playground's prose gate) skips it rather than answering 0.

A backslash next to real content is unchanged: `\1` is still 1 (the backslash is skipped), and `1 \ 2` still errors on the trailing 2.
