---
title: "A freelance week"
description: Hours worked, the week's total, the invoice, and what is left after tax.
---

Five days of work, an hourly rate, and the question everyone actually has: what
lands in the bank. This is one document you can paste and edit, rather than four
separate sums.

```solve-doc
8h15m #worked
7h45m #worked
8h30m #worked
8h00m #worked
6h15m #worked
total of #worked in hours // 38.75 hours
prev at £65/hour // £2,518.75
prev - 20% // £2,015.00
```

Change any day and every line below it follows.

## What each line is doing

**`8h15m`** is a duration written the way a timer prints one. `8h 15m` means the
same thing; use whichever you have to hand. See [time](/syntax/time/).

**`#worked`** is a category tag. It marks a line as belonging to a group, and it
does not change what the line is worth. See
[category tags](/syntax/category-tags/).

**`total of #worked`** adds up every line carrying that tag, wherever it sits in
the document. `in hours` converts the total, which arrives in minutes because
that is the unit durations are counted in.

**`prev`** is the result of the line above. It saves naming a variable for a
number you are only going to use once. See
[line references](/syntax/line-references/).

**`at £65/hour`** multiplies a duration by a rate and gives money. The rate
carries its own unit, so the hours and the rate agree without you converting
either. See [rates and speeds](/syntax/rates-and-speeds/).

**`- 20%`** takes twenty percent off. It is a flat rate stated on the line, which
is the right shape here: a real tax position depends on your allowances, your
other income and where you live, and none of those are on this page.

## If you want the bands instead of a flat rate

For a UK salary rather than a flat percentage, `after tax` runs the HMRC income
tax and National Insurance bands. It takes pounds, because those bands are
British, and everywhere else states its own rate.

```solve
£50,000 after tax // £39,519.60
£50,000 after 20% tax // £40,000.00
```

See [payroll](/syntax/payroll/) for which year's figures those are and what they
deliberately do not cover.

## Changing the shape of the week

The document is not fixed to five days or to one rate. A tag can hold any number
of lines, so a six-day week is one more line with `#worked` on it. Two rates
means two tags.

Write the days the same way when you do: an aggregate refuses to add hours to
minutes rather than guessing which you meant, so `6h` beside `3h30m` is a
refusal, and `6h00m` beside `3h30m` is a total.

```solve-doc
6h00m #client-a
3h30m #client-a
4h00m #client-b
total of #client-a in hours at £65/hour // £617.50
total of #client-b in hours at £80/hour // £320.00
```
