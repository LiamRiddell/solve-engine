---
title: Frozen answers
description: Keeping a live answer fixed, with the date it was fixed, so a shared or archived note reads the same later.
---

> **Built in.** `frozen` belongs to the engine rather than to a package, so it works on any line, whichever packages are registered.

Some answers are live: an exchange rate, a share price or a temperature is
fetched when the line is evaluated, so `10 USD in GBP` shows a slightly different
amount tomorrow. That is right for a line you glance at to see today's figure,
and wrong for an expense claim, a quote or an archived report, where the amount
written down is the amount that was agreed.

Ending a line with `frozen` keeps its first answer. The first time the line
settles on a value, the engine stores that value together with the moment it was
fixed, and from then on answers with the same amount without asking the provider
again. The line below is live, so its amount depends on the day you read this
page; the point is that it stops depending on the day once it has answered.

```solve
10 USD in GBP frozen
```

| Line | Before | Now |
| --- | --- | --- |
| `10 USD in GBP` | today's rate, and next month's rate next month | unchanged: a line without `frozen` still follows the rate |
| `10 USD in GBP frozen` | `Unexpected token after expression: "frozen"` | today's rate, kept, with the date it was frozen |

The answer carries its date and where its figures came from (the rate's provider
and when it was fetched), so an app can show "frozen 23 Sep 2026, reference
rate" beside the line. See [async and live data](/guide/async-and-live-data/#keeping-an-answer-fixed)
for how a host reads them.

## Lines built on a frozen answer

A frozen line can be read like any other: by a later line, or through a variable
it defines. Those later lines compute from the frozen amount, so they do not move
either. `frozen` works on any answer, live or not; freezing a fixed calculation
changes nothing about it, which makes it a convenient way to see the shape:

```solve-doc
:deposit = 250 * 4 frozen // 1,000
deposit + 50 // 1,050
```

With a live figure the same shape keeps a rate for the rest of a note:

```solve-doc
:rate = 1 USD in GBP frozen
120 USD in GBP
120 * rate
```

The second line follows the market and the third does not. A line computed from
a frozen answer is not itself marked frozen, because it is a new value, but it
carries the frozen rate's record, date included, so an app can still show which
lines depend on it.

## Naming the day

A bare `frozen` fixes the answer the first time the line settles in the engine
that evaluates it. A note sent to someone else, or opened on another machine,
arrives as text: if the stored answer does not travel with it, the line would be
frozen afresh at that day's rate, and the note would read differently without
saying so.

Naming the day closes that gap. `frozen on 2026-09-23` says the answer was frozen
on that day, so an engine that holds a value frozen that day answers with it, and
one that does not refuses the line by name rather than freezing a new one. Writing
today's date freezes the line now, as a bare `frozen` does.

```solve-doc
10 USD in GBP frozen on 2024-01-15 // ERROR: This line was frozen on 2024-01-15, but no value frozen that day is stored in this engine. A frozen value is never fetched again: restore the snapshot or frozen values it was saved with, or remove "on 2024-01-15" to freeze it anew.
```

This is a different question from `100 USD in GBP on 2024-01-15` on the
[currency](/syntax/currency/) page. That form asks a historical provider for the
rate on a past day, which is how a note converts at a day it was not written on.
`frozen on` fetches nothing: it reads back an answer this engine, or a snapshot of
it, already holds. The date after `frozen on` has to be a date, at the end of the
line:

```solve-doc
10 USD in GBP frozen on tuesday // ERROR: "frozen on" needs the day the answer was frozen, written as a date at the end of the line, as in "frozen on 2026-09-23".
```

## Where the answer is kept

A frozen answer is kept by the engine that froze it, under the line's text (without
the word `frozen`, and with spacing ignored), so two lines that say the same thing
share one answer. An app that saves an engine snapshot saves its frozen answers
with it, and a snapshot restored later answers the same lines with the same
amounts, with the network switched off if need be. Clearing the engine for a new
document forgets them, and an app can forget one on purpose so that its line
freezes again. The [embedding guide](/guide/embedding/#snapshotting-and-restoring-state)
covers the snapshot.

## What frozen does not do

- **It freezes a whole line.** The word goes at the end, after everything the line
  computes; there is no way to freeze half of a line. Split the part to keep onto
  a line of its own.
- **It needs one answer to keep.** A function definition or a global cell cannot
  be frozen, and neither can a line that defines a value part-way through; each is
  refused by name.
- **It waits for a settled answer.** A line still fetching is not frozen until its
  value arrives, and a line that fails (no rate, network switched off) is not
  frozen at all, so it can still freeze once it succeeds.
- **It does not refresh.** A frozen answer never moves on its own. To take a new
  figure, remove `frozen`, change the line, or have the app forget the stored
  answer. Editing the line's text freezes it afresh, since it is now a different
  line.
- **It keeps the word.** At the end of a line `frozen` is the suffix, so a
  variable called `frozen` there needs its operator written out: `2 * frozen`
  multiplies, `2 frozen` freezes `2`.

```solve-doc
f(x) = 2x frozen // ERROR: frozen keeps a line's answer, and a function definition has no answer to keep. Freeze a line that calls the function instead.
```
