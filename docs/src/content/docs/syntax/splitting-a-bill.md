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

`split`, `ways` and `people` are ordinary words everywhere else. They are read
as the split grammar only inside the full shape, so a variable named `split`, or
`:split = 5`, is untouched. The count must be a whole number of at least one, and
a literal: a parenthesised or worded count leaves `split` an ordinary word.
