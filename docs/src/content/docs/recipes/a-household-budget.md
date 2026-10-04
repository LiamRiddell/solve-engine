---
title: "A household budget"
description: A month's income, fixed bills and day-to-day spending in one note, with section totals, a tag, a running total and checks that say when a limit is passed.
---

A budget answers two questions: how much is left once the bills are paid, and
whether the spending stayed inside the limit you set. This note keeps the month
in three parts, adds each one up without a single `+`, and ends with two checks,
lines that pass or fail rather than answer with a number.

```solve-doc
# Income
Salary: £2,450                             // £2,450.00
Side work: £320                            // £320.00

# Bills
Rent: £950 #fixed                          // £950.00
Council tax: £160 #fixed                   // £160.00
Energy: £118 #fixed                        // £118.00
Phone: £22 #fixed                          // £22.00

# Spending
spent += £64                               // £64.00
spent += £38.50                            // £102.50
spent += £71.20                            // £173.70
spent                                      // £173.70

# Month
:income = total of section "Income"        // £2,770.00
:bills = total of #fixed                   // £1,250.00
:left = income - bills - spent             // £1,346.30
left / 4                                   // £336.57
check left >= £500                         // ✓
check spent <= £150                        // ERROR: check failed: £173.70 is more than £150.00
```

Change a bill or add a line of spending and the month follows. The last check
fails on purpose: the shopping went past £150, and the note shows both amounts
rather than leaving you to notice.

## What each part is doing

**`# Income`** is a heading, and a heading starts a section: the lines under it,
down to the next heading at the same level or above. `total of section "Income"`
adds up every figure in that section, so a new source of income is one more line
under the heading. See [sections](/syntax/sections/).

**`Salary: £2,450`** is a label and an amount. The text before the colon is for
you; the engine reads the amount after it.

**`#fixed`** is a category tag. It marks a bill as belonging to a group without
changing what it is worth, and `total of #fixed` adds up every line carrying it,
wherever it sits. A tag is the tool when the lines you want to add are not all
in one place. See [category tags](/syntax/category-tags/).

**`spent += £64`** keeps a running total: each line adds to `spent` and shows
the total so far, the way a till receipt does. The first one starts from zero.
See [variables](/syntax/variables/).

**`:left = income - bills - spent`** names the answer so that the lines below
can use it. `left / 4` is roughly a week's share of it.

**`check left >= £500`** is a check: a comparison that answers with a tick when
it holds and with an error, naming both sides, when it does not. It is the line
that tells you, at a glance, whether the month worked. See
[conditionals](/syntax/conditionals/).

## Changing the shape of the month

A second tag keeps a second group apart: mark the subscriptions `#subs` and
`total of #subs` sits beside `total of #fixed`. A section can hold subsections
(`## Food`, `## Travel`), and the section's total includes them. What the note
does not do is know your bank balance: every figure is one you typed, so the
answers are as current as the lines are.
