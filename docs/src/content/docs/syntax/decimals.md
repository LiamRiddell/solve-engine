---
title: "Decimals"
description: How a number with a decimal point is held, and where exactness applies.
---

> **Package:** `ARITHMETIC_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

A decimal is a number written with a point, like `0.1`. How it is stored decides
whether small rounding errors creep in, so it is worth knowing which numbers are
kept exact and which are not.

A number written with a decimal point is an ordinary IEEE floating-point value,
so `0.1 + 0.2` is the usual `0.30000000000000004` and transcendental work stays
in floating point where it belongs. Money is the exception: amounts in a
currency are held as exact decimals, so `$0.10 + $0.20` is `$0.30`. See
[money precision](/syntax/money-precision/) for what that covers.

## Numbers too small for two decimal places

Results are shown to two decimal places, which is right for almost everything
and wrong for the answers that live below it. A conversion can land several
orders of magnitude down, and `0.00 MHz` cannot be told apart from a real zero.

So a value that is not zero is never shown as one. Below the ordinary budget it
is shown to three significant digits: as a decimal while the zeros are still
countable, and in exponent form once they are not.

```solve
1 Hz in MHz // 1e-6 MHz
1 byte in GB // 1e-9 GB
1 second in years // 3.17e-8 years
0.001 km // 0.001 km
```

Three digits, rather than everything the double holds, because a conversion is
not more precise than what went into it: `1 second in years` is
`3.17e-8 years`, not the seventeen digits behind it.

Money is the exception, because a currency zero is a real answer rather than a
rounding artefact. A tenth of a penny is not a payable amount, so `$0.001` is
`$0.00` and stays that way.

## Asking for a representation

`as scientific` shows any number in exponent form, whether or not it is small
enough for the engine to reach for one. `sci` is the short spelling.

```solve
1 Hz in MHz as scientific // 1e-6
1500000 as scientific // 1.5e+6
0.25 as sci // 2.5e-1
```

And `to N dp` asks for an exact number of decimal places, on a quantity as much
as on a plain number. It overrides the display rules above in both directions,
because a line that names its precision has said what it wants.

```solve
1.23456 km to 4 dp // 1.2346 km
5 km to 0 dp // 5 km
```
