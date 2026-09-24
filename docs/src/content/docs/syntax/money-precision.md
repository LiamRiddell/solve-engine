---
title: "Money precision"
description: Why money arithmetic is exact, and how the half-cent rounds.
---

> **Package:** `CURRENCY_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

Money is exact. A price is a decimal, not a binary fraction, so amounts in the
same currency add, subtract, multiply and divide without the rounding error a
floating-point number carries. This is what keeps a column of prices adding up to
the cent instead of drifting by a fraction of a penny.

```solve
$0.10 + $0.20 // $0.30
$19.99 * 3 // $59.97
$100 - $99.99 // $0.01
$10 / 3 // $3.33
$0.70 * 1.10 // $0.77
```

A half-cent rounds away from zero, the way a till rounds it, rather than the way
`toFixed` rounds the nearest double sitting just below it.

```solve
$1.005 // $1.01
$2.675 // $2.68
$0.10 + 15% // $0.12
```

Exactness holds wherever a currency is involved, a currency against a plain
number included, and that includes adding a percentage: `$0.10 + 15%` is
`$0.115`, which the half-cent rule rounds up.

## Prices per unit

A price per unit, such as 15 cents a kilowatt-hour or £4.50 a kilogram, is
money too. It keeps the decimal it was typed as, so the bill it gives is the
exact product, and a half cent rounds the same way however the bill is written:
with `*`, with `at`, or with `per`. At 15 cents, 12.3 kilowatt-hours cost exactly
$1.845, which rounds up to $1.85 in every spelling.

```solve
$0.15 * 12.3 // $1.85
12.3 kWh * $0.15/kWh // $1.85
12.3 kg at $0.15/kg // $1.85
$0.15 per kg * 12.3 kg // $1.85
$0.15 * 12.3 kWh // $1.85
12300 Wh * $0.15/kWh // $1.85
```

A price per unit on its own line rounds a half cent the way an amount does. A
price below a cent keeps its significant digits, because a tenth of a cent a
kilowatt-hour is a real price, where a tenth of a cent on its own is not an
amount anyone can pay.

```solve
$1.005/kg // 1.01 USD/kg
$0.001/kWh // 0.001 USD/kWh
$0.001 // $0.00
```

The quantity is not money, so it is held as a floating-point number, as every
other unit is (see [decimals](/syntax/decimals/)). Its decimal is read back from
that number, which is exact for a quantity typed as a decimal and for one
converted onto a short decimal, such as 12,300 watt-hours onto 12.3
kilowatt-hours. A quantity whose number is floating point's rounding of a
fraction, such as a third of a kilowatt-hour, is worked out in floating point,
as it always was. So is a price that was worked out rather than typed
(`$1.20 / 0.4 kg`), and a price per unit multiplied by another rate
(`$0.15/kWh * 12.3 kWh/day`), whose answer is a new rate rather than an amount
of money.

A bare decimal follows the same rules without a currency, so the two agree:
`0.1 + 0.2 == 0.3` is true, and `100 + 10%` is exactly 110. See
[decimals](/syntax/decimals/) for what that covers and where it ends. A
conversion between two currencies goes through a live rate, which is not exact.

```solve
0.1 + 0.2 == 0.3 // true
0.70 * 1.10 // 0.77
```
