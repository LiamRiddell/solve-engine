---
title: Introduction
description: What Solve is, what it is not, and when you would reach for it.
---

Solve is an expression evaluation engine. You give it a line of text, it works
out what the line means, and it gives you a value back.

The distinguishing idea is that the input is meant to look like something a
person would write anyway. Not a formula in a spreadsheet dialect, and not a
call into a maths library, but the kind of line that already appears in
someone's notes.

```solve
10 + 20 / 200 * 4 // 10.40
50% of 200 // 100
100cm + 2m // 300.00 cm
5 km to miles // 3.11 miles
```

## What you get

The engine handles arithmetic, percentages, units of measurement, currencies,
dates and durations, times and timezones, matrices and vectors, statistics,
finance, symbolic algebra, and a set of natural-language phrasings for each.
The full list is in the [syntax reference](/syntax/cheatsheet/).

Beyond evaluating single expressions it also understands a document, a note
of many lines read together. A value named on one line is read by the lines
below it, so an edit near the top flows down to every answer that depends on it:

```solve-doc
:subtotal = 240
:tax = :subtotal * 20%
:subtotal + :tax // 288
```

A document can also describe itself. A `#tag` marks the lines that belong
together so they can be totalled ([category tags](/syntax/category-tags/)); a
`check` line states something that must stay true and turns into an error when
it stops holding ([checks](/syntax/checks/)); `with` asks what a line would say
if one of its inputs were different, without changing the note
([what-if](/syntax/what-if/)); and `inputs of` lists the lines that fed an
answer, and the lines that fed those ([tracing inputs](/syntax/tracing-inputs/)).
Headings split the note into [sections](/syntax/sections/).

```solve-doc
# Trip
nights = 3
rate = £95
flights: £420 #travel
hotel: nights * rate #travel
total of #travel // £705.00
check total of #travel <= £800 // ✓

# Questions
line 5 with nights = 4 // £380.00
inputs of line 6 // £705.00 (line 6) <- £420.00 (line 4), £285.00 (line 5) <- [nights 3 (line 2), rate £95.00 (line 3)]
```

Line 5 is the hotel, so `line 5 with nights = 4` answers what the hotel would
cost for four nights while the note keeps its three. References to earlier lines
by number, and totals over a run of lines, are covered in
[line references](/syntax/line-references/).

## What it is not

It is not a general computer algebra system, though it has one inside it. An
unknown stays an unknown, and over exact rational arithmetic the engine will
`expand`, `factor`, `solve`, `cancel` and `apart`, take derivatives and
integrals, build a Taylor series and a Jacobian; the [algebra
pages](/syntax/expanding/) cover each. The boundary is stated where it applies:
polynomial degree and expression size are capped, an integral with no
elementary antiderivative is reported rather than approximated, and a system
outside what the solver attempts says so instead of guessing. What it does not
attempt is the open-ended symbolic manipulation a dedicated CAS is built for.

It is not a spreadsheet, and it has no notion of cells, grids, or layout.

It is not an interpreter for a general purpose language. There are no loops, no
user-defined control flow beyond a conditional expression, and no side effects
other than assigning a variable.

## When you would use it

Reach for it when you want calculations embedded in prose, evaluated as the
person types, without them having to switch into a calculator.

That constraint shaped the design more than anything else. Running on every
keystroke means the pipeline has to be fast enough to feel instantaneous, and
incremental enough that an edit in a long note does not re-run the lines off
screen that it cannot affect. Both of those show up throughout the
[architecture](/architecture/overview/), and
[core concepts](/getting-started/concepts/#incremental-evaluation) says which
entry point is incremental.

## How it fits together

An expression goes through five stages. It is broken into tokens, the tokens are
normalised so that multi-word phrases become single units, the result is parsed,
the parse output is compiled to bytecode, and the bytecode runs on a small
virtual machine.

Every feature, including basic arithmetic, is supplied by a package that plugs
into those stages. Nothing in the pipeline is hardcoded to know about
percentages or currencies. That is what makes it extensible, and it is covered
in [writing packages](/packages/authoring-a-package/).

## Where to go next

If you want to run something immediately, the [playground](/playground/)
evaluates expressions in the browser and shows you every stage of the pipeline
while it does.

If you want to embed the engine, start with
[installation](/getting-started/installation/) and then
[quick start](/getting-started/quick-start/).

If you want to know what it can parse, go straight to the
[syntax reference](/syntax/cheatsheet/).

If a coding assistant or a language model is reading these pages for you, point
it at [`llms.txt`](/llms.txt), a plain-text map of the syntax reference with a
line per area, or [`llms-full.txt`](/llms-full.txt), which adds every proven
example with its answer. Both are generated from the pages when the
documentation is built, so they show only forms the engine is checked to read.
