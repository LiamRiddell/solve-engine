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

## An amount in scientific notation

Scientific notation writes a number as digits times a power of ten: `1e-3` is
1 times 10 to the power -3, a thousandth, and `1.5e2` is 150. An amount of money
written that way is the same amount, held exactly as the point form is, so it
rounds to the cent the same way, whether the currency is written before the
amount or after it.

```solve
$1e-3 // $0.00
$0.001 // $0.00
$1.005e0 // $1.01
$1.5e2 // $150.00
1e-3 USD // $0.00
£2.5e-2 // £0.03
$1e-3 * 1000 // $1.00
```

The boundary: only the amount of money is read this way. A plain number in
scientific notation stays a floating-point number, as it has always been (see
[decimals](/syntax/decimals/)), so `1e-3` on its own is still `0.001`. An
amount past the largest number the engine holds, `$1e400`, is shown as `$∞`, the
same as that amount written out in full, and one too small to be anything but
zero, `$1e-400`, is `$0.00`.

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

## How many digits an amount keeps

An exact amount keeps up to 34 significant digits, and up to 34 of them after
the point: the precision of the standard base-ten number format (IEEE 754's
decimal128), and the same ceiling a [plain decimal](/syntax/decimals/) has.
Every amount a person types fits with room to spare. A chain of
multiplications is what reaches past it: growing an amount by a rate written to
nine places adds nine digits on every line, and without a ceiling each line
cost more than the one before. Past 34 digits the amount is rounded to 34,
half away from zero, and carries on from there, so a long chain costs the same
on every line and still shows the right cent.

```solve-doc
x = $100               // $100.00
x = x * 1.123456789    // $112.35
x = x * 1.123456789    // $126.22
x = x * 1.123456789    // $141.80
x = x * 1.123456789    // $159.30
```

The fourth line's exact product is 39 digits long, and the amount it keeps is
rounded at the 34th. Rounding there moves an amount by less than one part in
10^33, so the half-cent rule only answers differently for an amount that sits
within that distance of a half cent. That is the boundary, and an amount typed
with more than 34 places shows it: the first line below is a hair under half a
cent, written to 35 places, and it is held at 34, where it is exactly half a
cent and rounds up. Written to 34 places it is held as it is, and rounds down.

```solve
$0.00499999999999999999999999999999999 // $0.01
$0.0049999999999999999999999999999999 // $0.00
```

An amount whose whole part alone is longer than 34 digits, more than a
decillion, has no 34-digit form to keep, and is held as a floating-point
number. It is written in full, as a plain number that large is, and its digits
are the floating-point number's: about the first sixteen are the amount's, and
the zeros after them only fill the places.

```solve
$1234567890123456789012345678901234 * 10 // $12,345,678,901,234,570,000,000,000,000,000,000.00
```

A plain number past the ceiling falls back to floating point instead (see
[decimals](/syntax/decimals/)). Money is rounded rather than dropped because the
cent is what a note of money is for, and 34 digits keep it exact for any amount
a till could hold.

A bare decimal follows the same rules without a currency, so the two agree:
`0.1 + 0.2 == 0.3` is true, and `100 + 10%` is exactly 110. See
[decimals](/syntax/decimals/) for what that covers and where it ends. A
conversion between two currencies goes through a live rate, which is not exact.

```solve
0.1 + 0.2 == 0.3 // true
0.70 * 1.10 // 0.77
```
