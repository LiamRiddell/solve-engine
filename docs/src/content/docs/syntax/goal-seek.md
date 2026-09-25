---
title: Goal seek
description: Solve backwards for the input that makes a line reach a target you name.
---

> **Package:** `GOALSEEK_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

The engine computes forwards, so answering "what input gives me this result"
usually means editing a number and re-reading the answer until it looks right.
Goal seek does that search for you, against a line reference.

`solve line 4 for rate = 900` reads as "find the value of `rate` that makes line
four equal 900". The variable named after `for` must be one the target line
uses, since changing it is how the target moves. The result is that value. The
forward question, what a line would say if an input were different, is a
[what-if](/syntax/what-if/), and that one follows an input through the lines
between as well.

| Expression | Meaning |
| --- | --- |
| `solve line 4 for rate = 900` | the `rate` that makes line four equal 900 |
| `solve line 2 for deposit = 1,200` | the `deposit` that makes line two equal 1,200 |

A worked document. Line three works the repayment forward at the starting
deposit; the last line solves backward for the deposit that makes it 900:

```solve-doc
:deposit = 100000
:rate = 4%
monthly repayment on deposit over 25 years at rate   // 527.84
solve line 3 for deposit = 900                        // 170,507.23
```

There are two mechanisms, chosen automatically. When the target line is closed
form in the variable, the answer is inverted exactly, the same algebra the
[`solve(...)`](/syntax/solving-equations/) verb uses. Otherwise (a finance formula, say)
a bounded numeric search narrows in on it, assuming the relationship rises or
falls steadily across the search and crosses the target once.

That search is deliberately fenced in, so a document can never make it spin. It
looks for a positive input up to a billion, and stops after a fixed number of
steps (`vm.maxGoalSeekIterations`, a hundred by default). A target no input in
range can reach, a relationship that jumps across the target rather than passing
through it, or the step limit, each ends in an error rather than a guess or a
hang. Solutions outside that range, or relationships with several crossings, are
out of scope for now.

For the same reason, goal seek will not target a line that holds a
[what-if or a sweep](/syntax/what-if/). Each of those works through the note
again, and goal seek re-runs its target up to a hundred times, so one goal-seek
line over a 1,000-step sweep would work through the note a hundred thousand
times. It answers with a refusal instead, whether or not the algebra could have
inverted the line, so the answer never depends on the line's shape. A target
that only reads a what-if line's answer, rather than holding the what-if
itself, is not affected.

```solve-doc
:k = 1                    // 1
:x = 1                    // 1
x * 2                     // 2
(line 3 with x = 5) * k   // 10
solve line 4 for k = 30   // ERROR: Goal seek cannot target a line that holds a what-if or a sweep, since every one of its probes would re-run the document again. Target a line without one.
```

Like [line references](/syntax/line-references/), goal seek only works inside a
document, since it re-runs another line. It also needs a way of evaluating the
document that can re-run a line: `evaluateDocument` and a live editor built on
the engine's incremental evaluator can, and they solve it. `parseDocument`, the
batch pass, evaluates each line once and cannot, and the single-expression
entry point has no document at all; each answers with a refusal that says which
of the two it is.
