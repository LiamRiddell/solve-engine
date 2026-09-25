---
title: "Currency"
description: Writing money in symbols or words, and converting between currencies.
---

> **Package:** `CURRENCY_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

Money is written the way you would say it: a symbol like `$`, or the currency's
name in words. Amounts in the same currency add and subtract like ordinary
numbers, and converting from one currency to another looks up a live exchange
rate over the network.

```solve
$100 + $50 // $150.00
10 dollars // $10.00
```

An amount below zero is written with its sign first, the way a statement shows a
debit: the minus comes before the symbol, not between the symbol and the digits.

```solve
$50 - $80 // -$30.00
-£3.50 // -£3.50
```

`pounds` and `lb` are the unit of mass, not sterling, since a line like `10
pounds in kg` is far more often weight than money. Write British pounds with
their symbol or their code, `£10` or `10 GBP`. A mass asked for in money is
refused by name, rather than converted at some rate.

```solve
10 pounds in kg // 4.54 kg
10 GBP // £10.00
```

Symbols and words are both recognised. One symbol can stand for several
currencies: `$` is the US dollar by default, and also the Canadian, Australian
and other dollars. Write the currency's three-letter code after the amount to say
which one is meant. A code for a currency with a different symbol, or any other
unit after the amount, is refused rather than dropped.

```solve
$5 CAD in CAD // $5.00
¥500 CNY in CNY // ¥500.00
```

## Writing money as it is written

Much of the world writes the symbol after the amount, `100 €` or `12 kr`, and
a dollar is often named by its country, `A$` for the Australian dollar. Both
are read, and so is every amount Solve writes, so an answer copied from one line
can be typed into another and mean the same money.

A symbol after the amount is the same money as the symbol before it, with or
without a space:

```solve
100 € // €100.00
1,000 ₹ // ₹1,000.00
12 ₽ // 12.00 ₽
-100 € // -€100.00
```

Some currencies are written with letters after the amount, and those letters
read back the same way. `kr` is written for the Swedish, Norwegian and Danish
crowns and reads as the Swedish krona, the way `$` reads as the US dollar;
write `NOK` or `DKK` for the others. The letters are matched exactly as
written, so `Ft` is the forint and `ft` stays the foot.

```solve
12.00 kr + 1 SEK // 13.00 kr
12 zł // 12.00 zł
12 Ft // 12.00 Ft
12 Kč // 12.00 Kč
12 Fr // 12.00 Fr
```

A dollar named by its country has the letters touching the `$`: `A$` (Australian),
`C$` (Canadian), `US$`, `HK$` (Hong Kong), `NZ$` (New Zealand), `S$`
(Singapore), `MX$` (Mexican) and `R$` (the Brazilian real). The answer is
written with a plain `$`, as every dollar is, and stays in the currency named:

```solve
A$100 + $5 AUD // $105.00
R$12.00 // R$12.00
```

The rand is written `R12.00`, and read in that form: the sign touching an
amount with its cents. A bare `R` stays a name, since people use it for a
resistance, a radius or the gas constant, so `12 R` multiplies by whatever `R`
is, and `R12` without cents can be the name of a resistor.

```solve
R12.00 + R1,234.56 // R1,246.56
```

The common codes can be typed in lower case, `100 usd` or `50 eur`. Several
codes are words or units in lower case (`cup` is the cooking unit, `try` and
`mad` are words), so only a chosen list is read that way: `usd`, `eur`,
`gbp`, `jpy`, `cny`, `chf`, `cad`, `aud`, `nzd`, `hkd`, `sgd`,
`sek`, `nok`, `dkk`, `pln`, `czk`, `huf`, `inr`, `krw`, `brl`,
`mxn`, `zar`, `ils`, `thb`, `aed`, `sar`, `myr`, `idr`, `vnd`,
`ngn`, `uah` and `twd`. Any other code is written in capitals.

```solve
100 usd // $100.00
50 eur + 50 EUR // €100.00
```

The boundary: a symbol several currencies share reads as its default, so an
amount the engine writes for one of the others reads back as the default. `12
AUD` is written `$12.00`, which reads as US dollars; `12 NOK` is written `12.00
kr`, which reads as Swedish kronor; `12 CNY` is written `¥12.00`, which reads
as yen. Keep the code (`12 AUD`) where the currency matters.

## Indian grouping

In India a hundred thousand is one lakh, written `1,00,000`, and ten million is
one crore, `1,00,00,000`: the last three digits form a group, and every group
before them is two digits. An amount written this way is read beside the rupee
sign or after it the code `INR`, and is the same amount the ordinary grouping
gives:

```solve
₹1,00,000 // ₹100,000.00
₹1,00,00,000 // ₹10,000,000.00
12,34,567 INR // ₹1,234,567.00
₹12,34,567.89 // ₹1,234,567.89
```

Without a rupee marker, `12,34,567` is refused in an English engine, because
outside the Indian convention a group of two digits is not a group and a
refusal is safer than a guess. An engine created with an Indian tag such as
`en-IN` reads the grouping everywhere, and a host that formats results with
`en-IN` gets them back the same way (`₹12,34,567.89`); see
[locales](/guide/locales/#indian-grouping).

Conversion between currencies reaches the
network and resolves asynchronously. See
[async and live data](/guide/async-and-live-data/).

| Expression | Result |
| --- | --- |
| `10 USD in GBP` | converted at the current rate |
| `100 euros to dollars` | the same, in words |
| `100 USD in GBP on 2024-01-15` | converted at that day's rate |
| `100 USD in GBP on 15 Jan 2024` | the same day, written differently |
| `10 USD in GBP frozen` | converted once, then kept at that amount |

An `on <date>` suffix converts at the rate for the day it names rather than
today's, which is what an expense or an invoice reconciled after the fact needs:
a note that was right when written should not drift as the market moves. Both
date spellings above are read by the same parser used everywhere else. Like the
live conversion, the first result is a pending value and the real answer arrives
later.

Historical rates come from a data source you supply, so nothing is assumed and
no live rate is passed off as a historical one. Without a provider a dated
conversion reports that historical rates are not configured rather than falling
back to today's rate.

```ts
import { createCurrencyPackage } from "solve-engine/packages";

