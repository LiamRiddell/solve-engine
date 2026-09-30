---
title: "A mortgage decision"
description: The monthly repayment on a house, what it costs if the rate moves, and working backwards from the repayment you can afford to the price it allows.
---

Buying a house comes down to one number, the monthly repayment, and three
questions about it: what it is at today's rate, what it would be if the rate
moved, and how much house a repayment you can afford would buy. This note
answers all three in one place.

A repayment mortgage is paid off in equal monthly amounts: each one covers that
month's interest and pays off a little of the loan, so the loan is gone at the
end of the term.

```solve-doc
# The house
:price = £320,000                                  // £320,000.00
:deposit = £32,000                                 // £32,000.00
:loan = price - deposit                            // £288,000.00
:rate = 4.5%                                       // 4.50%

# Repayments
monthly repayment on loan over 25 years at rate    // £1,600.80
prev * 12 * 25                                     // £480,239.26
prev - loan                                        // £192,239.26

# If the rate moves
line 8 with rate = 5.5%                            // £1,768.57
line 8 with rate = 3.5%                            // £1,441.80
(line 8 with rate = 5.5%) - line 8                 // £167.77

# What I can afford
solve line 8 for loan = £1,400                     // £251,874.45
prev + deposit                                     // £283,874.45
check line 8 <= £1,700                             // ✓
```

Change the price or the deposit and every answer follows, including the what-if
and the solve.

## What each part is doing

**`monthly repayment on loan over 25 years at rate`** is the repayment on the
loan, paid monthly over the term at the yearly rate. `prev * 12 * 25` is every
payment over the term added up, and `prev - loan` is how much of that is
interest. See [interest and inflation](/syntax/interest-and-inflation/).

**`line 8 with rate = 5.5%`** is a what-if: it works line 8 out again as if the
rate were 5.5%, and leaves the note itself as it is. The line under it asks the
same at 3.5%, and `(line 8 with rate = 5.5%) - line 8` is what a one-point rise
would add to each month. See [what if](/syntax/what-if/).

**`solve line 8 for loan = £1,400`** is goal seek, the what-if run backwards: it
finds the loan that makes line 8 come to £1,400 a month. It solves for the loan,
the name line 8 reads, and adding the deposit back (`prev + deposit`) gives the
price that loan and deposit buy. See [goal seek](/syntax/goal-seek/).

**`check line 8 <= £1,700`** turns a limit into a line that passes or fails. If
a change to the price pushes the repayment past it, the tick becomes an error
that names both amounts.

## What the note leaves out

It is a model of the loan, not of a lender's offer. A fixed rate that reverts
after a few years, arrangement fees, an overpayment and stamp duty each change
the real cost, and none of them is on this page; add the ones that apply to you
as lines of their own. The rate is one number for the whole term, which is the
honest assumption for comparing two options, not a forecast.
