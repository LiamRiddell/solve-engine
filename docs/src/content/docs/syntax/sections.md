---
title: Sections
description: Total, average or count the figures under a markdown heading, by the heading's name, from anywhere in the note.
---

> **Package:** `LINES_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

A long note is usually split into parts: a budget with one part for travel, one
for food, one for the house. In markdown, each part starts with a **heading**, a
line that begins with `#`. The number of `#` marks says how deep the heading
sits, so `# Travel` is a top-level heading and `## Flights` is a smaller one
inside it. The lines under a heading, down to the next heading at the same level
or above, are its **section**.

A section total names the heading and adds up the figures under it, wherever
the total is written. It finds the block by name rather than by line numbers, so
it keeps giving the right answer as lines are added to the section or the note
is rearranged.

| Expression | Meaning |
| --- | --- |
| `total of section "Travel"` | the sum of the figures under the Travel heading |
| `sum of section "Travel"` | the same, `sum` is a synonym for `total` |
| `average of section "Travel"` | the mean of those figures |
| `count of section "Travel"` | how many figures there are |

A worked note, with a summary at the bottom. A label before a colon
(`Flights:`) names the line and is set aside, so the line is its figure:

```solve-doc
# Travel
Flights: $450
Hotel: $220
Taxi: $50

# Food
Groceries: $40
Dinner: $25

# Summary
total of section "Travel"     // $720.00
total of section "Food"       // $65.00
average of section "Travel"   // $240.00
count of section "Travel"     // 3
```

The name is matched without regard to case or extra spaces, so
`total of section "travel"` finds `# Travel`. Nothing else is forgiven: a name
that is not quite a heading's is an error, not a guess at the nearest block.

## Why not `total above` or a line range

[`total above`](/syntax/line-references/) adds up the lines directly above it
and stops at the first blank line or heading, so it only works written at the
foot of its own block. `sum(line 2 : line 4)` names the lines by number, and
those numbers go stale as soon as a line is inserted above them. A section
total can sit anywhere below the block, a summary at the bottom of the note
included, and it reads whatever is under the heading at the time.

## What a section holds

A heading's section takes in the smaller headings inside it. `# Travel` runs
down to the next `#` heading, so it holds `## Flights` and `## Hotels` and
everything under them, while `## Flights` stops at the next `##`:

```solve-doc
# Travel
## Flights
Outbound: $300
Return: $150
## Hotels
Rome: $220

# Summary
total of section "Travel"    // $670.00
total of section "Flights"   // $450.00
total of section "Hotels"    // $220.00
```

The last section in the note runs to the end of the note.

Blank lines and the smaller headings inside a section are passed over, and so
is a line that is only a comment, a note to yourself starting with `//`. None of
them interrupts the total:

```solve-doc
# Travel
Flights: $450

## Extras
Seat upgrade: $20

# Summary
total of section "Travel"   // $470.00
```

Money and units carry through, read in the unit the first figure is written in:

```solve-doc
# Walks
Park: 1.2 km
Canal: 3 km
Hill: 800 m

# Week
total of section "Walks"   // 5.00 km
```

### Subtotals are not counted twice

A section often ends with its own subtotal, and a summary part of the note can
hold one total per section. A line that is itself a summary of other lines is
left out of a section total, because the figures it sums are already counted:

```solve-doc
# Travel
Flights: $450
Hotel: $220
Subtotal: total above         // $670.00

# Summary
total of section "Travel"     // $670.00
count of section "Travel"     // 2
```

The summaries left out are `total above` and its siblings, a
`sum(line 2 : line 4)` span, a [category tag](/syntax/category-tags/) total,
`total by tag`, and another section total. A line that reads a single other
line, such as `prev` or `line 3`, is a figure of its own and is counted.

A section total can also sit at the foot of the section it totals. It leaves
itself out:

```solve-doc
# Travel
Flights: $450
Hotel: $220
total of section "Travel"   // $670.00
```

The answer is a value like any other, so it can be scaled, compared or kept in a
variable:

```solve-doc
# Travel
Flights: $450
Hotel: $220

# Plan
total of section "Travel" * 1.2       // $804.00
:budget = total of section "Travel"   // $670.00
budget - $100                         // $570.00
```

## A clear error, never a silent figure

A name that no heading carries is an error that lists the headings there are, so
a slip in the name is a one-look fix:

```solve-doc
# Travel
Flights: $450

# Summary
total of section "Travle"   // ERROR: No heading is named "Travle". The headings in this note are "Travel" and "Summary".
```

A name two headings carry is refused rather than guessed at, since either block
could be the one meant:

```solve-doc
# March
## Travel
Train: $40
# April
## Travel
Train: $55

# Summary
total of section "Travel"   // ERROR: 2 headings are named "Travel" (lines 2 and 5), so the section is unclear. Give each its own name.
```

To add up the same heading repeated across a note, a `## Travel` under every
month, tag those lines and total the tag instead (see
[category tags](/syntax/category-tags/)).

A figure that is not a number, a mix of measures, and a section with no figures
at all are each refused the same way. `count of section` counts presence rather
than value, so it counts a line of text too, and gives `0` for an empty section:

```solve-doc
# Travel
Flights: $450
"booked in May"

# Summary
total of section "Travel"   // ERROR: Line 3, under "Travel", is text, so it cannot be added: only numbers and quantities can.
count of section "Travel"   // 2
```

```solve-doc
# Travel
Flights: $450
Luggage: 23 kg

# Summary
total of section "Travel"   // ERROR: money and mass cannot be added
```

```solve-doc
# Travel

# Summary
total of section "Travel"   // ERROR: The section "Travel" has no figures to add up.
count of section "Travel"   // 0
```

A sentence of prose inside a section is a line the engine cannot read as a
figure, so it stops the total with an error naming that line. Write notes to
yourself after `//` and they are passed over.

## Boundaries

A few boundaries, each deliberate:

- **The total goes below the block it reads.** It reads lines that have already
  been worked out, the way `total above` does, so a section total written above
  its section reports the first line it could not read yet:

```solve-doc
total of section "Travel"   // ERROR: Line 3 has not been evaluated yet (forward reference, or out of range)
# Travel
Flights: $450
```

- **One heading per name.** Two headings with the same name are refused rather
  than added together; a heading path such as `"April / Travel"` is not read.
- **Headings are read the way the rest of the engine reads them.** Any line
  whose first character is `#` is a heading, so `#Travel` with no space is one
  too, while a colour such as `#fff` is not. A closing run of `#` after the name
  (`## Travel ##`) is ignored.
- **Only `total`, `sum`, `average` and `count`.** The median, smallest and
  largest of a section are not offered; the [statistics](/syntax/statistics/)
  forms read a list or a table column.
- **The word `section` is only special in the whole phrase.** A quoted name has
  to follow it, so a variable named `section` keeps working (see
  [trigger words](/syntax/trigger-words/)).

Like [line references](/syntax/line-references/), these forms only work inside a
document, since they read other lines. They return an error through the
single-expression entry point, which has no document to read.
