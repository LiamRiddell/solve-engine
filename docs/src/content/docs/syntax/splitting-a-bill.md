---
title: "Splitting a bill"
description: Dividing an amount between people, with the odd penny accounted for.
---

> **Package:** `FINANCE_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

Splitting a bill is the most common money note there is: an amount divided by the
number of people paying it. `split <amount> between <N>`, or `<amount> split <N>
ways`, answers it in place.

```solve
split $120 between 3 // $40.00 each
$120 split 3 ways // $40.00 each
split $100 between 4 people // $25.00 each
```

The amount stays exact, so a tip written as a percentage composes with the split
on one line: `$120 + 18%` is `$141.60`, and split three ways that is `$47.20`
each. A bare number splits to a bare number, so no currency is invented where
none was written.

```solve
$120 + 18% split 3 ways // $47.20 each
10 split 3 ways // 3.33 each
```

The boundary is the odd penny. `split $100 between 3` is not a bare `$33.33
each` that quietly loses a penny: the extra penny is named, and the shares add
back to the total to the cent.

```solve
split $100 between 3 // $33.33 each, with 1 share paying $33.34
```

The odd amount is the currency's smallest one, its minor unit (see
[money precision](/syntax/money-precision/#each-currencys-own-places)). A yen
has no subunit, so a yen bill is shared out in whole yen, and a Kuwaiti dinar is
counted to the thousandth, so a dinar bill is shared to the fils.

```solve
¥100 split 3 ways // ¥33 each, with 1 share paying ¥34
split ¥1000 between 3 // ¥333 each, with 1 share paying ¥334
split 10 KWD between 3 // 3.333 KWD each, with 1 share paying 3.334 KWD
```

The amount can be a fraction of a sum, written as a fraction: `1/2 KWD` is half
a dinar, as it is on a line of its own, and it is shared to the fils as `0.5
KWD` would be. A fraction that ends in base ten (a half, three eighths) is an
exact amount; one that does not (a third) is its nearest decimal.

```solve
split 1/2 KWD between 3 // 0.166 KWD each, with 2 shares paying 0.167 KWD
split 3/8 KWD between 2 // 0.187 KWD each, with 1 share paying 0.188 KWD
```

`split`, `ways` and `people` are ordinary words everywhere else. They are read
as the split grammar only inside the full shape, so a variable named `split`, or
`:split = 5`, is untouched. The count must be a whole number of at least one, and
a literal: a parenthesised or worded count leaves `split` an ordinary word.
