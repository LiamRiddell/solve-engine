---
title: Line references
description: Referring to previous lines and aggregating over them.
---

These forms only work inside a document, since they refer to other lines. They
return an error through the single-expression entry point, which has no document
to refer to.

| Expression | Meaning |
| --- | --- |
| `prev` | the result of the previous line |
| `line 3` | the result of line three |
| `sum(line 1 : line 4)` | the total of a span of lines |
| `average(line 1 : line 4)` | the mean of a span |
| `total above` | the total of every line above |
| `average above` | the same, averaged |

A blank line or a heading acts as a boundary, so `total above` sums the current
block rather than the whole document.

## Goal seek

The engine computes forwards, so answering "what input gives me this result"
usually means editing a number and re-reading the answer until it looks right.
Goal seek does that search for you, against a line reference.

`solve line 4 for rate = 900` reads as "find the value of `rate` that makes line
four equal 900". The variable named after `for` must be one the target line
uses, since changing it is how the target moves. The result is that value.

| Expression | Meaning |
| --- | --- |
| `solve line 4 for rate = 900` | the `rate` that makes line four equal 900 |
| `solve line 2 for deposit = 1,200` | the `deposit` that makes line two equal 1,200 |

A worked document. Line three reads `deposit`, and the last line solves for it:

```
:deposit = 100000
:rate = 4%
monthly repayment on deposit over 25 years at rate
solve line 3 for deposit = 900
```

There are two mechanisms, chosen automatically. When the target line is closed
form in the variable, the answer is inverted exactly, the same algebra the
[`solve(...)`](/syntax/algebra/) verb uses. Otherwise (a finance formula, say)
a bounded numeric search narrows in on it, assuming the relationship rises or
falls steadily across the search and crosses the target once.

That search is deliberately fenced in, so a document can never make it spin. It
looks for a positive input up to a billion, and stops after a fixed number of
steps (`vm.maxGoalSeekIterations`, a hundred by default). A target no input in
range can reach, a relationship that jumps across the target rather than passing
through it, or the step limit, each ends in an error rather than a guess or a
hang. Solutions outside that range, or relationships with several crossings, are
out of scope for now.
