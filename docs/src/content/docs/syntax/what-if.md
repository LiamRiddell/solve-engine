---
title: What-if and sweeps
description: Ask what a line would say if an input were different, or list its answers across a range of inputs, without editing the note.
---

> **Package:** `WHATIF_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

A note that works something out, a mortgage repayment from a deposit and a rate,
say, answers for the inputs it holds. To see what a different deposit would do,
you would normally edit the deposit, read the new answer, and then put the
deposit back. A **what-if** asks that question directly: what a line would say
if one of its inputs were different. A **sweep** asks it for a whole range of
values at once and lists the answers side by side, the way a spreadsheet's data
table does. Neither one edits the note.

An *input* here is any variable the note defines, such as `deposit` or `rate`.
The line you ask about does not have to use it directly: the question follows the
input through every line in between.

## What-if

`line 4 with deposit = 150000` reads as "what line four would say if `deposit`
were 150,000". The engine works through the note again from the top down to line
four, with `deposit` held at 150,000 the whole way, and answers with what line
four comes to.

```solve-doc
deposit = 100000                                              // 100,000
rate = 4%                                                     // 4.00%
payment = monthly repayment on deposit over 25 years at rate  // 527.84
payment * 12                                                  // 6,334.04
line 4 with deposit = 150000                                  // 9,501.06
```

Line four never mentions `deposit`. It reads `payment`, and it is line three that
reads `deposit`, so the new deposit reaches line four through line three. That is
the answer you would get by editing line one and reading line four, without the
edit.

| Expression | Meaning |
| --- | --- |
| `line 4 with deposit = 150000` | line four, with `deposit` at 150,000 |
| `line 4 with deposit = 150000 and rate = 5%` | line four, with both inputs changed |
| `line 4 with deposit = 150000, rate = 5%` | the same, joined by a comma |

Several inputs change together when they are joined by `and` or a comma. A
what-if is an ordinary value, so it can sit inside a larger calculation: the last
line below is how much more a year the larger deposit costs.

```solve-doc
deposit = 100000                                              // 100,000
rate = 4%                                                     // 4.00%
payment = monthly repayment on deposit over 25 years at rate  // 527.84
payment * 12                                                  // 6,334.04
line 4 with deposit = 150000 and rate = 5%                    // 10,522.62
(line 4 with deposit = 150000) - line 4                       // 3,167.02
```

The new value is an ordinary expression too, and it keeps its unit, so money
stays money and a percentage stays a percentage:

```solve-doc
price = $100                  // $100.00
discount = 10%                // 10.00%
sale = price - discount       // $90.00
sale * 3                      // $270.00
line 4 with discount = 25%    // $225.00
line 4 with price = $120      // $324.00
```

A variable defined with its colon, `:price = 100`, can be named either way in a
what-if, a sweep or a goal seek: `:price` and `price` are the same input, and the
note's own `:price` is left as it was.

```solve-doc
:price = 100                 // 100
:total = :price * 1.2        // 120
line 2 with :price = 300     // 360
:price                       // 100
```

An input is held at its new value on every line of the re-run. The line that
sets it is set aside for the question, so asking about that line itself answers
with the new value, while the note's own `deposit` is untouched, as the last line
shows:

```solve-doc
deposit = 100000              // 100,000
deposit * 2                   // 200,000
line 1 with deposit = 150000  // 150,000
deposit                       // 100,000
```

## Sweeps

A sweep asks the same question for a run of values. `line 4 for rate from 3% to
6% step 1%` reads as "line four's answer for each rate from 3% to 6%, one
percentage point apart", and answers with a list of them in order. It is a quick
way to see how sensitive an answer is to one input.

```solve-doc
deposit = 100000                                              // 100,000
rate = 4%                                                     // 4.00%
payment = monthly repayment on deposit over 25 years at rate  // 527.84
payment * 12                                                  // 6,334.04
line 4 for rate from 3% to 6% step 1%                         // [5,690.54, 6,334.04, 7,015.08, 7,731.62]
line 4 for deposit from 100000 to 200000 step 50000           // [6,334.04, 9,501.06, 12,668.08]
line 4 for rate from 6% to 3% step -1%                        // [7,731.62, 7,015.08, 6,334.04, 5,690.54]
```

The range is written `from <start> to <end> step <step>`, and each part has a
rule that keeps its reading single:

- The start, end and step are the same kind of value: all plain numbers, all
  percentages, or all quantities of one kind. `from 3% to 6% step 1` is refused,
  since the `1` could mean one percentage point or a hundred.
- A quantity range can mix units of one kind. They are read in the start's unit,
  so `from 1 m to 3 m step 50 cm` steps half a metre at a time.
- The step is negative for a range that runs down.
- The end is included when a step lands on it. Otherwise the sweep stops at the
  last value before it, so `from 1 m to 2 m step 30 cm` tries four lengths.

The list holds the answers' amounts. Every list in the engine is a row of plain
numbers (the same is true of `[$5, $6]`), so a sweep of a money line lists the
amounts, a quantity lists its amounts in the first answer's unit, and a
percentage lists as its fraction. The unit belongs to the line you asked about,
which says what the amounts are.

```solve-doc
price = $100                                   // $100.00
qty = 3                                        // 3
price * qty                                    // $300.00
line 3 for price from $100 to $300 step $50    // [300, 450, 600, 750, 900]
line 3 for qty from 1 to 10 step 4             // [100, 500, 900]
```

```solve-doc
length = 2 m                                   // 2.00 m
width = 3 m                                    // 3.00 m
length * width                                 // 6.00 m²
line 3 for length from 1 m to 3 m step 50 cm   // [3, 4.50, 6, 7.50, 9]
line 3 for length from 1 m to 2 m step 30 cm   // [3, 3.90, 4.80, 5.70]
```

## Nothing in the note changes

A what-if and a sweep re-run the lines from their text in a scratch copy of the
engine, and throw the copy away when they have their answer. The note's own
variables and answers are exactly as they were, and the questions stay live:
edit `deposit` on line one and every what-if below it follows the edit. Because
the re-run works from the text, it gives the same answer however a host
evaluates the note, through either of the engine's document passes.

## Limits and refusals

Each case the engine cannot answer honestly is a named error on that line, never
a guess and never a hang.

```solve-doc
x = 5                                 // 5
# Budget
x * 2                                 // 10
line 2 with x = 1                     // ERROR: Line 2 is not a calculation (it is prose, a heading or a blank line), so it has no answer to work out again.
line 3 with y = 3                     // ERROR: No line up to line 3 uses y, so changing it cannot change line 3's answer.
line 3 for x from 1 to 3 step 0       // ERROR: A sweep's step cannot be zero: it would never reach the end of the range.
line 3 for x from 1 to 3 step -1      // ERROR: This sweep runs up from its start to its end, so its step must be positive: as written it moves away from the end and never reaches it.
line 3 for x from 1 to 5000 step 1    // ERROR: This sweep would try 5,000 values, past the limit of 1,000 for one sweep. Use a larger step or a shorter range.
line 3 for x from 3% to 6% step 1     // ERROR: A sweep's start, end and step must be the same kind of value (all plain numbers, all percentages, or all quantities of one kind), so that each step reads one way.
```

The rest, in words:

- A sweep tries at most 1,000 values, and re-runs at most 100,000 lines in all
  (its values times the lines above its target), so a sweep near the bottom of a
  long note is limited to fewer values. The two limits keep a sweep an answer
  rather than a stall.
- An input no line up to the target uses is refused, since changing it cannot
  change the answer and it is almost always a misspelling. Names are matched
  exactly, so `Deposit` is not `deposit`.
- A what-if cannot name its own line, and cannot re-run a line that is itself a
  what-if or a sweep, so one question can never set off another.
- A line in the span that sets a `global :name` is not re-run, because other
  documents read globals and the question's value would reach them. The what-if
  is refused instead.
- A re-run never fetches live data. A line that reads a value the note has
  already fetched (a weather reading, a price) reads it as the note does; a line
  still waiting for one is refused.
- A step whose answer fails, or is not a number, stops the sweep with an error
  that names the value it failed at.

## What it does not cover

- The line asked about is a line number, `line 4`. `prev`, a span of lines, and
  named scenarios kept for reuse (`line 5 in bull`) are not part of this form;
  scenarios are the natural next step on the same re-run.
- The re-run reads the note the way the batch pass does, top to bottom. A
  [goal seek](/syntax/goal-seek/) inside the span answers there with that pass's
  refusal, so a what-if whose line depends on a goal seek line reports the
  refusal rather than a number.
- Goal seek is the reverse question, the input that makes a line reach a target,
  and it still needs its variable on the target line itself.
- A sweep steps numbers, percentages and quantities. It does not step dates or
  times.

A host asks the same question from code, over the whole note, with
`engine.whatIf(text, { deposit: 150000 })`; see
[embedding the engine](/guide/embedding/#asking-what-if).

Like [line references](/syntax/line-references/), these forms only work inside a
document, since they re-run other lines. The single-expression entry point has
no lines to re-run, and answers with an error that says so.
