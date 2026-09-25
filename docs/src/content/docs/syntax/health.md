---
title: Health & fitness
description: "Body mass index, and the pace or speed of a run from its distance and time."
---

> **Package:** `HEALTH_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

A few everyday health and fitness sums. They are written as functions, with the
numbers in the units the labels state, or with units of your own, which are
converted (see [measurements with units](#measurements-with-units)).

## Body mass index

`bmi(weight, height)` is the body mass index, weight in kilograms over height in
metres squared, the standard rough measure of build.

```solve
bmi(70, 1.75) // 22.86
```

## Pace and speed

For a run or a ride, `pace` and `speed` are the two ways of reading the same
effort: `pace` is the time to cover one kilometre (minutes and seconds), and
`speed` is the distance covered in an hour. Both take the distance in kilometres
and the time in minutes.

```solve
pace(10, 50) // 5:00 /km
speed(10, 50) // 12.00 km/h
pace(21.1, 100) // 4:44 /km
```

The last line is a half marathon (21.1 km) in one hour forty, a pace of four
minutes and forty-four seconds per kilometre.

## Measurements with units

Each function can also be given its measurements with their units, in whatever
units you have them: a weight in pounds or stones, a height in centimetres or in
feet and inches, a distance in miles, a time in hours. Each one is converted into
the unit the function works in before the sum is done, so the answer is the same
as for the plain numbers in kilograms, metres, kilometres and minutes.

```solve
bmi(70 kg, 175 cm) // 22.86
bmi(154 lb, 5 ft 9 in) // 22.74
speed(10 km, 1 h) // 10.00 km/h
speed(26.2 mi, 3.5 h) // 12.05 km/h
pace(10 mi, 80 min) // 4:58 /km
```

A pace is still given per kilometre when the distance is in miles; `pace(10 mi,
80 min)` is ten miles at four minutes fifty-eight a kilometre. A measurement of
the wrong kind, a height given in kilograms or a time in metres, is refused
rather than read as a number, and so is a negative weight, height, distance or
time.

```solve
bmi(175 cm, 70 kg) // bmi: the weight is a mass, not a length. Give it with a unit (70 kg or 154 lb) or as a plain number of kilograms.
bmi(70 kg, -175 cm) // bmi: the height cannot be negative.
```

A plain number keeps the unit the function states, so `speed(10, 1)` is ten
kilometres in one minute, 600.00 km/h.

## Writing a pace directly

A pace can also be written the way it appears on a watch, as minutes and seconds
over a distance. It is an ordinary quantity once written, so it converts and it
multiplies out.

```solve
4:30/km // 4:30 /km
4:30/km in min/mi // 7:15 /mi
10 km at 4:30/km as laptime // 00:45:00
42.2 km at 4:30/km as laptime // 03:09:54
```

The last line is a marathon at four and a half minutes a kilometre, three hours
nine minutes and fifty-four seconds.

The minute unit may be written too, as it is in a converted pace, and `per`
reads as the slash does:

```solve
5:30 min/km // 5:30 /km
5:30 min per km // 5:30 /km
10 km at 5:30 min/km // 3,300 seconds
```

Only a minute unit is read this way, since minutes and seconds are what the two
parts of a pace are. `5:30 h/km` is not a pace, and neither is a clock time with
any other unit after it: it names a moment, so it is refused.

`4m30s/km` says the same thing and always did; the two are the same quantity and
display alike. An hour or more per unit shows the hours:

```solve
1:30:00/km // 1:30:00 /km
```

### What makes it a pace

The distance does. A pace is a time over a length, so the unit after the slash is
what decides, and that is what keeps every other reading of a clock literal
intact: `4:30` on its own is still half past four in the morning, `8:15 + 7:45`
is still a duration (sixteen hours, shown as `960 minutes`), and `90 km/h` is a
speed rather than a pace because it is a distance over a time.

The boundary is a pace faster than a minute per unit. A clock shows whole
seconds, and rounding one that fast would change the number, so it keeps its
digits: a swim written `1:30/100m` reads as `0.90 seconds/m`, because the
denominator reduces to a single metre.
