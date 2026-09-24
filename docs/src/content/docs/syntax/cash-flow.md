---
title: "NPV, IRR & payback"
description: Judging an investment from its cash flows, with the net present value, the internal rate of return and the payback period.
---

> **Package:** `FINANCE_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

A cash flow is money moving at a point in time: money paid out is negative, money
received is positive. An investment is a series of them, usually an outlay today
followed by a return each year (or each month, or any regular period). Three
questions are asked of such a series, and each has a form here: what the whole
series is worth in today's money, what rate of return it earns, and how long it
takes to get the outlay back.

```solve
npv of -1000, 300, 400, 500 at 10% // -21.04
irr of -1000, 300, 400, 500 // 8.90%
payback of -1000, 300, 400, 500 // 2.60
```

The flows are written after `of`, in order, one per period, separated by commas
(a closing `and` reads the same).

## Net present value

Money later is worth less than money now, because money now could be earning a
return in the meantime. Discounting brings a future amount back to today: at 10%
a year, 110 a year from now is worth 100 today, since 100 invested at 10% grows to
110. The rate used is the **discount rate**, the return the money could earn
elsewhere, or what it costs to borrow.

The **net present value** (NPV) discounts every flow to today and adds them up.
A positive NPV means the investment earns more than the discount rate, a negative
one means it earns less, and zero means it exactly breaks even.
`npv of <flows> at <rate>` gives it.

```solve
npv of -1000, 300, 400, 500 at 10% // -21.04
npv of -1000, 300, 400, 500 at 5% // 80.44
npv of -100, 110 at 10% // 0
```

At 10% the series is worth 21.04 less than nothing in today's money, so it falls
short; at 5% it clears the bar by 80.44. The discounting is done in exact
decimals, so a series that breaks even exactly answers exactly 0, not the tiny
remainder floating-point arithmetic would leave.

### The first flow is today

**The first flow is today and is not discounted.** The second is one period away
and is divided by `1 + rate` once, the third twice, and so on. The rate is per
period, so yearly flows take a yearly rate. `net present value of` is the same
form spelled out, and the sum written by hand agrees with it.

```solve
net present value of -1000, 300, 400, 500 at 10% // -21.04
-1000 + 300 / 1.1 + 400 / 1.1^2 + 500 / 1.1^3 // -21.04
```

A spreadsheet's `NPV()` function reads its values differently: it takes the first
one to arrive at the end of the first period and discounts it too, so
`NPV(10%, -1000, 300, 400, 500)` answers -19.12, which is -21.04 divided by 1.1.
The usual spreadsheet idiom adds the outlay outside the function,
`-1000 + NPV(10%, 300, 400, 500)`, and that is exactly the figure here. For the
same reason there is no `npv(...)` function-call spelling: a call written like the
spreadsheet's that answered differently would be a trap.

A rate written as a bare number is a proportion, as in the other finance forms,
so `at 0.1` is 10% and `at 10` is 1,000%.

### Money and lists

Amounts of money keep their currency, and a plain number among them is read in
that currency, the way `$1,000 + 300` is.

```solve
npv of -$1,000, $300, $400, $500 at 10% // -$21.04
npv of -£5,000, £1,500, £2,000, £2,500 at 8% // £88.15
npv of -$1,000, 300, 400, 500 at 10% // -$21.04
```

A series can also be one bracketed list, or a variable holding one, which is
handy when the same flows are asked all three questions. A list holds plain
numbers, so its answers are plain numbers too.

```solve
flows = [-1000, 300, 400, 500]
npv of flows at 10% // -21.04
irr of flows // 8.90%
payback of flows // 2.60
```

## Internal rate of return

The **internal rate of return** (IRR) is the discount rate at which the NPV is
exactly zero: the break-even rate. It is the rate the investment itself earns on
the money tied up in it, so it can be set directly against an interest rate, or
against the minimum return a project has to clear (its hurdle rate). The NPV
above was negative at 10% and positive at 5%, so the IRR lies between the two.

```solve
irr of -1000, 300, 400, 500 // 8.90%
irr of -$1,000, $300, $400, $500 // 8.90%
```

The IRR is a rate per period, a yearly rate for yearly flows, and it is the same
whatever currency the flows are in.

A series that never changes sign has no IRR, since no rate can bring money that
only goes out, or only comes in, to zero. A series whose sign changes more than
once (an outlay, some returns, then a clean-up cost at the end) can have more than
one rate at which the NPV is zero. A spreadsheet's `IRR()` answers whichever one
its starting guess happens to lead to. Solve counts the rates exactly, rather than
searching from a guess, and gives an answer only when there is exactly one;
otherwise it names every rate, or says there is none. Two rates so close together
that a number cannot tell them apart are refused the same way.

```solve-doc
irr of -100, 230, -132 // ERROR: irr: these flows have 2 internal rates of return, 10.00% and 20.00%, so no single rate is given
irr of -100, 250, -200 // ERROR: irr: no rate above -100% makes the net present value of these flows zero, so they have no internal rate of return
irr of 100, 200 // ERROR: irr: the flows never change sign (all money out or all money in), so no rate makes their net present value zero
```

A second sign change does not always bring a second rate, and when there is still
only one, it is answered:

```solve
irr of -10000, 4000, 4000, -3000, 6000, 5000 // 16.79%
```

## Payback period

The **payback period** is how long the returns take to repay the outlay: add the
flows up period by period and see when the running total climbs back to zero. It
ignores the time value of money (the NPV is the discounted view), but it answers
the plain question of how long the money is at risk.

```solve
payback of -1000, 300, 400, 500 // 2.60
payback period of -1000, 300, 400, 500 // 2.60
```

After one period 700 is still owed, and after two, 300. The third period brings
500, and taking it to arrive evenly through the period, the last 300 is covered
three-fifths of the way through, so the payback is 2.6 periods. The answer is a
count of periods: years, when the flows are yearly.

When a later outlay pulls the running total below zero again, the payback is the
last time it recovers, since the money is not back until it stays back.

```solve
payback of -1000, 1200, -500, 600 // 2.50
```

Here the total is back above zero after one period, is 300 short again after
two, and recovers halfway through the third, when that period's 600 has covered
the 300.

A series that never recovers, or that is never below zero to begin with, is
refused rather than given a number.

```solve-doc
payback of -1000, 300, 400 // ERROR: payback: the flows never pay back the outlay; the running total is still 300 short after the last one
payback of 100, 200 // ERROR: payback: the running total of the flows is never below zero, so there is no outlay to pay back
```

## What these forms do not cover

- **Evenly spaced flows only.** Each flow is one period after the last. A series
  on irregular dates (a spreadsheet's `XNPV` and `XIRR`) needs a day-count
  convention to turn dates into fractions of a year, which is a separate
  decision, so it is not a form here.
- **One currency per series.** Flows in two currencies are refused rather than
  converted, since converting a future flow at today's exchange rate would be a
  guess presented as a figure. Convert them first, at the rate you mean.
- **No discounted payback and no modified IRR.** The NPV is the discounted
  measure; the payback here is the simple, undiscounted one.
- **A rate above -100%.** At -100% or below, `1 + rate` is zero or negative and
  discounting has no meaning, so the rate is refused.
- **The rate ends the form.** Everything after `at` is the rate, so to do
  arithmetic on an NPV, put the form in brackets:
  `(npv of -1000, 300, 400, 500 at 10%) * 2`.

A flow that is not an amount of money or a plain number, fewer than two flows,
and a list mixed with flows written one by one are refused the same way: each
answer is either the right figure or a structured error that names the problem.
