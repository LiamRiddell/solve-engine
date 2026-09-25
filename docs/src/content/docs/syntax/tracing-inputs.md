---
title: Tracing inputs
description: Ask which lines fed a result, and which lines fed those.
---

> **Package:** `LINES_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

A note that builds on itself hides where a number came from. A payment on line
four might depend on a deposit on line two and a rate on line one, and the only
way to see that is to read the line and chase each name up the page by eye.

`inputs of line N` does that chase for you. It answers with line N's result and
the lines it read, each shown with its own result and line number:

```solve-doc
:rate = 4%
:deposit = 100000

:payment = monthly repayment on deposit over 25 years at rate
inputs of line 4   // payment 527.84 (line 4) <- deposit 100,000 (line 2), rate 4.00% (line 1)
```

Read the arrow, `<-`, as "worked out from". A line that defines a variable is
shown by that name first, so `payment 527.84 (line 4)` is line four, which
defines `payment` and answers `527.84`.

## How a line reads another

A line can take a number from another line in three ways, and the trace follows
all of them:

| Way | Example | Which line it names |
| --- | --- | --- |
| a variable | `deposit` | the nearest line above that defines `deposit` |
| a position | `line 2`, `prev`, `total above`, `sum(line 1 : line 3)` | the lines at those positions |
| a category tag | `total of #food` | every line carrying `#food` |

A variable names the nearest definition above the reader, because that is the
value in force when the reader ran: a variable redefined further down the page
does not reach back up to an earlier line.

## Following it upwards

An input that itself read other lines carries them too, in square brackets
after its own arrow. The trace keeps going until it reaches lines that read
nothing:

```solve-doc
10
20
total above
line 3 * 2
inputs of line 4   // 60 (line 4) <- 30 (line 3) <- [10 (line 1), 20 (line 2)]
```

Line four read line three, and line three read the two lines above it. A
category tag lists every tagged line:

```solve-doc
40 #food
20 #food
total of #food
inputs of line 3   // 60 (line 3) <- 40 (line 1), 20 (line 2)
```

A line that takes nothing from another line says so:

```solve-doc
:rate = 4%
inputs of line 1   // rate 4.00% (line 1) reads no other line
```

## Large values

A trace is for seeing which lines fed an answer, so a large value is shown
short rather than in full. A list of more than ten values shows its first ten
and how many more there are, a matrix (a grid of numbers) of more than a hundred
cells shows its shape, such as `[200x200 matrix]`, and a text longer than eighty
characters shows its first eighty and how many more there are. Only the trace
shortens it: the line's own answer is shown in full as always.

```solve-doc
:scores = map(x * 10, 1:50)
inputs of line 1   // scores [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, and 40 more] (line 1) reads no other line
```

## When there is no order to trace

A trace reads lines whose answers are already worked out, which in a note means
lines further up the page. Two cases have no such order, and each is reported
by name rather than guessed at.

Two lines that read each other form a **cycle**: each answer is waiting on the
other, so neither has one to trace back to.

```solve-doc
line 2 + 5
prev + 5
inputs of line 2   // ERROR: Line 1 reads line 2, which leads back to line 1: lines that read each other have no answer to trace
```

A line that reads a line below it is a **forward reference**, and so is asking
for the inputs of a line further down than the question itself:

```solve-doc
120
inputs of line 3   // ERROR: Line 3 is not above this line, so its answer has not been worked out yet: a trace reads the lines above it
240
```

## What it does not cover

A very long chain is cut short rather than listed in full: the trace goes ten
levels deep and lists at most two hundred lines, and a line whose own inputs
were cut off ends in `<- [...]`. A `global` variable shared from another
document is shown only where this document defines it.

A large value is cut before it is formatted, so a trace of lines that each hold
a 100,000-element list takes a fraction of a second rather than seconds a line.
A host reading a trace from code with
[`engine.traceLine()`](/guide/tracing-lines/) gets the values themselves, not
this text, and formats them as it chooses.

A [section total](/syntax/sections/) lists the lines under its heading, and a
[table column](/syntax/table-columns/) or [table lookup](/syntax/table-lookups/)
lists the rows of the table above it, each named by its first cell. A lookup
reads one row, but the key it looks up can itself come from another line, so
the trace lists the rows it chose among rather than guessing which one it
picked. A total leaves out the check lines and the subtotals it steps over, and
so does its trace.

```solve-doc
# Travel
train = 12
taxi = 7
# Food
t = total of section "Travel"
inputs of line 5   // t 19 (line 5) <- train 12 (line 2), taxi 7 (line 3)
```

A [what-if or a sweep](/syntax/what-if/) lists the line it re-runs, with that
line's answer as the note shows it, not the answer under the what-if's inputs:
the trace describes the note as written, and the inputs a what-if holds fixed
are on its own line to read.

Like [line references](/syntax/line-references/), this form only works inside a
document, since it reads other lines. The single-expression entry point has no
document to trace, and says so. A host that wants the same trace as data, for a
hover highlight or a "how was this worked out" panel, calls
[`traceLine`](/guide/tracing-lines/).
