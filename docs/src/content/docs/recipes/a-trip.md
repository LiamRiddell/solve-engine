---
title: "A trip"
description: What a drive costs in fuel, how long it takes, and what each passenger owes.
---

Three questions before a drive, and they are usually asked together: what will
the fuel cost, how long will it take, and what does everyone owe. Stating the
car and the route once, at the top, means changing either updates all three.

```solve-doc
:distance = 300 miles
:economy = 35 mpg
cost to drive distance at economy at £1.50/litre // £48.67
distance at 60 mph // 5.00 h
split prev between 3 // 1.67 h each
```

## What each line is doing

**`:distance = 300 miles`** names a value. Everything below refers to it by name,
so a change at the top reaches every line that uses it. See
[variables](/syntax/variables/).

**`35 mpg`** is fuel economy: how far the car goes on a given amount of fuel.
`7 l/100km` says the same thing the other way round, as an amount of fuel for a
fixed distance, and either works here.

**`cost to drive ... at ... at £1.50/litre`** is the fuel bill. The price carries
its own volume, so a pump quoting gallons works with a distance in kilometres,
which is the ordinary state of affairs in a hire car abroad. See
[travel](/syntax/travel/).

**`distance at 60 mph`** is drive time, which is ordinary unit arithmetic rather
than anything the travel forms add.

**`split prev between 3`** divides the line above. Here that is the drive time,
which answers who takes which shift; point it at the cost line instead and it
answers who owes what. See [splitting a bill](/syntax/splitting-a-bill/).

## The cost per person

Splitting the money rather than the hours is the same form pointed one line
higher, which is easier to see written out:

```solve-doc
:fuel = cost to drive 300 miles at 35 mpg at £1.50/litre
fuel // £48.67
split fuel between 3 // £16.22 each
```

## Why the pump price is on the line

Nothing here reaches the network for a fuel price. A pump price is local and
changes daily, so the engine asks for it rather than guessing, and a figure you
typed is one you can check. The same reasoning applies to the car: `35 mpg` is
what your car actually does, which is not what its brochure said.

## A different car, a different country

Because the car and the route are named at the top, comparing two cars is a
matter of changing one line. The economy can be written either way round, and
the pump price in whatever unit the pump used:

```solve-doc
:distance = 500 km
:economy = 7 l/100km
cost to drive distance at economy at £1.50/litre // £52.50
cost to drive distance at 35 mpg at $4.20/gallon // $37.28
```
