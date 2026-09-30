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

The list holds the answers in the first answer's unit, since a list carries one
unit (see [lists and units](/syntax/vectors-and-matrices/#lists-and-units)): a
sweep of a money line lists money, a quantity lists its quantities, converting a
later answer in another unit of the same measure, and a percentage lists as its
fraction. Answers in two measures have no one unit and stop the sweep by name.

```solve-doc
price = $100                                   // $100.00
qty = 3                                        // 3
price * qty                                    // $300.00
line 3 for price from $100 to $300 step $50    // [$300.00, $450.00, $600.00, $750.00, $900.00]
line 3 for qty from 1 to 10 step 4             // [$100.00, $500.00, $900.00]
```

```solve-doc
length = 2 m                                   // 2.00 m
width = 3 m                                    // 3.00 m
length * width                                 // 6.00 m²
line 3 for length from 1 m to 3 m step 50 cm   // [3.00 m², 4.50 m², 6.00 m², 7.50 m², 9.00 m²]
line 3 for length from 1 m to 2 m step 30 cm   // [3.00 m², 3.90 m², 4.80 m², 5.70 m²]
```

### Sweeping a date

A sweep can step a date too, which answers "this line for each month from
January". The start and the end are dates, and the step is a length of time:
days, weeks, months or years.

```solve-doc
start = 2026-01-01                                            // Thursday, January 1, 2026
finish = 2026-12-31                                           // Thursday, December 31, 2026
working days between start and finish                         // 261
line 3 for start from 2026-01-01 to 2026-04-01 step 1 month   // [261, 239, 219, 197]
line 3 for start from 2026-01-01 to 2026-01-15 step 1 week    // [261, 256, 251]
line 3 for start from 2026-04-01 to 2026-01-01 step -1 month  // [197, 219, 239, 261]
```

A date steps the way `<date> + <duration>` moves one. A month or a year moves
the calendar month, so a step of one month from 31 January lands on 28 February
(29 in a leap year), then 31 March, each the last day of its month rather than a
date that drifts. A day or a week moves the calendar day and keeps the time of
day, even across a clock change; a step in hours or minutes is elapsed time. The
same limit of 1,000 values applies, and the step's direction has to run towards
the end.

```solve-doc
start = 2026-01-01                                            // Thursday, January 1, 2026
finish = 2026-12-31                                           // Thursday, December 31, 2026
working days between start and finish                         // 261
line 3 for start from 2026-01-01 to 2026-04-01 step 5         // ERROR: A sweep between two dates steps by a length of time, such as 1 month, 7 days or 1 year.
line 3 for start from 2026-01-01 to 2030-01-01 step 1 day     // ERROR: This sweep would try more than 1,000 dates, past the limit of 1,000 for one sweep. Use a larger step or a shorter range.
```

The answers are listed, so the line swept has to answer a number or a quantity.
A line whose answer is itself a date (`start + 30 days`) has no place in a list,
and the sweep says so, naming the date it reached.

## Named scenarios

A **scenario** is a set of inputs kept in the note under a name, such as a bull
case and a bear case for a forecast, so that any line can be read under either
without writing the inputs out again. Declare one on its own line with
`scenario`, its name, `with`, and the inputs, written as a what-if writes them;
then `line 3 under bull` reads line three with those inputs in force.

```solve-doc
price = $100                                   // $100.00
qty = 3                                        // 3
price * qty                                    // $300.00
scenario bull with price = $120, qty = 5       // bull: price = $120.00, qty = 5
scenario bear with price = $80 and qty = 2     // bear: price = $80.00, qty = 2
line 3 under bull                              // $600.00
line 3 under bear                              // $160.00
line 3 under bull - line 3                     // $300.00
```

The declaration answers a summary of the inputs it keeps, so you can see what
each scenario holds. It is a statement rather than a figure, so a `total above`
passes over it, as it passes over a check. A scenario read is the what-if it
stands for, `line 3 with price = $120, qty = 5`, worked out where the reading
line stands: its values may use variables, it follows its inputs through every
line in between, and the note's own values are untouched. Edit the declaration
and every line read under it follows.

A scenario is declared before it is read, since a note is read from the top, and
each name is declared once. Every refusal a what-if gives is a scenario's too:

```solve-doc
x = 1                                 // 1
x * 2                                 // 2
scenario high with x = 5              // high: x = 5
scenario spare with y = 5             // spare: y = 5
line 2 under high                     // 10
line 2 under low                      // ERROR: No line above this one declares a scenario named low. Declare it first, as in "scenario low with growth = 8%".
line 2 under spare                    // ERROR: No line up to line 2 uses y, so changing it cannot change line 2's answer.
```

`under` is used because the words that could otherwise follow a line reference
already mean something there: `line 3 in miles` is a conversion, `with` starts
a what-if and `for` a sweep. The words `scenario` and `under` are claimed only in
these shapes, so a variable named either still works.

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
- The note as a whole has a budget too. Every what-if and sweep in it, with the
  other forms that reach across lines (goal seek's probes and the span totals
  such as `total above`), spends from one count of line runs per evaluation of
  the note, a million by default (`vm.maxLineRunsPerPass`). A sweep that would
  take the note past it is refused, and the lines above keep their answers, so
  twenty sweeps each inside their own limit cannot together stall the note.
- An input no line up to the target uses is refused, since changing it cannot
  change the answer and it is almost always a misspelling. Names are matched
  exactly, so `Deposit` is not `deposit`.
- A what-if cannot name its own line, and cannot re-run a line that is itself a
  what-if or a sweep, so one question can never set off another. For the same
  reason, [goal seek](/syntax/goal-seek/) will not target a line that holds a
  what-if or a sweep, since it re-runs its target up to a hundred times.
- A line in the span that sets a `global :name` is not re-run, because other
  documents read globals and the question's value would reach them. The what-if
  is refused instead.
- A re-run never fetches live data. A line that reads a value the note has
  already fetched (a weather reading, a price) reads it as the note does; a line
  still waiting for one is refused.
- A step whose answer fails, or is not a number, stops the sweep with an error
  that names the value it failed at.
- The steps of a sweep share its line's budgets: the 2,000,000 elements (list
  items and matrix cells) one line may create, and the user-defined-function
  calls one line may make. Sharing is what stops a thousand steps from using a
  thousand times what a line may. A sweep whose steps together reach either
  budget stops with an error that says so, naming the value it had reached,
  rather than blaming that step, which may answer on its own. A step that is
  over a budget by itself is still reported as that step's failure.

## What it does not cover

- The line asked about is a line number, `line 4`. `prev` and a span of lines
  are not part of this form.
- A scenario overrides inputs of this note only. One whose span sets a `global
  :name` is refused, as a what-if is, since other notes read globals. A scenario
  cannot be read inside another scenario's or a what-if's re-run, and a line
  holding one is not a sweep's or a what-if's target.
- The re-run reads the note the way the batch pass does, top to bottom, working
  each line out once. A [goal seek](/syntax/goal-seek/) inside the span cannot
  re-run its target there, so a what-if whose line depends on a goal seek line
  reports that the goal seek cannot run inside a what-if, rather than a number.
- Goal seek is the reverse question, the input that makes a line reach a target,
  and it still needs its variable on the target line itself.
- A sweep steps numbers, percentages, quantities and dates. A date sweep steps
  by the calendar, so a step in working days is refused, and a line whose answer
  is a date cannot be swept, since a list holds numbers and quantities.

A host asks the same question from code, over the whole note, with
`engine.whatIf(text, { deposit: 150000 })`; see
[embedding the engine](/guide/embedding/#asking-what-if).

Like [line references](/syntax/line-references/), these forms only work inside a
document, since they re-run other lines. The single-expression entry point has
no lines to re-run, and answers with an error that says so.