const currency = createCurrencyPackage({
  historicalRateProvider: async (from, to, isoDate, signal) => {
    const res = await fetch(`https://example.com/fx/${isoDate}?from=${from}&to=${to}`, { signal });
    return (await res.json()).rate;
  },
});
```

`createCurrencyPackage()` with no argument is the default already in
`BUILTIN_PACKAGES`, so live conversion works out of the box. Build your own with a
`historicalRateProvider` and substitute it into the engine's `packages` array to
answer dated ones. A resolved historical rate never goes stale, since the rate on
a fixed past date does not change. There is no free, keyless historical-FX service
to bake in the way the live rate has one. Pass `historicalProviderName` beside it
to say whose rates they are.

## Where a rate came from

Every converted amount records where its rate came from: the provider
(Frankfurter, the European Central Bank's reference rates, for the built-in live
rate; the name a host gives for its own), whether the rate was fetched live,
supplied by the host, or looked up for a past day, and when. The record travels
with every line computed from the amount, so an app can show "reference rate, 23
Sep 16:02" beside a total built from converted lines and mark those lines as
depending on a rate. Amounts in one currency involve no rate and record nothing.
See [async and live data](/guide/async-and-live-data/#where-a-live-value-came-from)
for how a host reads it.

Rates from different sources are kept side by side. A note that converts `$100
in EUR` on one line and `$100 in BTC` on the next fetches the euro rate from
Frankfurter and the bitcoin price from CoinGecko, and both lines convert; each
records its own provider. A rate a host supplied is kept beside the engine's own
in the same way.

To stop a converted amount moving with the market, end the line with `frozen`:
it keeps the first answer, with the date it was fixed. See
[frozen answers](/syntax/frozen-answers/).
