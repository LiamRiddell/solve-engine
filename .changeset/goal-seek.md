---
"solve-engine": minor
---

Goal seek: invert a line against a target.

The engine computes forwards, so every "what input gives me this answer" meant editing a number and re-reading the result until it looked right. `solve line 4 for rate = 900` now does that search, reading as "find the value of `rate` that makes line four equal 900". The variable named after `for` must be one the target line uses, since changing it is how the target moves.

```
:deposit = 100000
:rate = 4%
monthly repayment on deposit over 25 years at rate
solve line 3 for deposit = 900      the deposit that makes the repayment 900
```

Two mechanisms, chosen automatically. When the target line is closed form in the variable, the answer is inverted exactly, the same algebra the `solve(...)` verb already uses: `solve line 2 for x = 30` against `x*2+10` returns `10`, no search. When it is not (a finance formula, whose builtin has no symbolic reading), a bounded numeric search narrows in on it instead.

The search is fenced in, so an untrusted document can never make it spin. It assumes the relationship rises or falls steadily and crosses the target once, looks for a positive input up to a billion, and stops after `vm.maxGoalSeekIterations` steps (a hundred by default). A target no input in range can reach, a relationship that jumps across the target rather than passing through it, and the step limit are each a structured error, never a guess and never a hang. Re-running the target line binds the variable in a call frame, so it shadows the document's own value for that one probe and leaves it untouched afterward, and a line that defines a variable is refused rather than have its definition overwritten.

Scoped to line references for this first slice, since a line reference gives a well-defined target without inventing syntax for the relationship. The looser natural-language phrasing (`what deposit makes the repayment 900?`), solutions outside the positive search range, and relationships with several crossings are deliberately left for later.
