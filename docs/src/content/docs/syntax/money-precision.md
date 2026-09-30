---
title: "Money precision"
description: Why money arithmetic is exact, how the half-cent rounds, and how many places each currency is shown to.
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
$1.005/kg // $1.01/kg
$0.001/kWh // $0.001/kWh
$0.001 // $0.00
```

A price per unit is written the way the amount is, with the currency's symbol
in front of it or after it, and the unit after the slash. It used to show the
currency's code (`15.00 USD/hour`); the symbol form reads back in as the same
rate.

```solve
$15 per hour // $15.00/hour
£12 per hour // £12.00/hour
€20 per day // €20.00/day
12 SEK per hour // 12.00 kr/hour
$30/hour * 8 hours/day // $240.00/day
```

## Each currency's own places

Most currencies are counted in hundredths: a dollar is a hundred cents, so an
amount of dollars has two decimal places. Not every currency divides that way.
The smallest amount a currency can actually be paid in is its *minor unit*, and
the international standard for currency codes (ISO 4217) records it for each
one. The Japanese yen and the Korean won have no subunit in use, so they have
no decimal places; the Kuwaiti and Bahraini dinars are counted in thousandths
(the fils), so they have three. Each amount is shown to its own currency's
places.

```solve
$100 / 3 // $33.33
¥1000 / 3 // ¥333
₩50000 / 7 // ₩7,143
100 KWD / 3 // 33.333 KWD
1.0005 BHD // 1.001 BHD
```

The amount itself is still exact: `¥1000 / 3` is still a third of a thousand
yen, and three of it give back the thousand. Only what is shown is rounded,
half away from zero as a till rounds, so `¥0.5` shows as `¥1`. Naming the places
on the line still wins over the currency's own figure.

```solve
¥1000 / 3 * 3 // ¥1,000
¥0.5 // ¥1
¥1000 / 3 to 2 dp // ¥333.33
100 KWD / 3 to 2 dp // 33.33 KWD
```

A cryptocurrency has no ISO figure, so each one the engine prices has its own:
eight places for bitcoin (the smallest amount, a satoshi, is a hundred-millionth
of a bitcoin) and for ether, solana, dogecoin and polkadot, and six for XRP and
cardano. A cryptocurrency amount is shown to between two places and that figure,
without trailing zeros, so a whole bitcoin still reads as `1.00 BTC` and a small
one keeps its digits.

```solve
0.00012345 BTC // 0.00012345 BTC
1 BTC / 3 // 0.33333333 BTC
1 BTC // 1.00 BTC
```

A price per unit is not a payable amount, so it keeps at least its currency's
places and up to the host's setting for quantities (two, unless a host changes
it): a fraction of a yen a kilowatt-hour is a real price.

```solve
¥31.5/kWh // ¥31.5/kWh
¥3/kWh // ¥3/kWh
12 kWh * ¥31.5/kWh // ¥378
```

The boundary: a host that wants one place count for every currency can ask for
it (see [formatting results](/guide/formatting/#currency-places)), and a failed
`check` widens both sides past the minor unit, to show where two amounts differ.
Splitting a bill follows the same figures, so a yen bill is shared out in whole
yen (see [splitting a bill](/syntax/splitting-a-bill/)).

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
