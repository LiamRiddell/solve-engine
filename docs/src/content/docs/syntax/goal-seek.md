---
title: Goal seek
description: Solve backwards for the input that makes a line reach a target you name.
---

> **Package:** `GOALSEEK_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

The engine computes forwards, so answering "what input gives me this result"
usually means editing a number and re-reading the answer until it looks right.
Goal seek does that search for you, against a line reference: you name a line,
the input to vary and the result you want, and it finds the input.

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
| `solve line 2 for x = 4 between 0 and 10` | the `x` between 0 and 10 that makes line two equal 4 |

A worked document. Line three works the repayment forward at the starting
deposit; the last line solves backward for the deposit that makes it 900:

```solve-doc
:deposit = 100000
:rate = 4%
monthly repayment on deposit over 25 years at rate   // 527.84
solve line 3 for deposit = 900                        // 170,507.23
```

The answer is in the unit the variable has in the note. A price in pounds is
solved as an amount of pounds, and a distance in kilometres as a distance. A
target written in another unit of the same measure is read in the target line's
unit first, so 3,000 m against a line in kilometres is 3 km:

```solve-doc
:price = £200            // £200.00
:qty = 3                 // 3
price * qty              // £600.00
solve line 3 for price = £1,500   // £500.00
solve line 3 for qty = £1,500     // 7.50
```

```solve-doc
:d = 5 km                          // 5.00 km
d * 2                              // 10.00 km
solve line 2 for d = 3000 m        // 1.50 km
solve line 2 for d = 3 kg          // ERROR: Line 2 answers in km and the target is in kg, so the two cannot be compared. Write the target in km.
```

A rate written as a percentage is solved as a percentage, and a range for it can
be written in percentages too:

```solve-doc
:deposit = 100000
:rate = 4%
monthly repayment on deposit over 25 years at rate    // 527.84
solve line 3 for rate = 600                            // 5.26%
solve line 3 for rate = 600 between 0% and 10%         // 5.26%
```

The boundary: a variable that is a plain number stays one, whatever the
target's unit, since a count of items that makes a total in pounds is still a
count (`qty` above is 7.50, not £7.50). A target in another currency is refused
rather than converted at a rate, as a target in another measure is.

## How it searches

There are three mechanisms, tried in order. When the target line is closed
form in the variable (a sum, a product, a polynomial), the answer is inverted
exactly, the same algebra the [`solve(...)`](/syntax/solving-equations/) verb
uses. When the line has a formula the algebra cannot invert, such as `x + sin(x)`
or `2^x`, the formula is searched for the places it crosses the target, again as
`solve(...)` searches. Otherwise (a finance formula, say, which has no formula
the algebra can read) the line itself is re-run at a spread of inputs and
narrowed in on wherever its result passes the target.

Each search looks at negative inputs as well as positive ones, so a target that
only a negative input reaches is found. A line that fails or is not finite for
some inputs, such as a repayment on a negative deposit or `2^x` far out, is
passed over there rather than taken as the answer:

```solve-doc
x = 1                       // 1
x + sin(x)                  // 1.84
solve line 2 for x = -2     // -1.11
solve line 2 for x = 3      // 2.18
```

```solve-doc
x = 1                       // 1
2^x                         // 2
solve line 2 for x = 4      // 2
solve line 2 for x = 0.25   // -2
```

## Several answers, and a range

A line can reach the same target at more than one input: `x^2` is 4 at both -2
and 2. Goal seek reports every one it finds, as a list, the way `solve(...)`
does, rather than picking one for you. To choose, name the range to look in
after the target, `between <low> and <high>`; the ends may come in either order:

```solve-doc
x = 1                                    // 1
x^2                                      // 1
solve line 2 for x = 4                   // [-2, 2]
solve line 2 for x = 4 between 0 and 10  // 2
solve line 2 for x = 4 between 5 and 10  // ERROR: No value of x between 5 and 10 was found that makes line 2 equal 4: none of the values that make it so lies in that range.
```

A range is also how to search further out than the default, which runs from
minus a billion to a billion. Its ends are plain numbers, or in the unknown's own
unit or another unit of the same measure. When an unknown in a unit has several
answers, each is named in the refusal, and a range picks one:

```solve-doc
:p = 5 km                                        // 5.00 km
p * p / 1 km                                     // 25.00 km
solve line 2 for p = 4 km                        // ERROR: 2 values of p make line 2 equal 4: -2.00 km, 2.00 km. Name a range after the target to choose one, as in "solve line 2 for p = 4 between 0 and 4".
solve line 2 for p = 4 km between 0 and 4        // 2.00 km
```

A line that repeats, as one built on `sin` or `cos` does, meets its target
without end, so more than ten answers are declined and a narrower range asked
for.

## Where it stops

The search is fenced in, so a document can never make it spin. The line is
re-run at most a fixed number of times (`vm.maxGoalSeekIterations`, a hundred by
default), and each re-run also counts against the work one pass over the note
may do. A target no input in range reaches, a line that jumps across the target
rather than passing through it (`floor(x)` never equals 2.5), a line that is not
finite anywhere it was tried, and running out of steps each end in an error
rather than a guess or a hang:

```solve-doc
:x = 0                      // 0
floor(x)                    // 0
solve line 2 for x = 2.5    // ERROR: Goal seek narrowed x to a single point near 3 without line 2 reaching 2.5: the relationship jumps across the target rather than passing through it.
```

The boundary: a search finds the places a line crosses its target. A target the
line only touches without crossing, or two crossings closer together than the
inputs the search tries, can be missed, so finding nothing is reported as
nothing found in that range, never as proof there is no answer. The refusal
names the range it searched and how to name another.

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
of the two it is. [Which entry point](/guide/entry-points/) sets the four side
by side. A goal seek on a line that a [what-if](/syntax/what-if/)
re-runs says the what-if is why, since the what-if works each line out once.

```solve-doc
:x = 5                                 // 5
x * 2                                  // 10
y = solve line 2 for x = 3             // 1.50
line 3 with x = 4                      // ERROR: Goal seek cannot run inside a what-if: the what-if works each line of its scenario out once, and a goal seek re-runs another line many times. Solve the line outside the what-if.
```
