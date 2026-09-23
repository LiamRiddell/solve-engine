---
title: Banded rates
description: Write a tax, commission or tariff schedule as a table of bands, and apply it to an amount.
---

> **Package:** `TABLES_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

Many charges are not one rate on the whole amount. An income tax charges nothing
on the first part of an income, one rate on the next part, and a higher rate on
what is left. A sales commission pays more on sales past a target. An electricity
tariff charges one price for the first hundred units and another for the rest.
Each of these is a **banded** (or tiered, or progressive) rate: the amount is cut
into bands, and each band has its own rate.

The part that trips people up is that a higher band only charges the part of the
amount inside it. Earning past a threshold does not move the whole income to the
higher rate. That is why banded arithmetic is fiddly by hand, and why the engine
works it out for you from a table you write.

## Writing the bands as a table

A band table has one row per band. The first column says where the band starts,
and the last column says its rate. Each band runs from its own start up to where
the next one starts, and the last band runs on without end.

```solve-doc
| from   | rate |
| ------ | ---- |
| 0      | 0%   |
| 10,000 | 20%  |
| 40,000 | 40%  |

45,000 through bands above                // 8,000
45,000 through bands above / 45,000 as %  // 17.78%
column "rate" for 45,000 in bands above   // 40.00%
```

Read it as three bands: nothing on the first 10,000, 20% on the 30,000 from
10,000 to 40,000, and 40% on everything past 40,000. On 45,000 that is 0, plus
6,000, plus 2,000 on the last 5,000, which is `8,000`.

The engine assumes no bands at all. You write them, so the same form covers any
country's income tax, any commission scheme and any tiered price, and a schedule
that changes next year is a table you edit.

## The total across the bands

`<amount> through bands above` is the total charged across every band the amount
reaches, each part at its own band's rate. `through the bands` reads the same,
and `above` is optional, since the nearest table above is the one read.

The whole expression before `through bands` is the amount, so
`40,000 + 5,000 through bands above` is the total on 45,000. Arithmetic after it
applies to the total: dividing by the amount, as above, gives the overall share
charged, `17.78%`, which is well below the 40% top rate the amount reached.

## The band an amount falls in

`column "rate" for 45,000 in bands above` reads one cell from the band the amount
falls in, rather than totalling across them. For a tax table that is the rate on
the next unit earned (the marginal rate); for a postage table it is the price for
a parcel of that weight. It is the [table lookup](/syntax/table-lookups/) form
with `in bands` added, and `in bands` is what makes it match the band rather
than an exact label.

```solve-doc
| weight (kg) | price  |
| ----------- | ------ |
| 0           | $4.50  |
| 2           | $7.95  |
| 10          | $14.00 |

column "price" for 3.5 in bands above   // $7.95
column "price" for 2 in bands above     // $7.95
column "price" for 12 in bands above    // $14.00
```

An amount exactly on a band's start belongs to that band, so 2 kg is charged at
the band that starts at 2. Any column can be read, not only the last.

## Money, shares and prices

Amounts and band starts can be money. A plain amount takes the table's currency,
and money stays exact to the penny:

```solve-doc
| sales from | commission |
| ---------- | ---------- |
| $0         | 5%         |
| $50,000    | 8%         |
| $100,000   | 10%        |

$120,000 through bands above                     // $8,500.00
120000 through bands above                       // $8,500.00
column "commission" for $120,000 in bands above  // 10.00%
```

The rate column can hold three kinds of rate, and each is charged on the part of
the amount inside its band:

- **A percentage** charges a share of that part, as a tax or a commission does.
- **A price** (`$0.18`) charges that much for each unit of the part, as a tiered
  tariff does. The amount is then a count, such as units used, and the total is
  in the price's currency.
- **A plain number** multiplies the part, so `0.2` works as `20%` does.

```solve-doc
| kWh | price |
| --- | ----- |
| 0   | $0.12 |
| 100 | $0.18 |
| 500 | $0.25 |

350 through bands above                 // $57.00
column "price" for 350 in bands above   // $0.18
```

That is 100 units at $0.12 and 250 at $0.18. A plain `0` can sit among
percentages or prices, since a zero rate is zero whichever way it is read.

## When bands are refused

A table that does not say clearly what its bands are is refused, with the line to
fix, rather than read one way and answered with a number that might be wrong.

```solve-doc
| up to  | rate |
| ------ | ---- |
| 10,000 | 0%   |
| 40,000 | 20%  |

45,000 through bands above   // ERROR: The first column is headed "up to", which reads as where each band ends. Bands are read by where each one starts: head the column "from" and write each band's starting point, the first being 0.
```

A table written by where each band ends reads one row out if taken as starts,
which would charge every part at the wrong rate, so a first column headed `up
to`, `to`, `under`, `max` and the like is refused. Write the starts instead, the
first being 0.

```solve-doc
| from   | rate |
| ------ | ---- |
| 10,000 | 20%  |
| 40,000 | 40%  |

45,000 through bands above                // ERROR: The first band starts at 10,000, so the part of an amount below it falls in no band. Add a band from 0, at 0% if nothing is charged there.
column "rate" for 5,000 in bands above    // ERROR: 5,000 falls below the first band, which starts at 10,000.
```

A total needs a first band from 0, so that every part of the amount falls in one.
A band that charges nothing is written with a 0% rate rather than left out, which
keeps the table saying what it means.

```solve-doc
| from   | rate |
| ------ | ---- |
| 0      | 0    |
| 10,000 | 20   |
| 40,000 | 40%  |

45,000 through bands above   // ERROR: Line 4's rate 20 is a plain number among percentages: write 20% if a percentage is meant.
```

A plain `20` among percentages is far more likely a missing `%` than a rate of
twenty times the amount, so it is refused rather than charged. Starts that do
not rise down the table, a start that is not a number or an amount of money, a
missing or unreadable rate, rates that mix percentages and prices, an amount in a
different currency from the bands, and an amount below zero are refused the same
way.

## What banded rates do not do

- **Rules beyond the bands are not modelled.** An allowance that shrinks as income
  rises, a threshold that depends on something other than the amount, or a flat
  fee charged per band are outside what a table of starts and rates says. The
  [payroll](/syntax/payroll/) forms carry the full UK rules for England, Wales and
  Northern Ireland, taper included.
- **The first column is where each band starts, and the last is its rate.**
  Columns between them, such as a band's name, are ignored by the total.
- **Amounts are plain numbers or money.** An amount with a unit such as `3 kg` is
  refused rather than compared with a table that does not state its unit; write
  the number alone.
- **Only the nearest table above is read,** as with
  [table columns](/syntax/table-columns/).

Like the other [cross-line forms](/syntax/line-references/), banded rates only work
inside a document, since they read a table elsewhere in the note.
