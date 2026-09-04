---
title: "Travel"
description: What a journey burns, what it costs, and how long it takes.
---

> **Package:** `TRAVEL_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

Three questions before a drive: how long it takes, how much fuel it needs, and what that fuel costs.

## How much fuel

Fuel economy is how far a car goes on a given amount of fuel, written either as miles per gallon or as litres per hundred kilometres. Give a distance and an economy and you get the volume.

```solve
fuel for 500 km at 7 l/100km // 35.00 litre
fuel for 300 miles at 35 mpg // 32.45 litre
```

`fuel to drive` reads the same way, if that sits better on the line.

```solve
fuel to drive 500 km at 7 l/100km // 35.00 litre
```

The two ways of writing economy are opposites of each other: miles per gallon goes up as a car gets more frugal, litres per hundred kilometres goes down. You can write whichever your car shows, and mix it with whichever distance you have.

## What it costs

Add the price at the pump and you get the bill.

```solve
cost to drive 500 km at 7 l/100km at £1.50/litre // £52.50
cost to drive 300 miles at 35 mpg at £1.50/litre // £48.67
```

The price carries its own volume, so a pump quoting gallons works with a distance in miles or kilometres, which is the ordinary state of affairs in a hire car abroad. The litres are converted into whatever the pump quoted before multiplying.

```solve
cost to drive 300 miles at 35 mpg at $4.20/gallon // $36.00
```

`per` reads the same as the slash.

```solve
cost to drive 500 km at 7 l/100km at £1.50 per litre // £52.50
```

The price is always stated. Fuel prices are local and change daily, so the engine asks rather than guessing, and nothing here reaches the network.

## How long it takes

Drive time is a distance and a speed, and it is ordinary unit arithmetic rather than anything this page adds.

```solve
250 miles at 60 mph // 4.17 h
```

## When it cannot answer

Each part has to be the kind of thing it claims to be, and a line that is not says which part was wrong rather than producing a number.

```solve
fuel for 500 km at 35 kg // "kg" is not a fuel economy: write it as mpg or l/100km
fuel for 50 kg at 7 l/100km // a trip starts with a distance, as in "fuel for 500 km at 7 l/100km"
cost to drive 300 miles at 35 mpg at 5 kg // a fuel price is an amount for a volume, as in "£1.50/litre"
```

## Converting an economy on its own

Comparing a car sold on one measure with a car sold on the other is an ordinary conversion, and it works without any of the above.

```solve
40 mpg in l/100km // 5.88 l/100km
6 l/100km in mpg // 39.20 mpg
```
