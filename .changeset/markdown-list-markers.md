---
"solve-engine": patch
---

Markdown list markers are no longer evaluated as arithmetic.

`- 100 + 20` in a document answered **-80**. The `-` is a bullet, but it is also a prefix operator, and nothing stripped the marker before evaluating, so the line was read as negative one hundred plus twenty. This is the worst shape a bug can take: a plausible number where a correct one was expected, with nothing on screen to say it went wrong.

The three unordered markers disagreed with each other about the same document, which is what made it a defect rather than a design choice:

```
- 100 + 20     was -80,   now 120
* 100 + 20     was an error, now 120
+ 100 + 20     was 120, but by luck rather than by rule
1. 100 + 20    was an error, now 120
- [ ] 100 + 20 was "a matrix literal cannot be empty", now 120
```

The lexer already classified these lines as `list` and had done all along; nothing consumed that classification to trim the marker before evaluating. The classification now carries a `contentOffset`, and both the token stream and the expression text are taken from it, so they cannot describe different lines. Task-item checkboxes are skipped too, since `[ ]` otherwise lexed as an empty matrix literal and reported a shape error to someone writing a to-do list.

The discriminator is the space, which CommonMark requires after a list marker for exactly this reason. **`-100 + 20` has no space and is still -80.** Ordinary arithmetic is untouched, and `[1,2] + [3,4]` is still a matrix.

This affects documents: a bulleted line that previously showed a negative number, or an error, now shows the result of the expression after the marker. That is the intended reading of a bulleted calculation, and it is the reason the bug was reported.
